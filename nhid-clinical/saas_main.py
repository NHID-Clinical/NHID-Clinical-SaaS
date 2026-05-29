"""
NHID-Clinical SaaS entrypoint.
Starts the SaaS gateway on the port specified by $PORT (default 8010).
NHID core (app.py) continues to run separately on port 8000 — untouched.
"""
import os
import sys

# Ensure nhid-clinical/ is importable
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import uvicorn
from saas_layer.gateway import app  # noqa: F401 — re-exported for uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8010))
    is_dev = os.environ.get("NODE_ENV") != "production" and os.environ.get("REPLIT_DEPLOYMENT") != "1"
    uvicorn.run("saas_main:app", host="0.0.0.0", port=port, reload=is_dev)
