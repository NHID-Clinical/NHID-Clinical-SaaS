"""
nhid_sdk.py — NHID-Clinical Python SDK
Zero-dependency client for the NHID-Clinical SaaS API.
Requires only Python standard library (urllib, json, uuid).

Usage:
    from nhid_sdk import NHIDClient, NHIDError

    client = NHIDClient(api_key="nhid_...", base_url="https://your-domain.replit.app/saas-api")

    session_id = client.create_session()

    client.send_event(session_id, {
        "event_type": "AGENT_ACTION",
        "state_before": "IDLE",
        "state_after": "RUNNING",
        "input_text": "User asked about medication dosage",
        "policy_action": "allow",
    })

    client.send_event(session_id, {
        "event_type": "POLICY_CHECK",
        "state_before": "RUNNING",
        "state_after": "IDLE",
        "policy_action": "escalate",
        "reason_code": "HUMAN_ESCALATION_REQUESTED",
        "response_text": "Transferring to a human agent",
    })

    proof = client.get_proof(session_id)
    print(f"Chain valid: {proof['valid_chain']}  Events: {proof['event_count']}")

    is_intact = client.verify_chain(session_id)
    print(f"Audit chain intact: {is_intact}")
"""

import json
import uuid
from typing import Any, Dict, Optional
from urllib import request as _urllib_request
from urllib.error import HTTPError


class NHIDError(Exception):
    """Raised when the NHID API returns a non-2xx response."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"NHID API error {status}: {detail}")
        self.status = status
        self.detail = detail


class NHIDClient:
    """
    Minimal HTTP client for the NHID-Clinical SaaS API.

    Parameters
    ----------
    api_key : str
        Your organisation's API key (find it in the NHID dashboard).
    base_url : str
        Base URL of your NHID-Clinical deployment, ending with /saas-api.
        Defaults to the Replit-hosted demo instance.
    timeout : int
        HTTP request timeout in seconds (default 15).
    """

    DEFAULT_BASE = "https://nhid-clinical.replit.app/saas-api"

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE,
        timeout: int = 15,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ── Internal HTTP helper ──────────────────────────────────────────────────

    def _call(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = _urllib_request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "X-API-Key": self.api_key,
                "Accept": "application/json",
            },
        )
        try:
            with _urllib_request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("detail", exc.reason)
            except Exception:
                detail = exc.reason
            raise NHIDError(exc.code, str(detail)) from exc

    # ── Public SDK methods ────────────────────────────────────────────────────

    def create_session(self) -> str:
        """
        Generate a new session ID (UUID v4).

        Sessions in NHID are implicit — they are created the first time an
        event is written with a given session_id.  This method returns a
        fresh UUID you should use for all subsequent send_event() calls in
        one logical interaction.

        Returns
        -------
        str
            A UUID v4 string, e.g. ``"3f1a2b4c-..."``.
        """
        return str(uuid.uuid4())

    def send_event(
        self,
        session_id: str,
        event_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Append a tamper-evident event to a session trace.

        Parameters
        ----------
        session_id : str
            Session identifier returned by :meth:`create_session`.
        event_data : dict
            Event fields.  Required keys:

            - ``event_type`` (str) — e.g. ``"AGENT_ACTION"``, ``"POLICY_CHECK"``
            - ``state_before`` (str) — agent state before this event
            - ``state_after`` (str) — agent state after this event

            Optional keys:

            - ``input_text`` (str) — user prompt or agent input
            - ``policy_action`` (str) — ``"allow"``, ``"escalate"``, ``"block"``
            - ``reason_code`` (str) — e.g. ``"HUMAN_ESCALATION_REQUESTED"``
            - ``response_text`` (str) — agent response
            - ``request_id`` (str) — idempotency key (auto-generated if omitted)

        Returns
        -------
        dict
            Response with ``session_id``, ``event_hash``, ``seq_num``.

        Raises
        ------
        NHIDError
            If the API returns a non-2xx response (e.g. 429 rate-limit).
        """
        payload = {"session_id": session_id, **event_data}
        return self._call("POST", "/saas/trace", payload)

    def get_proof(self, session_id: str) -> Dict[str, Any]:
        """
        Retrieve the full ordered audit trail for a session.

        Parameters
        ----------
        session_id : str
            The session to retrieve.

        Returns
        -------
        dict
            Response with:

            - ``session_id`` (str)
            - ``valid_chain`` (bool) — ``True`` if no tampering detected
            - ``event_count`` (int)
            - ``trace`` (dict) — ``{"events": [...]}``

        Raises
        ------
        NHIDError
            On 404 (unknown session) or 5xx server errors.
        """
        return self._call("GET", f"/saas/proof/{session_id}")

    def verify_chain(self, session_id: str) -> bool:
        """
        Verify cryptographic chain integrity for a session.

        Calls :meth:`get_proof` and returns the ``valid_chain`` flag.

        Returns
        -------
        bool
            ``True`` if every event's hash links correctly to the next.

        Raises
        ------
        NHIDError
            On API failure (session not found, service error, etc.).
        """
        proof = self.get_proof(session_id)
        return bool(proof.get("valid_chain", False))

    # ── Voice webhook helpers ─────────────────────────────────────────────────

    def voice_incoming(
        self,
        payload: Dict[str, Any],
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Register an incoming voice call with NHID policy enforcement.

        Sends the raw provider payload to ``POST /saas/voice/webhook/incoming``.
        Provider format is auto-detected (Retell AI, Vapi, Twilio, Generic).

        Parameters
        ----------
        payload : dict
            Raw webhook body from your voice provider.
        api_key : str, optional
            Override the org API key for the query-param auth used by webhooks.
            Falls back to ``self.api_key``.

        Returns
        -------
        dict
            Response with ``session_id``, ``provider``, ``action``,
            ``disclosure_text``.
        """
        key = api_key or self.api_key
        return self._call("POST", f"/saas/voice/webhook/incoming?api_key={key}", payload)

    def voice_transcript(
        self,
        payload: Dict[str, Any],
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Submit a transcript turn for policy evaluation and audit logging.

        Parameters
        ----------
        payload : dict
            Raw transcript webhook body from your voice provider.
        api_key : str, optional
            Override the org API key for query-param auth.

        Returns
        -------
        dict
            Response with ``action``, ``reason_code``, ``event_hash``.
        """
        key = api_key or self.api_key
        return self._call("POST", f"/saas/voice/webhook/transcript?api_key={key}", payload)
