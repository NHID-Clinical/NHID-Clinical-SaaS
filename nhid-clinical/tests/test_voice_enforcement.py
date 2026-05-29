"""
Tests for the voice behaviour enforcement layer.

Coverage
--------
Unit tests    — voice_policy.py pure functions (no I/O, no dependencies)
Integration   — POST /saas/voice/incoming and POST /saas/voice/transcript via
                FastAPI TestClient with dependency overrides (no real DB writes)
"""

import os
import sys
import pytest
from unittest.mock import patch

# Ensure nhid-clinical/ is on sys.path so saas_layer is importable
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# ── Unit-test imports ─────────────────────────────────────────────────────────
from saas_layer.voice_policy import (
    check_disclosure,
    check_escalation,
    run_voice_policy,
    POLICY_VERSION,
    _ESCALATION_PHRASES,
)

# ─────────────────────────────────────────────────────────────────────────────
# Unit tests: check_disclosure
# ─────────────────────────────────────────────────────────────────────────────

class TestCheckDisclosure:
    def test_needs_disclosure_when_state_empty(self):
        assert check_disclosure({}) is True

    def test_needs_disclosure_when_explicitly_false(self):
        assert check_disclosure({"disclosure_confirmed": False}) is True

    def test_no_disclosure_when_confirmed(self):
        assert check_disclosure({"disclosure_confirmed": True}) is False


# ─────────────────────────────────────────────────────────────────────────────
# Unit tests: check_escalation
# ─────────────────────────────────────────────────────────────────────────────

class TestCheckEscalation:
    @pytest.mark.parametrize("phrase", _ESCALATION_PHRASES)
    def test_detects_each_trigger_phrase_verbatim(self, phrase):
        assert check_escalation(phrase) is True

    def test_case_insensitive_all_caps(self):
        assert check_escalation("SPEAK TO A HUMAN") is True

    def test_case_insensitive_mixed(self):
        assert check_escalation("Real Person please") is True

    def test_phrase_embedded_in_sentence(self):
        assert check_escalation("I really want to speak to a human right now") is True

    def test_talk_to_someone_mid_sentence(self):
        assert check_escalation("Can I talk to someone else instead?") is True

    def test_no_false_positive_empty_string(self):
        assert check_escalation("") is False

    def test_no_false_positive_generic_query(self):
        assert check_escalation("What is the weather today?") is False

    def test_no_false_positive_clinical_content(self):
        assert check_escalation("I have a question about my medication dosage") is False

    def test_no_false_positive_affirmative(self):
        assert check_escalation("Yes, that sounds correct") is False

    def test_no_false_positive_scheduling_request(self):
        assert check_escalation("Can you help me with scheduling?") is False


# ─────────────────────────────────────────────────────────────────────────────
# Unit tests: run_voice_policy
# ─────────────────────────────────────────────────────────────────────────────

class TestRunVoicePolicy:
    def test_disclose_on_first_turn(self):
        result = run_voice_policy("Hello", {"disclosure_confirmed": False})
        assert result["action"] == "disclose"
        assert result["reason_code"] == "REQUIRE_UPFRONT_DISCLOSURE"
        assert result["policy_version"] == POLICY_VERSION

    def test_disclose_on_empty_state(self):
        assert run_voice_policy("Some text", {})["action"] == "disclose"

    def test_allow_after_disclosure_confirmed(self):
        result = run_voice_policy("How can I help you?", {"disclosure_confirmed": True})
        assert result["action"] == "allow"
        assert result["reason_code"] is None
        assert result["policy_version"] == POLICY_VERSION

    def test_escalate_on_trigger_phrase_after_disclosure(self):
        result = run_voice_policy("I want to speak to a human", {"disclosure_confirmed": True})
        assert result["action"] == "escalate"
        assert result["reason_code"] == "HUMAN_ESCALATION_REQUESTED"
        assert result["policy_version"] == POLICY_VERSION

    def test_disclosure_takes_priority_over_escalation(self):
        """Escalation phrase on first turn must still return disclose, not escalate."""
        result = run_voice_policy("speak to a human", {"disclosure_confirmed": False})
        assert result["action"] == "disclose"
        assert result["reason_code"] == "REQUIRE_UPFRONT_DISCLOSURE"

    @pytest.mark.parametrize("phrase", _ESCALATION_PHRASES)
    def test_all_escalation_phrases_trigger_escalate(self, phrase):
        result = run_voice_policy(phrase, {"disclosure_confirmed": True})
        assert result["action"] == "escalate"

    def test_allow_returns_none_reason_code(self):
        result = run_voice_policy("I have a routine question", {"disclosure_confirmed": True})
        assert result["reason_code"] is None

    def test_state_dict_is_not_mutated(self):
        """run_voice_policy must never modify the session state dict passed to it."""
        state = {"disclosure_confirmed": True, "escalated": False}
        snapshot = dict(state)
        run_voice_policy("some text", state)
        assert state == snapshot


