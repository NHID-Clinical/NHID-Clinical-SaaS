"""
voice_policy_store.py — Per-org voice policy rule configuration persistence.

Each org maintains a versioned ruleset — an ordered list of policy rules that
the enforcement engine evaluates on every transcript chunk.  Rules can be
enabled/disabled and parameterised without any code changes.

Two built-in rule types ship with the system:
  REQUIRE_UPFRONT_DISCLOSURE  — builtin: enforces first-turn AI identity disclosure
  HUMAN_ESCALATION_REQUESTED — phrase_match: triggers escalation on trigger phrases

Future rule types (e.g. HIPAA_TOPIC_DETECTION, MEDICATION_REFUSAL_DETECTION) can
be added to BUILTIN_RULE_REGISTRY and become immediately configurable per org.

DB layout (append-only — every save creates a new row):
  voice_policy_configs (id, org_id, rules TEXT/JSON, version, created_at)
  phrases TEXT column retained for backward-compat with old rows.
"""

import json
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from saas_layer.db import get_conn

DEFAULT_VERSION = "VOICE-POLICY-v1.0"

# ── Built-in rule registry ────────────────────────────────────────────────────
# Code-registered rule types.  New rule types can be added here; they appear in
# the dashboard immediately and can be configured per org without code changes.
BUILTIN_RULE_REGISTRY: Dict[str, Dict[str, Any]] = {
    "REQUIRE_UPFRONT_DISCLOSURE": {
        "rule_key": "REQUIRE_UPFRONT_DISCLOSURE",
        "rule_type": "builtin",
        "label": "Upfront AI Disclosure",
        "description": (
            "Enforce an AI identity disclosure at the start of every call "
            "before any other response is allowed."
        ),
        "params_schema": {},
    },
    "HUMAN_ESCALATION_REQUESTED": {
        "rule_key": "HUMAN_ESCALATION_REQUESTED",
        "rule_type": "phrase_match",
        "label": "Human Escalation Trigger",
        "description": (
            "Escalate the call to a human agent when the caller uses any "
            "configured trigger phrase."
        ),
        "params_schema": {"phrases": "list[str]"},
    },
    "REQUIRE_AGENT_AUTHORIZATION": {
        "rule_key": "REQUIRE_AGENT_AUTHORIZATION",
        "rule_type": "authorization",
        "label": "Provider-Signed Agent Authorization",
        "description": (
            "Deny the turn unless the calling agent presented a provider-signed "
            "delegation that verifies against a public key this organisation has "
            "registered for the NPI the agent claims to act for. With 'required' "
            "off, a call that presents no credential is allowed through, but a "
            "credential that fails verification is still denied."
        ),
        "params_schema": {"required": "bool", "required_scope": "str|null"},
    },
}

# ── Default ruleset (used when no custom config has been saved) ───────────────
#
# On the default posture of REQUIRE_AGENT_AUTHORIZATION
# -----------------------------------------------------
# It ships enabled but with ``required: False``, and it sits at priority -1 so
# it is evaluated before anything else.
#
# ``required: False`` is not the rule being switched off. With no credential
# presented the turn passes through; with a credential that fails verification
# the turn is denied. That is the only default that both closes the
# impersonation hole for agents that do present credentials and does not
# instantly break every organisation already running calls without them.
#
# Set ``required: true`` per org to refuse any agent that cannot prove it was
# delegated by the NPI it claims. That is the stricter posture, and it is opt-in
# on purpose: turning it on will stop calls.
#
DEFAULT_RULESET: List[Dict[str, Any]] = [
    {
        "rule_key": "REQUIRE_AGENT_AUTHORIZATION",
        "rule_type": "authorization",
        "label": "Provider-Signed Agent Authorization",
        "enabled": True,
        "priority": -1,
        "params": {"required": False, "required_scope": None},
    },
    {
        "rule_key": "REQUIRE_UPFRONT_DISCLOSURE",
        "rule_type": "builtin",
        "label": "Upfront AI Disclosure",
        "enabled": True,
        "priority": 0,
        "params": {},
    },
    {
        "rule_key": "HUMAN_ESCALATION_REQUESTED",
        "rule_type": "phrase_match",
        "label": "Human Escalation Trigger",
        "enabled": True,
        "priority": 1,
        "params": {
            "phrases": [
                "speak to a human",
                "real person",
                "agent please",
                "transfer me",
                "human agent",
                "talk to someone",
            ]
        },
    },
]


