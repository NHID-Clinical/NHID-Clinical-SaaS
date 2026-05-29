"""
saas_layer/db.py — Shared PostgreSQL connection for all NHID SaaS layer modules.

All modules import get_conn() from here. Never import sqlite3 in the saas_layer.
DATABASE_URL is injected by Replit's managed PostgreSQL (persistent across restarts).
"""
import os
import psycopg2
import psycopg2.extras


def get_conn() -> psycopg2.extensions.connection:
    """
    Return a new psycopg2 connection with RealDictCursor as default cursor factory.
    Caller must close the connection.

    Usage pattern (write):
        conn = get_conn()
        try:
            with conn:          # auto-commit on exit, rollback on exception
                cur = conn.cursor()
                cur.execute("INSERT ...", (val,))
        finally:
            conn.close()

    Usage pattern (read):
        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute("SELECT ...", (val,))
            return cur.fetchone()  # returns RealDictRow (acts like dict)
        finally:
            conn.close()
    """
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Replit PostgreSQL must be provisioned."
        )
    return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