# ─────────────────────────────────────────────────────────────────────────────
# Integration tests: gateway endpoints
# ─────────────────────────────────────────────────────────────────────────────
# FastAPI TestClient runs the ASGI app in-process.
# get_current_org is overridden so no real API key or DB lookup is needed.
# audit_svc.append_trace and nhid_client.append_event are patched to avoid
# writing to the real database during tests.

from fastapi.testclient import TestClient
from saas_layer.gateway import app, get_current_org
from saas_layer.db import get_conn as _get_conn


def _fetch_voice_session(session_id: str):
    """Return the voice_sessions row for *session_id* as a dict, or None."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT session_id, org_id, disclosure_confirmed, escalated "
            "FROM voice_sessions WHERE session_id = %s",
            (session_id,),
        )
        row = cur.fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()

_FAKE_ORG = {
    "org_id": "test-org-alpha",
    "org_name": "Alpha Test Org",
    "plan": "free",
    "status": "active",
    "billing_active": True,
}

_FAKE_ORG_2 = {
    "org_id": "test-org-beta",
    "org_name": "Beta Test Org",
    "plan": "free",
    "status": "active",
    "billing_active": True,
}

_MOCK_AUDIT_RETURN = {"event_hash": "deadbeef0000000000000000000000000000000000000000000000000000cafe"}


@pytest.fixture(autouse=True)
def isolate_voice_sessions():
    """Delete test org voice sessions from PostgreSQL before and after every test."""
    _test_org_ids = (_FAKE_ORG["org_id"], _FAKE_ORG_2["org_id"])
    def _clean():
        conn = _get_conn()
        try:
            with conn:
                conn.cursor().execute(
                    "DELETE FROM voice_sessions WHERE org_id = ANY(%s)",
                    (list(_test_org_ids),),
                )
        finally:
            conn.close()
    _clean()
    yield
    _clean()


@pytest.fixture
def client():
    """TestClient authenticated as FAKE_ORG with DB writes suppressed."""
    app.dependency_overrides[get_current_org] = lambda: _FAKE_ORG
    with (
        patch("saas_layer.gateway.audit_svc.append_trace", return_value=_MOCK_AUDIT_RETURN),
        patch("saas_layer.gateway.nhid_client.append_event"),
        patch("saas_layer.gateway.log_request"),
    ):
        yield TestClient(app)
    app.dependency_overrides.pop(get_current_org, None)


def _make_client(org: dict) -> TestClient:
    """Helper: build a TestClient for a given org without DB side effects."""
    app.dependency_overrides[get_current_org] = lambda: org
    return TestClient(app)


# ── POST /saas/voice/incoming ─────────────────────────────────────────────────

class TestVoiceIncoming:
    def test_returns_200_with_session_id(self, client):
        r = client.post("/saas/voice/incoming", json={})
        assert r.status_code == 200
        body = r.json()
        assert "session_id" in body
        assert isinstance(body["session_id"], str)

    def test_action_is_disclose(self, client):
        r = client.post("/saas/voice/incoming", json={})
        assert r.json()["action"] == "disclose"

    def test_disclosure_text_mentions_org_name(self, client):
        r = client.post("/saas/voice/incoming", json={})
        assert _FAKE_ORG["org_name"] in r.json()["disclosure_text"]

    def test_disclosure_text_mentions_ai_system(self, client):
        r = client.post("/saas/voice/incoming", json={})
        assert "AI system" in r.json()["disclosure_text"]

    def test_session_stored_in_db(self, client):
        r = client.post("/saas/voice/incoming", json={})
        sid = r.json()["session_id"]
        row = _fetch_voice_session(sid)
        assert row is not None, "session row must be persisted to voice_sessions table"
        assert row["disclosure_confirmed"] is False
        assert row["org_id"] == _FAKE_ORG["org_id"]

    def test_requires_api_key_header(self):
        """No override active — real auth dependency should fire 401."""
        app.dependency_overrides.pop(get_current_org, None)
        r = TestClient(app).post("/saas/voice/incoming", json={})
        assert r.status_code == 401

    def test_audit_failure_returns_500_and_rolls_back_session(self):
        """If audit write fails, the session must not remain in memory and 500 is returned."""
        app.dependency_overrides[get_current_org] = lambda: _FAKE_ORG
        with (
            patch("saas_layer.gateway.audit_svc.append_trace", side_effect=RuntimeError("DB down")),
            patch("saas_layer.gateway.nhid_client.append_event"),
            patch("saas_layer.gateway.log_request"),
        ):
            r = TestClient(app).post("/saas/voice/incoming", json={})
        app.dependency_overrides.pop(get_current_org, None)
        assert r.status_code == 500
        # Session must have been rolled back — no row in DB for this org
        conn = _get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT COUNT(*) AS n FROM voice_sessions WHERE org_id = %s",
                (_FAKE_ORG["org_id"],),
            )
            assert cur.fetchone()["n"] == 0, "rolled-back session must not remain in DB"
        finally:
            conn.close()


# ── POST /saas/voice/transcript ───────────────────────────────────────────────

class TestVoiceTranscript:
    def _start(self, client) -> str:
        r = client.post("/saas/voice/incoming", json={})
        assert r.status_code == 200, f"voice/incoming failed: {r.text}"
        return r.json()["session_id"]

    def _transcript(self, client, sid: str, text: str, turn: int = 1):
        return client.post("/saas/voice/transcript", json={
            "session_id": sid,
            "transcript_text": text,
            "turn_number": turn,
        })

    # ── basic response shape ──────────────────────────────────────────────────

    def test_returns_200_with_required_fields(self, client):
        sid = self._start(client)
        r = self._transcript(client, sid, "Hello")
        assert r.status_code == 200
        body = r.json()
        assert {"action", "reason_code", "session_id", "event_hash"} <= body.keys()

    # ── first-turn disclosure enforcement ────────────────────────────────────

    def test_first_turn_returns_disclose(self, client):
        sid = self._start(client)
        r = self._transcript(client, sid, "Hello")
        body = r.json()
        assert body["action"] == "disclose"
        assert body["reason_code"] == "REQUIRE_UPFRONT_DISCLOSURE"
        assert body["session_id"] == sid

    def test_disclosure_confirmed_after_first_turn(self, client):
        sid = self._start(client)
        self._transcript(client, sid, "Hello", turn=1)
        row = _fetch_voice_session(sid)
        assert row is not None
        assert row["disclosure_confirmed"] is True

    # ── allow after disclosure ────────────────────────────────────────────────

    def test_second_turn_returns_allow(self, client):
        sid = self._start(client)
        self._transcript(client, sid, "Hello", turn=1)       # confirms disclosure
        r = self._transcript(client, sid, "I have a question", turn=2)
        assert r.json()["action"] == "allow"

    def test_allow_returns_null_reason_code(self, client):
        sid = self._start(client)
        self._transcript(client, sid, "Hello", turn=1)
        r = self._transcript(client, sid, "Can you help me?", turn=2)
        assert r.json()["reason_code"] is None

    # ── escalation enforcement ────────────────────────────────────────────────

    def test_escalation_phrase_returns_escalate(self, client):
        sid = self._start(client)
        self._transcript(client, sid, "Hello", turn=1)      # confirm disclosure
        r = self._transcript(client, sid, "I want to speak to a human", turn=2)
        body = r.json()
        assert body["action"] == "escalate"
        assert body["reason_code"] == "HUMAN_ESCALATION_REQUESTED"

    def test_escalated_flag_set_in_session_state(self, client):
        sid = self._start(client)
        self._transcript(client, sid, "Hello", turn=1)
        self._transcript(client, sid, "speak to a human", turn=2)
        row = _fetch_voice_session(sid)
        assert row is not None
        assert row["escalated"] is True

    # ── full multi-turn state machine ─────────────────────────────────────────

    def test_state_machine_disclose_allow_escalate_allow(self, client):
        """4-turn canonical sequence: disclose → allow → escalate → allow."""
        sid = self._start(client)
        sequence = [
            ("Hello there",               "disclose"),   # turn 1 — disclosure not yet confirmed
            ("What are my options?",       "allow"),      # turn 2 — now confirmed, no trigger
            ("Please transfer me to a human", "escalate"), # turn 3 — trigger phrase
            ("Actually, never mind",        "allow"),     # turn 4 — disclosure confirmed, no trigger
        ]
        for turn, (text, expected) in enumerate(sequence, start=1):
            r = self._transcript(client, sid, text, turn=turn)
            assert r.status_code == 200
            actual = r.json()["action"]
            assert actual == expected, (
                f"Turn {turn} ('{text}'): expected '{expected}', got '{actual}'"
            )

    # ── error cases ───────────────────────────────────────────────────────────

    def test_unknown_session_returns_404(self, client):
        r = self._transcript(client, "non-existent-session-id", "hello")
        assert r.status_code == 404

    def test_cross_tenant_access_returns_403(self, client):
        """Org 2 must not be able to process transcripts for Org 1's session."""
        sid = self._start(client)
        # Switch to org 2 for the transcript call
        app.dependency_overrides[get_current_org] = lambda: _FAKE_ORG_2
        with (
            patch("saas_layer.gateway.audit_svc.append_trace", return_value=_MOCK_AUDIT_RETURN),
            patch("saas_layer.gateway.nhid_client.append_event"),
            patch("saas_layer.gateway.log_request"),
        ):
            r = TestClient(app).post("/saas/voice/transcript", json={
                "session_id": sid,
                "transcript_text": "Hello",
                "turn_number": 1,
            })
        # Restore original override so fixture teardown works cleanly
        app.dependency_overrides[get_current_org] = lambda: _FAKE_ORG
        assert r.status_code == 403

    def test_audit_failure_returns_500(self, client):
        """If audit write fails mid-call, endpoint must return 500 (fail-closed)."""
        sid = self._start(client)
        app.dependency_overrides[get_current_org] = lambda: _FAKE_ORG
        with (
            patch("saas_layer.gateway.audit_svc.append_trace", side_effect=RuntimeError("DB down")),
            patch("saas_layer.gateway.nhid_client.append_event"),
            patch("saas_layer.gateway.log_request"),
        ):
            r = TestClient(app).post("/saas/voice/transcript", json={
                "session_id": sid,
                "transcript_text": "Hello",
                "turn_number": 1,
            })
        assert r.status_code == 500


