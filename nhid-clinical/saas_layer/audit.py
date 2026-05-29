"""
saas_layer/audit.py — Cryptographic tamper-evidence layer for NHID Clinical traces.

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
  - The audit_traces table has append-only DB triggers (no UPDATE / DELETE).
  - Rate limiting on verify endpoint: 10 calls/min per org (in-memory, thread-safe).
"""

import hashlib
import hmac as _hmac
import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

_logger = logging.getLogger("nhid.saas.audit")

# ── Secret loading ─────────────────────────────────────────────────────────────

def _load_hmac_secret() -> bytes:
    """
    Load HMAC_SECRET from the environment.
    Raises RuntimeError (hard failure) if missing — never silently degrade.
    The secret value is NEVER stored in a variable accessible outside this function;
    callers receive the bytes directly.
    """
    raw = os.environ.get("HMAC_SECRET", "")
    if not raw:
        raise RuntimeError(
            "HMAC_SECRET environment variable is not set. "
            "Set it as a Replit Secret before starting the SaaS gateway."
        )
    return raw.encode("utf-8")


# Eagerly verify the secret is present at import time so misconfiguration fails
# at startup, not silently at the first trace write.
try:
    _load_hmac_secret()
    _logger.info("AUDIT: HMAC_SECRET loaded successfully")
except RuntimeError as _e:
    _logger.error("AUDIT: %s", _e)
    # Do NOT re-raise at import — let the gateway start so /health still works.
    # append_trace / verify_chain will raise at call time.


# ── DB path (same saas.db used by auth.py) ───────────────────────────────────

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "saas.db")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


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
    """
    Build the deterministic canonical payload for hashing.

    Rules:
    - Exactly the keys in _PAYLOAD_KEYS (missing keys → null).
    - sort_keys=True (ASCII order, which matches the explicit tuple above).
    - No extra whitespace: separators=(',', ':').
    - UTF-8 encoded bytes.
    """
    payload = {k: event.get(k) for k in _PAYLOAD_KEYS}
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


# ── Core cryptographic functions ───────────────────────────────────────────────

def compute_event_hash(event: Dict[str, Any], prev_hash: str) -> str:
    """
    event_hash = SHA256(canonical_payload_bytes + prev_hash_hex_utf8_bytes).hexdigest()

    prev_hash must be a 64-character hex string.
    For the first event in an org's chain use GENESIS_HASH (64 zeros).
    """
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
    """
    hmac_input  = event_hash + org_id + timestamp_iso + (policy_version or "") + str(seq_num)
    hmac_signature = HMAC-SHA256(HMAC_SECRET, hmac_input_utf8).hexdigest()

    Returns the hex HMAC digest.
    """
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
    """Constant-time HMAC verification. Returns True only on exact match."""
    computed = sign_event(event_hash, org_id, timestamp, policy_version, seq_num)
    return _hmac.compare_digest(expected_sig, computed)


GENESIS_HASH = "0" * 64


# ── Chain tail lookup ─────────────────────────────────────────────────────────

