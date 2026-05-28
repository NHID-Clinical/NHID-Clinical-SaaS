#!/usr/bin/env bash
# start_nhid.sh — Start the NHID Clinical Core (port 8000)
# DO NOT MODIFY: core files (app.py, nhid_engine, nhid_policy, nhid_event_store, tests/) are read-only.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[nhid-core] Starting NHID Clinical Core on port 8000..."
exec uvicorn app:app --host 0.0.0.0 --port 8000
