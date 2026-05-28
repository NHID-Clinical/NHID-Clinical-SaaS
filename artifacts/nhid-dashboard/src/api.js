const BASE_URL = "/nhid-api";

function headers(apiKey) {
  const h = { "Content-Type": "application/json" };
  if (apiKey) h["x-api-key"] = apiKey;
  return h;
}

export async function signup({ email, password, orgName }) {
  const res = await fetch(`${BASE_URL}/signup`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, password, org_name: orgName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Signup failed");
  return data;
}

export async function login({ email, password }) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Login failed");
  return data;
}

export async function sendTrace({ apiKey, sessionId, event }) {
  const res = await fetch(`${BASE_URL}/trace`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ session_id: sessionId, event }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Trace failed");
  return data;
}

export async function getProof({ apiKey, sessionId }) {
  const res = await fetch(`${BASE_URL}/proof/${sessionId}`, {
    headers: headers(apiKey),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Proof retrieval failed");
  return data;
}
