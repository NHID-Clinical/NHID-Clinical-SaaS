"""Security headers on every response, from the API and from the static app.

A security reviewer runs a header scanner before reading any code. Every API
response, error responses included, must carry:

  * Strict-Transport-Security, so a browser never falls back to plain HTTP;
  * X-Content-Type-Options: nosniff, and X-Frame-Options: DENY with the CSP
    `frame-ancestors 'none'`, so a response is never sniffed or framed;
  * a Content-Security-Policy that lets a JSON API load nothing;
  * Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy;
  * Cache-Control: no-store on /saas/ responses, because they can carry PHI
    and must not sit in a shared or browser cache.

The static frontend's headers live in render.yaml and are checked as config.
"""
from __future__ import annotations

import os
import sys

import pytest
import yaml
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer.gateway import app  # noqa: E402

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"
)

REQUIRED = {
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.parametrize("method,path", [
    ("GET", "/health"),
    ("GET", "/saas/monitor/findings"),        # 401: no credential
    ("GET", "/saas/no-such-route"),           # 404
    ("POST", "/saas/orgs/keys"),              # 401 on a mutating route
])
def test_every_response_carries_the_security_headers(client, method, path):
    resp = client.request(method, path)
    for name, value in REQUIRED.items():
        assert resp.headers.get(name) == value, (name, resp.headers.get(name))
    csp = resp.headers["content-security-policy"]
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "camera=()" in resp.headers["permissions-policy"]


def test_saas_responses_are_never_cached(client):
    resp = client.get("/saas/monitor/findings")
    assert resp.headers["cache-control"] == "no-store"


def test_the_static_app_sends_the_same_protections():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "render.yaml")
    with open(path, encoding="utf-8") as fh:
        blueprint = yaml.safe_load(fh)
    app_service = next(s for s in blueprint["services"] if s["name"] == "nhid-clinical-app")
    headers = {h["name"].lower(): h["value"] for h in app_service["headers"]}
    assert headers["strict-transport-security"].startswith("max-age=63072000")
    assert headers["x-frame-options"] == "DENY"
    assert headers["x-content-type-options"] == "nosniff"
    csp = headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    assert "script-src 'self'" in csp
    assert "permissions-policy" in headers
