"""
saas_layer/audit.py — Cryptographic tamper-evidence layer for NHID Clinical traces.
Backed by Replit PostgreSQL (persistent, append-only enforced by DB triggers).

═══════════════════════════════════════════════════════════════════════
CANONICAL PAYLOAD FORMAT  (used as input to event_hash)
═══════════════════════════════════════════════════════════════════════
  json.dumps(payload_dict, sort_keys=True, separators=(',', ':'))

  payload_dict contains EXACTLY these keys (None values kept as JSON null):
    event_type, state_before, state_after, input_text,
    policy_action, reason_code, response_text, policy_version, model_version

  No extra whitespace. Keys always in ASCII sort order.

═══════════════════════════════════════════════════════════════════════
HASH CHAIN  (per-org, ordered by seq_num)
═══════════════════════════════════════════════════════════════════════
  prev_hash for org's first event: "0" * 64  (genesis sentinel)
  event_hash = SHA256(canonical_json_bytes + prev_hash_hex_utf8_bytes).hexdigest()

═══════════════════════════════════════════════════════════════════════
HMAC SIGNATURE
═══════════════════════════════════════════════════════════════════════
  hmac_input = event_hash_hex + org_id + timestamp_iso + (policy_version or "") + str(seq_num)
  hmac_signature = HMAC-SHA256(HMAC_SECRET_bytes, hmac_input_utf8_bytes).hexdigest()

  Verification uses hmac.compare_digest — always constant-time.

═══════════════════════════════════════════════════════════════════════
SECURITY INVARIANTS
═══════════════════════════════════════════════════════════════════════
  - HMAC_SECRET is never logged, included in responses, or passed to exceptions.
  - org_id is validated non-empty before every write.
  - audit_traces has Postgres append-only triggers (no UPDATE / DELETE).
  - Rate limiting on verify endpoint: 10 calls/min per org (in-memory, thread-safe).
"""

import hashlib
import hmac as _hmac
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from saas_layer.db import get_conn

_logger = logging.getLogger("nhid.saas.audit")

# ── Secret loading ─────────────────────────────────────────────────────────────

def _load_hmac_secret() -> bytes:
    raw = os.environ.get("HMAC_SECRET", "")
    if not raw:
        raise RuntimeError(
            "HMAC_SECRET environment variable is not set. "
            "Set it as a Replit Secret before starting the SaaS gateway."
        )
    return raw.encode("utf-8")


try:
    _load_hmac_secret()
    _logger.info("AUDIT: HMAC_SECRET loaded successfully")
except RuntimeError as _e:
    _logger.error("AUDIT: %s", _e)


# ── Canonical payload ─────────────────────────────────────────────────────────

_PAYLOAD_KEYS = (
    "event_type",
    "state_before",
    "state_after",
    "input_text",
    "policy_action",
    "reason_code",
    "response_text",
    "policy_version",
    "model_version",
)


def _canonical_payload(event: Dict[str, Any]) -> bytes:
    payload = {k: event.get(k) for k in _PAYLOAD_KEYS}
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


# ── Core cryptographic functions ───────────────────────────────────────────────

def compute_event_hash(event: Dict[str, Any], prev_hash: str) -> str:
    canonical = _canonical_payload(event)
    raw = canonical + prev_hash.encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def sign_event(
    event_hash: str,
    org_id: str,
    timestamp: str,
    policy_version: Optional[str],
    seq_num: int,
) -> str:
    secret = _load_hmac_secret()
    msg = (
        event_hash
        + org_id
        + timestamp
        + (policy_version or "")
        + str(seq_num)
    ).encode("utf-8")
    return _hmac.new(secret, msg, hashlib.sha256).hexdigest()


def _verify_signature(
    expected_sig: str,
    event_hash: str,
    org_id: str,
    timestamp: str,
    policy_version: Optional[str],
    seq_num: int,
) -> bool:
    computed = sign_event(event_hash, org_id, timestamp, policy_version, seq_num)
    return _hmac.compare_digest(expected_sig, computed)


GENESIS_HASH = "0" * 64


# ── Chain tail lookup ─────────────────────────────────────────────────────────

def _get_chain_tail(cur, org_id: str) -> Tuple[str, int]:
    """
    Return (prev_hash, next_seq_num) for the given org's chain.
    Must be called inside an open transaction with the same cursor.
    Uses FOR UPDATE to serialize concurrent writes per org.
    """
    cur.execute(
        "SELECT event_hash, seq_num FROM audit_traces "
        "WHERE org_id = %s ORDER BY seq_num DESC LIMIT 1 FOR UPDATE",
        (org_id,),
    )
    row = cur.fetchone()
    if row is None:
        return GENESIS_HASH, 0
    return row["event_hash"], row["seq_num"] + 1


# ── Public write API ──────────────────────────────────────────────────────────