class TestRulesetPolicyEngine:
    """
    Unit tests for the rule-based evaluation path in run_voice_policy.

    These tests exercise the `ruleset=` parameter path (the preferred path used
    by the gateway at runtime) and verify:
      - Custom phrase lists are authoritative — no fallback to hardcoded defaults
      - An empty phrase list means "match nothing" in ruleset mode
      - Hardcoded defaults are only used in the legacy (no-ruleset) path
      - Disabled rules are skipped regardless of phrase content
      - Policy version from the ruleset is embedded in the decision
    """

    _CONFIRMED = {"disclosure_confirmed": True}
    _UNCONFIRMED = {"disclosure_confirmed": False}

    def _make_ruleset(
        self,
        phrases=None,
        disclosure_enabled=True,
        escalation_enabled=True,
    ):
        return [
            {
                "rule_key": "REQUIRE_UPFRONT_DISCLOSURE",
                "rule_type": "builtin",
                "enabled": disclosure_enabled,
                "priority": 0,
                "params": {},
            },
            {
                "rule_key": "HUMAN_ESCALATION_REQUESTED",
                "rule_type": "phrase_match",
                "enabled": escalation_enabled,
                "priority": 1,
                "params": {"phrases": phrases if phrases is not None else []},
            },
        ]

    # ── Custom phrase list tests ──────────────────────────────────────────────

    def test_custom_phrase_triggers_escalate(self):
        """A phrase from the org's custom list must trigger escalation."""
        ruleset = self._make_ruleset(phrases=["supervisor", "billing dispute"])
        result = run_voice_policy(
            "I need to speak to a supervisor",
            self._CONFIRMED,
            ruleset=ruleset,
            policy_version="VOICE-POLICY-v99",
        )
        assert result["action"] == "escalate"
        assert result["reason_code"] == "HUMAN_ESCALATION_REQUESTED"

    def test_custom_policy_version_embedded_in_decision(self):
        """The policy_version in the decision must reflect the org's version string."""
        ruleset = self._make_ruleset(phrases=["supervisor"])
        result = run_voice_policy(
            "supervisor please",
            self._CONFIRMED,
            ruleset=ruleset,
            policy_version="VOICE-POLICY-v1780043501",
        )
        assert result["policy_version"] == "VOICE-POLICY-v1780043501"

    def test_hardcoded_phrase_not_in_custom_list_does_not_escalate(self):
        """
        A phrase from the hardcoded _ESCALATION_PHRASES that is NOT in the
        org's custom list must NOT trigger escalation in ruleset mode.
        This is the core authoritativeness test.
        """
        # "speak to a human" is in hardcoded defaults but NOT in this custom list
        ruleset = self._make_ruleset(phrases=["supervisor", "billing dispute"])
        result = run_voice_policy(
            "I want to speak to a human",
            self._CONFIRMED,
            ruleset=ruleset,
        )
        assert result["action"] == "allow", (
            "Hardcoded phrases must not fire in ruleset mode; "
            "only the org's custom phrases should be used."
        )

    @pytest.mark.parametrize("hardcoded_phrase", _ESCALATION_PHRASES)
    def test_none_of_the_hardcoded_phrases_fire_with_custom_empty_ruleset_phrases(
        self, hardcoded_phrase
    ):
        """
        In ruleset mode with a custom (non-empty custom list that doesn't include
        a legacy phrase), none of the legacy hardcoded phrases should escalate.
        """
        ruleset = self._make_ruleset(phrases=["unique-org-phrase-xyz"])
        result = run_voice_policy(hardcoded_phrase, self._CONFIRMED, ruleset=ruleset)
        assert result["action"] == "allow", (
            f"Hardcoded phrase '{hardcoded_phrase}' must not fire "
            f"when org has a custom list that excludes it."
        )

    # ── Empty phrase list tests ───────────────────────────────────────────────

    def test_empty_phrase_list_allows_all_transcripts(self):
        """
        Empty phrases in ruleset mode = no triggers configured → all transcripts
        pass (action=allow).  Must NOT fall back to hardcoded defaults.
        """
        ruleset = self._make_ruleset(phrases=[])
        result = run_voice_policy(
            "speak to a human",  # in hardcoded defaults
            self._CONFIRMED,
            ruleset=ruleset,
        )
        assert result["action"] == "allow", (
            "Empty phrase list must mean 'no triggers' not 'use hardcoded defaults'."
        )

    def test_empty_phrase_list_does_not_escalate_any_legacy_phrase(self):
        """Parametric check: every hardcoded phrase passes through on empty custom list."""
        ruleset = self._make_ruleset(phrases=[])
        for phrase in _ESCALATION_PHRASES:
            result = run_voice_policy(phrase, self._CONFIRMED, ruleset=ruleset)
            assert result["action"] == "allow", (
                f"'{phrase}' must not escalate when phrase list is empty."
            )

    # ── Disabled rule tests ───────────────────────────────────────────────────

    def test_disabled_escalation_rule_allows_trigger_phrase(self):
        """A disabled phrase_match rule must be skipped — trigger phrase passes through."""
        ruleset = self._make_ruleset(
            phrases=["supervisor"],
            escalation_enabled=False,
        )
        result = run_voice_policy("supervisor please", self._CONFIRMED, ruleset=ruleset)
        assert result["action"] == "allow"

    def test_disabled_disclosure_rule_skips_first_turn_requirement(self):
        """A disabled REQUIRE_UPFRONT_DISCLOSURE rule must not enforce disclosure."""
        ruleset = self._make_ruleset(
            phrases=["supervisor"],
            disclosure_enabled=False,
        )
        result = run_voice_policy("hello", self._UNCONFIRMED, ruleset=ruleset)
        # Disclosure rule is disabled; escalation rule phrases not triggered → allow
        assert result["action"] == "allow"

    def test_both_rules_disabled_always_allows(self):
        """With all rules disabled every transcript must be allowed."""
        ruleset = self._make_ruleset(
            phrases=["supervisor"],
            disclosure_enabled=False,
            escalation_enabled=False,
        )
        for text in ["", "speak to a human", "supervisor", "Hello how are you?"]:
            result = run_voice_policy(text, self._UNCONFIRMED, ruleset=ruleset)
            assert result["action"] == "allow", (
                f"All-disabled ruleset must allow '{text}'."
            )

    # ── Legacy path isolation ─────────────────────────────────────────────────

    def test_legacy_path_still_uses_hardcoded_defaults(self):
        """
        When called WITHOUT a ruleset (legacy path), hardcoded phrases must still
        trigger escalation — backward compat for callers that haven't migrated.
        """
        for phrase in _ESCALATION_PHRASES:
            result = run_voice_policy(phrase, self._CONFIRMED)  # no ruleset= arg
            assert result["action"] == "escalate", (
                f"Legacy path must still escalate on '{phrase}'."
            )

    def test_ruleset_none_and_ruleset_keyword_behave_identically(self):
        """Passing ruleset=None explicitly must fall through to the legacy path."""
        phrase = "speak to a human"
        legacy_result = run_voice_policy(phrase, self._CONFIRMED)
        explicit_none_result = run_voice_policy(phrase, self._CONFIRMED, ruleset=None)
        assert legacy_result["action"] == explicit_none_result["action"] == "escalate"
