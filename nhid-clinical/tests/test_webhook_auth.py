"""Tests for webhook credential handling (Phase 0.2).

Covers:
  * header authentication is accepted and preferred
  * query-string authentication still works (migration window) but warns
  * the key never reaches log output
"""

import logging

import pytest

from saas_layer.log_redaction import (
    REDACTED,
    RedactingFilter,
    install_log_redaction,
    redact,
)

SECRET = "nhid_7f3a9c2e5b1d8a4f6c0e2b7d"


# ── Redaction ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "line",
    [
        f"GET /saas/voice/webhook/incoming?api_key={SECRET} HTTP/1.1 200",
        f"https://host/saas/voice/webhook/transcript?api_key={SECRET}&x=1",
        f"?apikey={SECRET}",
        f"token={SECRET}",
        f"password={SECRET}",
    ],
)
def test_sensitive_values_are_redacted(line):
    out = redact(line)
    assert SECRET not in out
    assert REDACTED in out


def test_redaction_preserves_non_sensitive_text():
    assert redact("GET /saas/health 200") == "GET /saas/health 200"
    assert redact("session_id=abc123") == "session_id=abc123"


def test_redaction_handles_empty_and_none_safely():
    assert redact("") == ""
    assert redact(None) is None


def test_filter_redacts_message_and_args(caplog):
    logger = logging.getLogger("test.redaction.msg")
    logger.addFilter(RedactingFilter())
    with caplog.at_level(logging.INFO, logger="test.redaction.msg"):
        logger.info("GET /webhook?api_key=%s 200", SECRET)
        logger.info(f"inline /webhook?api_key={SECRET}")
    combined = "\n".join(r.getMessage() for r in caplog.records)
    assert SECRET not in combined, "API key leaked into log output"
    assert REDACTED in combined


def test_install_is_idempotent():
    name = "test.redaction.idem"
    install_log_redaction([name])
    install_log_redaction([name])
    logger = logging.getLogger(name)
    assert sum(isinstance(f, RedactingFilter) for f in logger.filters) == 1


# ── Key resolution: header preferred, query deprecated ────────────────────────

@pytest.fixture
def resolve():
    from saas_layer.webhook_auth import resolve_webhook_api_key
    return resolve_webhook_api_key


def test_header_key_is_accepted(resolve):
    assert resolve(SECRET, None, "/ep") == SECRET


def test_query_key_still_accepted_for_migration(resolve):
    assert resolve(None, SECRET, "/ep") == SECRET


def test_header_takes_precedence_over_query(resolve):
    assert resolve("from-header", "from-query", "/ep") == "from-header"


def test_missing_key_raises_401(resolve):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        resolve(None, None, "/ep")
    assert exc.value.status_code == 401
    assert "X-NHID-API-Key" in exc.value.detail


def test_query_use_logs_deprecation_without_the_key(resolve, caplog):
    with caplog.at_level(logging.WARNING, logger="nhid.saas"):
        resolve(None, SECRET, "/saas/voice/webhook/incoming")
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "WEBHOOK_AUTH_DEPRECATED" in text
    assert "/saas/voice/webhook/incoming" in text
    assert SECRET not in text, "deprecation warning must not log the key"


def test_header_use_logs_no_deprecation(resolve, caplog):
    with caplog.at_level(logging.WARNING, logger="nhid.saas"):
        resolve(SECRET, None, "/ep")
    assert "WEBHOOK_AUTH_DEPRECATED" not in "\n".join(
        r.getMessage() for r in caplog.records
    )


def test_missing_key_error_does_not_echo_anything_supplied(resolve):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        resolve("", "", "/ep")
    assert SECRET not in str(exc.value.detail)
