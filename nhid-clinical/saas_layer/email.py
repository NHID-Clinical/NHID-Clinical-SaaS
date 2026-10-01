"""
email.py — the one place this product sends mail.

There is exactly one thing to send: a sign-in link. That narrowness is the
design. No template engine, no queue, no HTML builder, no unsubscribe
machinery — a link and the sentence explaining it.

Two backends
------------
``log``         writes the link to **stderr**, not to the application logger.
                The entire sign-in flow is therefore testable with no account,
                no domain and no network: run the API, POST an email address,
                read the link off the console, open it.

                Not the logger, because `log_redaction.py` rewrites any
                ``token=`` it sees to ``<redacted>`` — correctly, since a
                sign-in token in a log really is a credential. Routing the dev
                link through the logger produced a link with the token stripped
                out of it, which is a working security control defeating the
                one thing this backend exists to do. The fix is to stop asking
                the logger to carry a secret, not to weaken the redactor.

``resend`` /    an HTTPS call to that provider's send endpoint.
``postmark``

Why it fails closed
-------------------
With ``APP_ENV=production`` and no sender configured, ``verify_configured()``
raises and the gateway aborts startup — the same treatment ``ADMIN_PASS_HASH``
and ``CORS_ALLOWED_ORIGINS`` already get. A sign-in system that silently cannot
send mail is worse than one that refuses to boot: it looks healthy, accepts
every address, returns 202 to all of them, and locks every user out with no
error anywhere. Startup is the last moment this is cheap to notice.

The dev backend is not a fallback for production. Selecting it there is a
deliberate, logged choice (``EMAIL_BACKEND=log``) for a deployment that has not
yet bought a sending domain, and it means links go to the logs where anyone
with log access can use them.
"""
from __future__ import annotations

import logging
import os
import sys
from typing import Optional

_logger = logging.getLogger("nhid.saas.email")

# 10s: long enough for a provider's normal response, short enough that an
# outage costs the caller one round trip rather than a hung worker.
_TIMEOUT_SECONDS = 10.0


class EmailNotConfigured(RuntimeError):
    """Raised when a real backend is required and none is usable."""


class EmailSendFailed(RuntimeError):
    """Raised when the provider rejected or did not accept the message."""


def backend_name() -> str:
    """Which backend is selected. ``log`` unless EMAIL_BACKEND says otherwise."""
    return (os.environ.get("EMAIL_BACKEND") or "log").strip().lower()


def sender_address() -> str:
    return (os.environ.get("EMAIL_FROM") or "").strip()


def _api_key() -> str:
    return (os.environ.get("EMAIL_API_KEY") or "").strip()


def verify_configured(*, production: bool) -> None:
    """Check the configuration is coherent, or raise.

    Called once from the gateway's lifespan. Outside production a missing
    configuration selects the log backend and is fine; inside production it is
    fatal.
    """
    backend = backend_name()
    if backend not in ("log", "resend", "postmark"):
        raise EmailNotConfigured(
            f"EMAIL_BACKEND={backend!r} is not recognised. "
            "Use 'log' (development), 'resend' or 'postmark'."
        )

    if backend == "log":
        if production:
            raise EmailNotConfigured(
                "EMAIL_BACKEND is unset or 'log' in production. Sign-in links "
                "would be printed to the console instead of delivered, which "
                "means anyone who can read this service's output can sign in "
                "as anyone. Set EMAIL_BACKEND=resend (or postmark) with "
                "EMAIL_API_KEY and EMAIL_FROM. See docs/DEPLOYMENT.md."
            )
        _logger.info("EMAIL: backend=log — sign-in links print to stderr, not to an inbox")
        return

    missing = [name for name, value in (("EMAIL_API_KEY", _api_key()),
                                        ("EMAIL_FROM", sender_address())) if not value]
    if missing:
        raise EmailNotConfigured(
            f"EMAIL_BACKEND={backend} requires {' and '.join(missing)}."
        )
    _logger.info("EMAIL: backend=%s from=%s", backend, sender_address())


def send_login_link(to_email: str, link: str, *, org_name: Optional[str] = None) -> None:
    """Send one sign-in link. Raises on failure; never returns a status.

    The caller must not surface the outcome to the browser. Telling the client
    that delivery failed for this address and succeeded for that one is an
    account-enumeration oracle, which is precisely what the endpoint above it
    is built to avoid.
    """
    where = f" to {org_name}" if org_name else ""
    subject = "Your NHID-Clinical sign-in link"
    body = (
        f"Someone asked to sign in{where} with this address.\n\n"
        f"{link}\n\n"
        "The link works once and expires in 15 minutes.\n\n"
        "If this was not you, nothing has happened and you can ignore this "
        "message — the link cannot be used without opening it.\n"
    )

    backend = backend_name()
    if backend == "log":
        # The logger records that a link went out; it must not carry the link,
        # because `log_redaction.py` would strip the token from it and rightly
        # so. The link itself goes straight to stderr, unredacted, which is
        # safe only because production cannot select this backend at all --
        # `verify_configured()` aborts startup if it tries.
        _logger.info("EMAIL[log] issued a sign-in link to %s", to_email)
        # One line and complete: a developer has to copy this, and wrapping it
        # to look tidier breaks the copy in half the terminals it is read in.
        print(f"\n  [dev sign-in link for {to_email}]\n  {link}\n",
              file=sys.stderr, flush=True)
        return

    if backend == "resend":
        _send_resend(to_email, subject, body)
    elif backend == "postmark":
        _send_postmark(to_email, subject, body)
    else:
        raise EmailNotConfigured(f"EMAIL_BACKEND={backend!r} is not recognised.")


def _send_resend(to_email: str, subject: str, body: str) -> None:
    import httpx

    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {_api_key()}"},
            json={"from": sender_address(), "to": [to_email],
                  "subject": subject, "text": body},
            timeout=_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise EmailSendFailed(f"resend request failed: {exc}") from exc
    if response.status_code >= 300:
        # The address is not logged with the body: a provider error can quote
        # the recipient, and this log is read by more people than the mailbox.
        raise EmailSendFailed(f"resend returned {response.status_code}")


def _send_postmark(to_email: str, subject: str, body: str) -> None:
    import httpx

    try:
        response = httpx.post(
            "https://api.postmarkapp.com/email",
            headers={"X-Postmark-Server-Token": _api_key(),
                     "Accept": "application/json"},
            json={"From": sender_address(), "To": to_email,
                  "Subject": subject, "TextBody": body,
                  "MessageStream": os.environ.get("EMAIL_MESSAGE_STREAM", "outbound")},
            timeout=_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise EmailSendFailed(f"postmark request failed: {exc}") from exc
    if response.status_code >= 300:
        raise EmailSendFailed(f"postmark returned {response.status_code}")
