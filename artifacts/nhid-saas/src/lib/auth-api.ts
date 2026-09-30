/**
 * The human sign-in path, beside the organization API key.
 *
 * Two credentials reach this API and they are not interchangeable:
 *
 *   machine   X-API-Key header      ingest pipelines, scripts, CI
 *   human     session cookie        a person with /ops open in a browser
 *
 * The cookie is `httpOnly`, so nothing here can read it — which is the whole
 * point. The previous scheme kept an API key in `localStorage`, where any
 * script on the page could take it. A session this file cannot read is a
 * session an injected script cannot steal either.
 *
 * That means every call below carries `credentials: "include"`: the browser
 * attaches the cookie, not this code. Without it the cookie is silently
 * dropped on a cross-origin request, which is exactly the deployment shape
 * this product targets (`app.` calling `api.`).
 */
import { apiUrl } from "./config";

export type SessionUser = {
  user_id: string;
  email: string;
  last_seen_at?: number | null;
};

export type SessionOrg = {
  org_id: string;
  org_name: string;
  plan: string;
  status: string;
  role: "owner" | "member";
};

export type OrgMember = {
  user_id: string;
  email: string;
  role: "owner" | "member";
  created_at: number;
  last_seen_at: number | null;
};

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

async function authReq<T>(path: string, init: RequestInit = {},
                          apiKey?: string | null): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    // Load-bearing, not boilerplate: omit it and the session cookie never
    // leaves the browser on a cross-origin call, and every request reads as
    // signed-out for reasons nothing in the UI can explain.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* a non-JSON error body is still an error; the status carries it */
    }
    throw new AuthError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const authApi = {
  /** Ask for a sign-in link. Always succeeds, whatever was typed. */
  requestLink: (email: string) =>
    authReq<{ status: string; detail: string }>(
      "/saas/auth/request-link",
      { method: "POST", body: JSON.stringify({ email }) }),

  /** Redeem a link. The server sets the cookie; nothing is stored here. */
  verify: (token: string) =>
    authReq<{ user: SessionUser; orgs: SessionOrg[] }>(
      "/saas/auth/verify",
      { method: "POST", body: JSON.stringify({ token }) }),

  logout: () => authReq<{ status: string }>("/saas/auth/logout", { method: "POST" }),

  me: () => authReq<{ user: SessionUser; orgs: SessionOrg[] }>("/saas/auth/me"),

  listMembers: (apiKey: string) =>
    authReq<{ members: OrgMember[]; your_role: "owner" | "member" }>(
      "/saas/orgs/members", {}, apiKey),

  invite: (apiKey: string, email: string, role: "owner" | "member") =>
    authReq<{ user_id: string; email: string; role: string; invite_delivered: boolean }>(
      "/saas/orgs/members",
      { method: "POST", body: JSON.stringify({ email, role }) }, apiKey),

  removeMember: (apiKey: string, userId: string) =>
    authReq<{ status: string; user_id: string }>(
      `/saas/orgs/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" }, apiKey),
};
