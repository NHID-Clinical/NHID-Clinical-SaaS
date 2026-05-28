#!/usr/bin/env bash
# start_saas.sh — Start the NHID Clinical SaaS Gateway (port 8010)
# Isolated from NHID core: wraps clinical engine, adds billing/auth/admin.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Required environment variables ──────────────────────────────────────────
# Set these before running in production:
#   STRIPE_SECRET_KEY        (from Stripe dashboard)
#   STRIPE_WEBHOOK_SECRET    (from Stripe webhook config)
#   ADMIN_USER               (admin portal username, default: admin)
#   ADMIN_PASS               (admin portal password)
#   NHID_BASE_URL            (URL of NHID core, default: http://localhost:8000)

export NHID_BASE_URL="${NHID_BASE_URL:-http://localhost:8000}"
export PORT="${PORT:-8010}"

echo "[nhid-saas] Starting SaaS Gateway on port $PORT..."
echo "[nhid-saas] NHID core target: $NHID_BASE_URL"
exec uvicorn saas_main:app --host 0.0.0.0 --port "$PORT"
