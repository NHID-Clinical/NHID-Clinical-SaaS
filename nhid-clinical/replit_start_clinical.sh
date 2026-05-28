#!/usr/bin/env bash
# Minimal startup glue — starts nhid-clinical app:app on port 8002.
# Port 8000 is reserved for NHID Audit Core; this avoids conflicts.
# Does NOT modify any existing file. Run from repo root.
set -e
cd "$(dirname "$0")"
exec uvicorn app:app --host 0.0.0.0 --port 8002 --reload
