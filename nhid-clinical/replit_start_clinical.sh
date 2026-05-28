#!/usr/bin/env bash
# Minimal startup glue — starts nhid-clinical app:app on port 8000.
# Does NOT modify any existing file. Run from repo root.
set -e
cd "$(dirname "$0")"
exec uvicorn app:app --host 0.0.0.0 --port 8000 --reload
