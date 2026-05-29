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
from saas_layer.gateway import app, get_current_org, _voice_sessions

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
    """Clear in-memory voice sessions before and after every test."""
    _voice_sessions.clear()
    yield
    _voice_sessions.clear()


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

    def test_session_stored_in_memory(self, client):
        r = client.post("/saas/voice/incoming", json={})
        sid = r.json()["session_id"]
        assert sid in _voice_sessions
        assert _voice_sessions[sid]["disclosure_confirmed"] is False
        assert _voice_sessions[sid]["org_id"] == _FAKE_ORG["org_id"]

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
        assert len(_voice_sessions) == 0, "rolled-back session must not remain in memory"


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
        assert _voice_sessions[sid]["disclosure_confirmed"] is True

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
        assert _voice_sessions[sid]["escalated"] is True

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