def init_voice_policy_table() -> None:
    """
    Idempotent schema bootstrap.
    Creates voice_policy_configs if absent and adds the `rules` column if the
    table was previously created with only the `phrases` column.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS voice_policy_configs (
                    id         SERIAL PRIMARY KEY,
                    org_id     TEXT NOT NULL,
                    phrases    TEXT,
                    version    TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                ALTER TABLE voice_policy_configs
                ADD COLUMN IF NOT EXISTS rules TEXT
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_vpc_org_created
                ON voice_policy_configs (org_id, created_at DESC)
            """)
    finally:
        conn.close()


# ── Read helpers ──────────────────────────────────────────────────────────────

def _row_to_ruleset(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract the ruleset from a DB row, with backward compat for old phrase-only rows."""
    if row.get("rules"):
        return json.loads(row["rules"])
    # Backward compat: derive a phrase_match rule from the old phrases column
    if row.get("phrases"):
        phrases = json.loads(row["phrases"])
        ruleset = [r.copy() for r in DEFAULT_RULESET]
        for r in ruleset:
            if r["rule_key"] == "HUMAN_ESCALATION_REQUESTED":
                r["params"] = {"phrases": phrases}
        return ruleset
    return [r.copy() for r in DEFAULT_RULESET]


def get_current_policy(org_id: str) -> Optional[Dict[str, Any]]:
    """
    Return the latest saved policy for org_id, or None if no custom config exists.
    Returned dict shape: {"rules": [...], "version": "...", "created_at": "...", "is_custom": True}
    Also exposes "phrases" extracted from the ruleset for backward compat.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT rules, phrases, version, created_at
            FROM voice_policy_configs
            WHERE org_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (org_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        ruleset = _row_to_ruleset(row)
        return {
            "rules": ruleset,
            "phrases": _extract_phrases(ruleset),
            "version": row["version"],
            "created_at": row["created_at"],
            "is_custom": True,
        }
    finally:
        conn.close()


def get_effective_policy(org_id: str) -> Dict[str, Any]:
    """
    Return the effective policy for org_id, falling back to system defaults.
    Always returns a usable dict — never None.
    """
    custom = get_current_policy(org_id)
    if custom:
        return custom
    return {
        "rules": [r.copy() for r in DEFAULT_RULESET],
        "phrases": _extract_phrases(DEFAULT_RULESET),
        "version": DEFAULT_VERSION,
        "created_at": None,
        "is_custom": False,
    }


def _extract_phrases(ruleset: List[Dict[str, Any]]) -> List[str]:
    """Utility: pull phrases from the HUMAN_ESCALATION_REQUESTED rule in a ruleset."""
    for rule in ruleset:
        if rule.get("rule_key") == "HUMAN_ESCALATION_REQUESTED":
            return rule.get("params", {}).get("phrases", [])
    return []


# ── Write helpers ─────────────────────────────────────────────────────────────

def save_ruleset(org_id: str, ruleset: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Append a new ruleset version for org_id.
    Version format: VOICE-POLICY-v<unix_epoch>
    Returns the newly saved config dict.
    """
    version = f"VOICE-POLICY-v{int(time.time())}"
    created_at = datetime.now(timezone.utc).isoformat()
    phrases = _extract_phrases(ruleset)
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO voice_policy_configs (org_id, rules, phrases, version, created_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (org_id, json.dumps(ruleset), json.dumps(phrases), version, created_at),
            )
    finally:
        conn.close()
    return {
        "rules": ruleset,
        "phrases": phrases,
        "version": version,
        "created_at": created_at,
        "is_custom": True,
    }


def get_policy_history(org_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Return up to `limit` recent policy versions for org_id, newest first.
    Each entry includes the full ruleset snapshot.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, rules, phrases, version, created_at
            FROM voice_policy_configs
            WHERE org_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (org_id, limit),
        )
        rows = cur.fetchall()
        return [
            {
                "id": r["id"],
                "rules": _row_to_ruleset(r),
                "version": r["version"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    finally:
        conn.close()


# ── Backward-compat shim ──────────────────────────────────────────────────────

def save_policy(org_id: str, phrases: List[str]) -> Dict[str, Any]:
    """
    Backward-compat helper: save a phrases-only update.
    Builds a full ruleset preserving the REQUIRE_UPFRONT_DISCLOSURE rule and
    updating only the phrases on the HUMAN_ESCALATION_REQUESTED rule.
    """
    existing = get_current_policy(org_id)
    if existing:
        base_rules = [r.copy() for r in existing["rules"]]
    else:
        base_rules = [r.copy() for r in DEFAULT_RULESET]
    for rule in base_rules:
        if rule.get("rule_key") == "HUMAN_ESCALATION_REQUESTED":
            rule["params"] = {"phrases": phrases}
    return save_ruleset(org_id, base_rules)
