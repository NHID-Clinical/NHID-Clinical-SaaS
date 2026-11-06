/**
 * Single sign-on from the sign-in page: a work email routes to the
 * organization's identity provider, a domain without SSO says so, and a
 * refused sign-in coming back from the provider is explained in words.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/config", async (orig) => ({ ...(await orig<object>()), API_CONNECTED: true }));
import SignIn from "./signin";

function renderPage(search = "") {
  window.history.replaceState({}, "", `/signin${search}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SignIn /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText(/work email/i), { target: { value } });
}

describe("single sign-on", () => {
  it("sends a domain with SSO to its identity provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ type: "opaqueredirect", status: 0, ok: false }) as Response));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "" });
    renderPage();
    typeEmail("dana@lakeside.example");
    fireEvent.click(screen.getByRole("button", { name: /single sign-on/i }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(String(assign.mock.calls[0][0])).toContain("/saas/auth/sso/start?email=dana%40lakeside.example");
  });

  it("says so when the domain has no SSO", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "sso_not_configured" }), { status: 404 })));
    renderPage();
    typeEmail("x@nosso.example");
    fireEvent.click(screen.getByRole("button", { name: /single sign-on/i }));
    expect(await screen.findByText(/isn.t set up for that email domain/i)).toBeTruthy();
  });

  it("explains a sign-in the provider sent back refused", () => {
    renderPage("?sso_error=domain_not_allowed");
    expect(screen.getByRole("alert").textContent).toMatch(/email domain is not allowed/i);
  });
});