def append_trace(
    org_id: str,
    session_id: str,
    event: Dict[str, Any],
    model_version: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Append a single event to the org's append-only audit chain.

    Raises ValueError if org_id is empty.
    Raises any DB or HMAC error — callers must NOT swallow this.
    Returns dict with event_id, event_hash, hmac_signature, seq_num, timestamp.
    """
    if not org_id or not org_id.strip():
        raise ValueError("org_id is required for audit trace writes")

    event_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()
    policy_version = event.get("policy_version")
    enriched = {**event, "model_version": model_version}

    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            prev_hash, seq_num = _get_chain_tail(cur, org_id)
            event_hash = compute_event_hash(enriched, prev_hash)
            hmac_sig = sign_event(event_hash, org_id, timestamp, policy_version, seq_num)

            cur.execute(
                """
                INSERT INTO audit_traces (
                    event_id, session_id, org_id, seq_num,
                    event_type, state_before, state_after,
                    input_text, policy_action, reason_code, response_text,
                    policy_version, model_version,
                    timestamp, prev_hash, event_hash, hmac_signature
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s,
                    %s, %s, %s, %s
                )
                """,
                (
                    event_id, session_id, org_id, seq_num,
                    event.get("event_type"), event.get("state_before"), event.get("state_after"),
                    event.get("input_text"), event.get("policy_action"),
                    event.get("reason_code"), event.get("response_text"),
                    policy_version, model_version,
                    timestamp, prev_hash, event_hash, hmac_sig,
                ),
            )
    finally:
        conn.close()

    return {
        "event_id": event_id,
        "event_hash": event_hash,
        "hmac_signature": hmac_sig,
        "seq_num": seq_num,
        "timestamp": timestamp,
    }


# ── Verify chain ──────────────────────────────────────────────────────────────

def verify_chain(org_id: str, session_id: str) -> Dict[str, Any]:
    """
    Full cryptographic verification of an org+session chain.
    Re-derives every event_hash and HMAC from stored data, constant-time comparison.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM audit_traces "
            "WHERE org_id = %s AND session_id = %s ORDER BY seq_num ASC",
            (org_id, session_id),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    events_out: List[Dict[str, Any]] = []
    breaks: List[Dict[str, Any]] = []
    chain_valid = True
    hmac_valid = True
    expected_prev = GENESIS_HASH

    for row in rows:
        r = dict(row)
        seq = r["seq_num"]

        enriched = {k: r.get(k) for k in _PAYLOAD_KEYS}
        enriched["model_version"] = r.get("model_version")
        recomputed_hash = compute_event_hash(enriched, r["prev_hash"])
        hash_ok = _hmac.compare_digest(recomputed_hash, r["event_hash"])
        link_ok = _hmac.compare_digest(r["prev_hash"], expected_prev)

        # Normalise timestamp: Postgres returns TIMESTAMPTZ; convert to ISO string
        ts = r["timestamp"]
        if hasattr(ts, "isoformat"):
            ts = ts.isoformat()

        recomputed_hmac = sign_event(
            r["event_hash"], org_id, ts,
            r.get("policy_version"), seq,
        )
        sig_ok = _hmac.compare_digest(recomputed_hmac, r["hmac_signature"])

        event_ok = hash_ok and link_ok
        if not event_ok:
            chain_valid = False
            reason_parts = []
            if not hash_ok:
                reason_parts.append("event_hash_mismatch")
            if not link_ok:
                reason_parts.append("prev_hash_broken")
            breaks.append({"seq_num": seq, "event_id": r["event_id"], "reason": ", ".join(reason_parts)})

        if not sig_ok:
            hmac_valid = False
            if not any(b["seq_num"] == seq for b in breaks):
                breaks.append({"seq_num": seq, "event_id": r["event_id"], "reason": "hmac_mismatch"})

        created_at = r.get("created_at")
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()

        events_out.append({
            "event_id": r["event_id"],
            "seq_num": seq,
            "session_id": r["session_id"],
            "org_id": r["org_id"],
            "event_type": r.get("event_type"),
            "state_before": r.get("state_before"),
            "state_after": r.get("state_after"),
            "policy_version": r.get("policy_version"),
            "model_version": r.get("model_version"),
            "timestamp": ts,
            "created_at": created_at,
            "event_hash": r["event_hash"],
            "hmac_signature": r["hmac_signature"],
            "hash_ok": hash_ok and link_ok,
            "hmac_ok": sig_ok,
        })

        expected_prev = r["event_hash"]

    return {
        "chain_valid": chain_valid,
        "hmac_valid": hmac_valid,
        "event_count": len(rows),
        "breaks": breaks,
        "events": events_out,
    }


# ── Rate limiter for verify endpoint ─────────────────────────────────────────

_rate_lock = threading.Lock()
_rate_store: Dict[str, List[float]] = {}
_RATE_LIMIT_CALLS = 10
_RATE_LIMIT_WINDOW = 60.0


def check_verify_rate_limit(org_id: str) -> bool:
    now = time.monotonic()
    with _rate_lock:
        calls = _rate_store.get(org_id, [])
        calls = [t for t in calls if now - t < _RATE_LIMIT_WINDOW]
        if len(calls) >= _RATE_LIMIT_CALLS:
            _rate_store[org_id] = calls
            return False
        calls.append(now)
        _rate_store[org_id] = calls
    return True
