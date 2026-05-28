#!/usr/bin/env bash
# start_frontend.sh — Start the NHID SaaS React Dashboard (port 3000)
# Consumes SaaS gateway only — no direct NHID core dependency.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/artifacts/nhid-saas"

cd "$FRONTEND_DIR"

echo "[nhid-frontend] Installing dependencies (if needed)..."
pnpm install --frozen-lockfile 2>/dev/null || npm install

echo "[nhid-frontend] Starting React frontend on port 3000..."
export PORT=3000
exec npx vite --host 0.0.0.0 --port 3000
