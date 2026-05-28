import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

DB_PATH = "nhid_audit.db"

app = FastAPI(
    title="NHID Audit Core",
    description="Tamper-evident audit logging for AI/agent-driven healthcare workflows.",
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db()
    cursor = conn.cursor()
    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS agents (
            agent_id   TEXT PRIMARY KEY,
            provider_id TEXT,
            scope      TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tokens (
            token_id   TEXT PRIMARY KEY,
            agent_id   TEXT NOT NULL,
            scope      TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            issued_at  TEXT NOT NULL,
            FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
        );

        CREATE TABLE IF NOT EXISTS traces (
            trace_id   TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            agent_id   TEXT NOT NULL,
            event      TEXT NOT NULL,
            prev_hash  TEXT NOT NULL,
            curr_hash  TEXT NOT NULL,
            timestamp  TEXT NOT NULL
        );
        """
    )
    conn.commit()
    conn.close()


@app.on_event("startup")
def startup_event() -> None:
    init_db()


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

def compute_hash(prev_hash: str, event: dict, timestamp: str, agent_id: str) -> str:
    raw = prev_hash + json.dumps(event, sort_keys=True) + timestamp + agent_id
    return hashlib.sha256(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AgentIssueRequest(BaseModel):
    scope: list[str]
    provider_id: str | None = None


class AgentIssueResponse(BaseModel):
    agent_id: str
    token_id: str
    expires_at: str


class AuthVerifyRequest(BaseModel):
    agent_id: str
    token_id: str
    scope: str


class AuthVerifyResponse(BaseModel):
    authorized: bool
    reason: str | None = None


class TraceAppendRequest(BaseModel):
    session_id: str
    agent_id: str
    event: dict[str, Any]


class TraceAppendResponse(BaseModel):
    trace_id: str
    prev_hash: str
    curr_hash: str


class ProofEvent(BaseModel):
    trace_id: str
    event: dict[str, Any]
    timestamp: str
    hash: str


class ProofResponse(BaseModel):
    session_id: str
    valid_chain: bool
    events: list[ProofEvent]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/agent/issue", response_model=AgentIssueResponse, tags=["Agents"])
def issue_agent(body: AgentIssueRequest) -> AgentIssueResponse:
    """Create a new agent identity and issue an access token."""
    now = datetime.now(timezone.utc).isoformat()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

    agent_id = str(uuid.uuid4())
    token_id = str(uuid.uuid4())

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO agents (agent_id, provider_id, scope, created_at) VALUES (?, ?, ?, ?)",
            (agent_id, body.provider_id, json.dumps(body.scope), now),
        )
        conn.execute(
            "INSERT INTO tokens (token_id, agent_id, scope, expires_at, issued_at) VALUES (?, ?, ?, ?, ?)",
            (token_id, agent_id, json.dumps(body.scope), expires_at, now),
        )
        conn.commit()
    finally:
        conn.close()

    return AgentIssueResponse(agent_id=agent_id, token_id=token_id, expires_at=expires_at)


@app.post("/auth/verify", response_model=AuthVerifyResponse, tags=["Auth"])
def verify_auth(body: AuthVerifyRequest) -> AuthVerifyResponse:
    """Validate that a token exists, is unexpired, and covers the requested scope."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM tokens WHERE token_id = ? AND agent_id = ?",
            (body.token_id, body.agent_id),
        ).fetchone()

        if row is None:
            return AuthVerifyResponse(authorized=False, reason="Token not found for this agent")

        expires_at = datetime.fromisoformat(row["expires_at"])
        if datetime.now(timezone.utc) > expires_at:
            return AuthVerifyResponse(authorized=False, reason="Token has expired")

        token_scopes: list[str] = json.loads(row["scope"])
        if body.scope not in token_scopes:
            return AuthVerifyResponse(
                authorized=False,
                reason=f"Scope '{body.scope}' not permitted for this token",
            )
    finally:
        conn.close()

    return AuthVerifyResponse(authorized=True)


@app.post("/trace/append", response_model=TraceAppendResponse, tags=["Traces"])
def append_trace(body: TraceAppendRequest) -> TraceAppendResponse:
    """Append a new event to a session trace, chaining it to the previous hash."""
    conn = get_db()
    try:
        last_row = conn.execute(
            "SELECT curr_hash FROM traces WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1",
            (body.session_id,),
        ).fetchone()

        prev_hash = last_row["curr_hash"] if last_row else ("0" * 64)
        timestamp = datetime.now(timezone.utc).isoformat()
        curr_hash = compute_hash(prev_hash, body.event, timestamp, body.agent_id)
        trace_id = str(uuid.uuid4())

        conn.execute(
            "INSERT INTO traces (trace_id, session_id, agent_id, event, prev_hash, curr_hash, timestamp) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                trace_id,
                body.session_id,
                body.agent_id,
                json.dumps(body.event),
                prev_hash,
                curr_hash,
                timestamp,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return TraceAppendResponse(trace_id=trace_id, prev_hash=prev_hash, curr_hash=curr_hash)


@app.get("/proof/{session_id}", response_model=ProofResponse, tags=["Proof"])
def get_proof(session_id: str) -> ProofResponse:
    """Return the full ordered audit trail and verify hash-chain integrity."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM traces WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,),
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        raise HTTPException(status_code=404, detail=f"No traces found for session '{session_id}'")

    valid_chain = True
    events: list[ProofEvent] = []
    expected_prev = "0" * 64

    for row in rows:
        event_dict = json.loads(row["event"])
        stored_prev = row["prev_hash"]
        stored_curr = row["curr_hash"]
        recomputed = compute_hash(stored_prev, event_dict, row["timestamp"], row["agent_id"])

        if stored_prev != expected_prev or recomputed != stored_curr:
            valid_chain = False

        expected_prev = stored_curr
        events.append(
            ProofEvent(
                trace_id=row["trace_id"],
                event=event_dict,
                timestamp=row["timestamp"],
                hash=stored_curr,
            )
        )

    return ProofResponse(session_id=session_id, valid_chain=valid_chain, events=events)
