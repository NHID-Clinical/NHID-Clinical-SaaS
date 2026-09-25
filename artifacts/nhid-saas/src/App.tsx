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
import OpsOverview from "@/pages/ops/overview";
import OpsInteractions from "@/pages/ops/interactions";
import OpsInteractionDetail from "@/pages/ops/interaction-detail";
import { OpsFindings, OpsFindingDetail } from "@/pages/ops/findings";
import OpsEvidence from "@/pages/ops/evidence";
import OpsAssessments from "@/pages/ops/assessments";
import OpsReports from "@/pages/ops/reports";
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

            {/* Governance operations — the monitoring and evidence product.
                Deliberately not wrapped in ProtectedRoute, unlike every route
                above. These screens call useOpsKey(), which falls back to the
                recorded-demo sentinel when no organization key is held, and the
                client then serves committed synthetic output instead of calling
                the API. Redirecting a visitor with no key would send them to a
                registration form that cannot work without a backend, which is
                exactly the state the published build is in.

                This is not the authorization boundary and never was. The
                gateway authorizes every request on X-API-Key; ProtectedRoute is
                a client-side redirect, and with no key these screens can reach
                no server data at all -- only the fixture compiled into the
                bundle. The routes above keep the redirect because they have no
                recorded equivalent: billing, usage, settings and admin must
                never fall back to a demonstration. */}
            <Route path="/ops" component={OpsOverview} />
            <Route path="/ops/interactions" component={OpsInteractions} />
            <Route path="/ops/interactions/:id" component={OpsInteractionDetail} />
            <Route path="/ops/findings" component={OpsFindings} />
            <Route path="/ops/findings/:id" component={OpsFindingDetail} />
            <Route path="/ops/evidence" component={OpsEvidence} />
            <Route path="/ops/assessments" component={OpsAssessments} />
            <Route path="/ops/reports" component={OpsReports} />
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
