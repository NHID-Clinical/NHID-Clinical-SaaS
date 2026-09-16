"""
log_redaction.py — keep credentials out of log output.

The voice webhooks historically authenticated via `?api_key=<key>` in the URL.
Query strings are logged by default in several places that are easy to forget:

  * uvicorn's access log (`GET /saas/voice/webhook/incoming?api_key=... 200`)
  * reverse proxies and load balancers
  * anything that logs `request.url`

`install_log_redaction()` attaches a filter to the root logger and to the
uvicorn access logger so that credential-bearing query parameters are rewritten
to `<redacted>` before a record is emitted. This is defence in depth, not a
substitute for moving the credential into a header — it cannot reach logs
written by infrastructure outside this process.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable

# Query parameters whose values must never appear in logs.
SENSITIVE_PARAMS = ("api_key", "apikey", "token", "access_token", "secret", "password")

_PATTERN = re.compile(
    r"(?i)\b(" + "|".join(re.escape(p) for p in SENSITIVE_PARAMS) + r")=([^&\s\"'}\]]+)"
)

REDACTED = "<redacted>"


def redact(text: str) -> str:
    """Replace sensitive query-parameter values in an arbitrary string."""
    if not text:
        return text
    return _PATTERN.sub(lambda m: f"{m.group(1)}={REDACTED}", text)


class RedactingFilter(logging.Filter):
    """Rewrites credential-bearing values in a record's message and args."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            # Render the message first, then redact, then clear args. Redacting
            # the format string directly would strip "%s" placeholders out of
            # e.g. "api_key=%s" while leaving record.args populated, which makes
            # getMessage() raise "not all arguments converted".
            rendered = record.getMessage()
            cleaned = redact(rendered)
            if cleaned != rendered:
                record.msg = cleaned
                record.args = ()
        except Exception:
            # Logging must never raise. A failure to redact is preferable to a
            # crash, but should not happen for the shapes handled above.
            pass
        return True


_DEFAULT_LOGGERS: tuple[str, ...] = (
    "",                      # root — covers application logging
    "uvicorn.access",        # request lines, where the query string appears
    "uvicorn.error",
    "gunicorn.access",
)


def install_log_redaction(logger_names: Iterable[str] | None = None) -> None:
    """Attach the redacting filter to the loggers that see request URLs.

    Idempotent: calling it more than once will not stack duplicate filters.
    """
    for name in (logger_names if logger_names is not None else _DEFAULT_LOGGERS):
        logger = logging.getLogger(name)
        if not any(isinstance(f, RedactingFilter) for f in logger.filters):
            logger.addFilter(RedactingFilter())
        # Handlers filter independently of the logger they are attached to, so
        # the filter has to be installed on both to cover every emission path.
        for handler in logger.handlers:
            if not any(isinstance(f, RedactingFilter) for f in handler.filters):
                handler.addFilter(RedactingFilter())