def _get_chain_tail(conn: sqlite3.Connection, org_id: str) -> Tuple[str, int]:
    """
    Return (prev_hash, next_seq_num) for the given org's chain.
    If no events exist yet, returns (GENESIS_HASH, 0).
    """
    row = conn.execute(
        "SELECT event_hash, seq_num FROM audit_traces "
        "WHERE org_id = ? ORDER BY seq_num DESC LIMIT 1",
        (org_id,),
    ).fetchone()
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

    Steps:
      1. Validate org_id.
      2. Fetch chain tail (prev_hash, seq_num) inside a serialised transaction.
      3. Compute canonical payload + event_hash.
      4. Compute HMAC signature.
      5. INSERT into audit_traces — DB trigger blocks any UPDATE/DELETE.

    Returns a dict with event_id, event_hash, hmac_signature, seq_num.
    Never logs the HMAC secret.
    """
    if not org_id or not org_id.strip():
        raise ValueError("org_id is required for audit trace writes")

    event_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()

    policy_version = event.get("policy_version")
    enriched = {**event, "model_version": model_version}

    conn = _get_conn()
    try:
        with conn:
            prev_hash, seq_num = _get_chain_tail(conn, org_id)
            event_hash = compute_event_hash(enriched, prev_hash)
            hmac_sig = sign_event(event_hash, org_id, timestamp, policy_version, seq_num)

            conn.execute(
                """
                INSERT INTO audit_traces (
                    event_id, session_id, org_id, seq_num,
                    event_type, state_before, state_after,
                    input_text, policy_action, reason_code, response_text,
                    policy_version, model_version,
                    timestamp, prev_hash, event_hash, hmac_signature
                ) VALUES (
                    ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?,
                    ?, ?, ?, ?
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

def verify_chain(
    org_id: str,
    session_id: str,
) -> Dict[str, Any]:
    """
    Full cryptographic verification of an org+session chain.

    For each event (ordered by seq_num):
      1. Re-derive event_hash from canonical payload + prev_hash.
      2. Re-derive hmac_signature.
      3. Constant-time compare both against stored values.
      4. Verify prev_hash linkage to prior event.

    Returns:
      {
        chain_valid: bool,          # True only if ALL checks pass
        hmac_valid: bool,           # True only if ALL HMACs pass
        event_count: int,
        breaks: [ { seq_num, event_id, reason } ],   # empty if chain_valid
        events: [ { ...event fields, hash_ok, hmac_ok } ]
      }
    """
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM audit_traces "
            "WHERE org_id = ? AND session_id = ? ORDER BY seq_num ASC",
            (org_id, session_id),
        ).fetchall()
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

        # Re-derive event_hash
        enriched = {k: r.get(k) for k in _PAYLOAD_KEYS}
        enriched["model_version"] = r.get("model_version")
        recomputed_hash = compute_event_hash(enriched, r["prev_hash"])
        hash_ok = _hmac.compare_digest(recomputed_hash, r["event_hash"])

        # Verify prev_hash linkage
        link_ok = _hmac.compare_digest(r["prev_hash"], expected_prev)

        # Re-derive HMAC
        recomputed_hmac = sign_event(
            r["event_hash"],
            org_id,
            r["timestamp"],
            r.get("policy_version"),
            seq,
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
            breaks.append({
                "seq_num": seq,
                "event_id": r["event_id"],
                "reason": ", ".join(reason_parts),
            })

        if not sig_ok:
            hmac_valid = False
            if not any(b["seq_num"] == seq for b in breaks):
                breaks.append({
                    "seq_num": seq,
                    "event_id": r["event_id"],
                    "reason": "hmac_mismatch",
                })

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
            "timestamp": r.get("timestamp"),
            "created_at": r.get("created_at"),
            "event_hash": r["event_hash"],
            "hmac_signature": r["hmac_signature"],
            "hash_ok": hash_ok and link_ok,
            "hmac_ok": sig_ok,
        })

        # Advance expected_prev to this event's hash for the next iteration
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
_rate_store: Dict[str, List[float]] = {}   # org_id → list of call timestamps
_RATE_LIMIT_CALLS = 10
_RATE_LIMIT_WINDOW = 60.0  # seconds


def check_verify_rate_limit(org_id: str) -> bool:
    """
    Allow up to 10 verify calls per org per 60 seconds.
    Returns True if the call is allowed, False if rate-limited.
    Thread-safe.
    """
    now = time.monotonic()
    with _rate_lock:
        calls = _rate_store.get(org_id, [])
        # Evict timestamps outside the rolling window
        calls = [t for t in calls if now - t < _RATE_LIMIT_WINDOW]
        if len(calls) >= _RATE_LIMIT_CALLS:
            _rate_store[org_id] = calls
            return False
        calls.append(now)
        _rate_store[org_id] = calls
    return True
