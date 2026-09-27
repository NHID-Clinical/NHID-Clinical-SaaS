/**
 * Where the API lives.
 *
 * This is the single place the frontend decides how to reach the backend.
 * Before it existed, `"/saas-api"` was written into two API clients and eight
 * further call sites, which encoded an assumption that the frontend and the API
 * share an origin. They do in local development, because the Vite dev server
 * proxies `/saas-api` to `localhost:8010`. They do not in the target
 * deployment, where the frontend is a static site and the API is a separate
 * service on its own hostname -- so every one of those call sites would have
 * resolved against the static host and found nothing.
 *
 * Set `VITE_API_BASE_URL` at build time to an absolute origin, with no trailing
 * slash:
 *
 *     VITE_API_BASE_URL=https://api.nhid-clinical.org
 *
 * Vite inlines `import.meta.env.*` at build time, so this is baked into the
 * bundle. It is a build input, not a runtime setting: changing it means
 * rebuilding, which is why it belongs in the deploy configuration rather than
 * in a secret store. It is also not a secret -- it is a public URL that every
 * visitor's browser can see.
 *
 * Unset, it falls back to `/saas-api`, which is correct for `npm run dev` and
 * is what the whole frontend did before.
 */

const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

/** Origin (or path prefix) every API call is built from. Never ends in "/". */
export const API_BASE_URL = configured ? configured.replace(/\/+$/, "") : "/saas-api";

/** True when talking to a different origin, i.e. the request is cross-origin. */
export const IS_CROSS_ORIGIN_API = /^https?:\/\//i.test(API_BASE_URL);

/**
 * Build a full API URL from a root-relative path.
 *
 *     apiUrl("/saas/orgs/me")     -> "/saas-api/saas/orgs/me"           (dev)
 *     apiUrl("/saas/orgs/me")     -> "https://api.…/saas/orgs/me"       (prod)
 *
 * The backend accepts both prefixed and unprefixed paths (its
 * `_strip_path_prefix` middleware), so the same path works either way.
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * A one-line description of the API target, for the settings screen and for
 * diagnosing "why does nothing load" without opening the network tab.
 */
export function describeApiTarget(): string {
  return IS_CROSS_ORIGIN_API
    ? API_BASE_URL
    : `${API_BASE_URL} (same origin, via the dev proxy)`;
}
