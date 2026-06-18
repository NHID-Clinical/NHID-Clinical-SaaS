import { Switch, Route, Router as WouterRouter, Redirect, Link } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";

import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import Usage from "@/pages/usage";
import Trace from "@/pages/trace";
import Proof from "@/pages/proof";
import Billing from "@/pages/billing";
import AdminPage from "@/pages/admin";
import AuditPage from "@/pages/audit";
import TryPage from "@/pages/try";
import DocsSDKPage from "@/pages/docs-sdk";
import PricingPage from "@/pages/pricing";
import SettingsPage from "@/pages/settings";
import { useApiKey } from "@/hooks/use-nhid";
import { ApiError } from "@/lib/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
    },
  },
});

queryClient.getQueryCache().subscribe((event) => {
  if (event.type === "updated" && (event.action as any)?.type === "error") {
    const error = (event.action as any).error;
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      localStorage.removeItem("nhid_api_key");
      localStorage.removeItem("nhid_org");
      window.dispatchEvent(new Event("storage"));
    }
  }
});

function ProtectedRoute({ component: Component, ...rest }: any) {
  const apiKey = useApiKey();
  if (!apiKey) return <Redirect to="/" />;
  return <Component {...rest} />;
}

function Router() {
  return (
    <Switch>
      {/* Public pages — no auth required */}
      <Route path="/try" component={TryPage} />
      <Route path="/demo" component={TryPage} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/docs/sdk" component={DocsSDKPage} />

      {/* Admin portal — standalone, no shared layout, no auth gate */}
      <Route path="/admin" component={AdminPage} />

      {/* Standard app routes — gated per-route by API key via ProtectedRoute */}
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={Onboarding} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
            <Route path="/usage"><ProtectedRoute component={Usage} /></Route>
            <Route path="/trace"><ProtectedRoute component={Trace} /></Route>
            <Route path="/proof"><ProtectedRoute component={Proof} /></Route>
            <Route path="/audit"><ProtectedRoute component={AuditPage} /></Route>
            <Route path="/billing"><ProtectedRoute component={Billing} /></Route>
            <Route path="/settings"><ProtectedRoute component={SettingsPage} /></Route>
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
