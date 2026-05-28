/**
 * replit_api_client.js
 *
 * Frontend helper for calling the NHID-Clinical Replit bridge.
 * Read-only. No mutation actions.
 *
 * BASE_URL is read from replit_config.json at import time, or falls back
 * to the default bridge port.
 */

let _baseUrl = "http://localhost:8001";

// Attempt to read BASE_URL from replit_config.json (Node/bundler environments).
// In a browser environment this is a no-op — the React app imports the config directly.
try {
  if (typeof require !== "undefined") {
    const cfg = require("./replit_config.json");
    if (cfg && cfg.API_BASE_URL) _baseUrl = cfg.API_BASE_URL;
  }
} catch (_) {
  // silent — browser environments don't support require
}

export const BASE_URL = _baseUrl;

/**
 * Internal fetch wrapper. Always returns parsed JSON.
 * Never throws — surfaces errors as { ok: false, error: string }.
 */
async function _get(path) {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}`, _status: res.status };
    }
    return data;
  } catch (err) {
    return { ok: false, error: err.message || "Network error" };
  }
}

/**
 * GET /health
 * Returns bridge + module status.
 */
export async function getHealth() {
  return _get("/health");
}

/**
 * GET /trace/{session_id}
 * Returns the full session trace from nhid_event_store.
 *
 * @param {string} sessionId
 */
export async function getTrace(sessionId) {
  if (!sessionId || !sessionId.trim()) {
    return { ok: false, error: "sessionId is required" };
  }
  return _get(`/trace/${encodeURIComponent(sessionId.trim())}`);
}

/**
 * GET /proof/{session_id}
 * Returns ordered event list + chain_valid flag for a session.
 *
 * @param {string} sessionId
 */
export async function getProof(sessionId) {
  if (!sessionId || !sessionId.trim()) {
    return { ok: false, error: "sessionId is required" };
  }
  return _get(`/proof/${encodeURIComponent(sessionId.trim())}`);
}

/**
 * GET /schema
 * Returns the nhid_trace_schema_v1.json contents verbatim.
 */
export async function getSchema() {
  return _get("/schema");
}
