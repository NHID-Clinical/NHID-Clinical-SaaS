---
name: NHID core constraint
description: Which files in nhid-clinical/ are read-only and what the allowed exceptions are.
---

The following files in `nhid-clinical/` must NOT be modified (cloned read-only repo):
- `app.py` (exception: two targeted patches for CallSid validation + GET/POST replay)
- `nhid_engine.py`
- `nhid_policy.py`
- `nhid_event_store.py`
- `tests/` directory
- `src/`, `schema/`, `pytest.ini`, `requirements.txt`, `twilio_helper.py`, `llm.py`

Allowed: any NEW file added alongside the existing ones (e.g. `saas_layer/`, `saas_main.py`, `replit_backend_bridge.py`, `replit_start_clinical.sh`, `replit_dashboard/`).

**Why:** nhid-clinical is a cloned external repo. Keeping core files untouched preserves the 43-test pass rate and clean separation between the audit product and the SaaS wrapper.
