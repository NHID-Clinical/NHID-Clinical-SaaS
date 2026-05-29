import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { useAuth } from "@workspace/replit-auth-web";

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

function LoginScreen() {
  const { login } = useAuth();
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#070c17",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
        padding: "2rem",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 24px rgba(0,194,168,0.5)",
          fontFamily: "'Raleway', sans-serif",
          fontWeight: 900,
          fontSize: 26,
          color: "#070c17",
          letterSpacing: "-0.02em",
          marginBottom: "1.5rem",
        }}
      >
        N
      </div>

      <h1
        style={{
          color: "#f1f5f9",
          fontSize: "1.6rem",
          fontWeight: 700,
          margin: "0 0 0.5rem",
          letterSpacing: "-0.02em",
        }}
      >
        NHID Clinical
      </h1>
      <p
        style={{
          color: "#64748b",
          fontSize: "0.95rem",
          margin: "0 0 2.5rem",
          textAlign: "center",
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        Tamper-evident audit logging for AI-driven healthcare workflows.
      </p>

      <button
        onClick={login}
        style={{
          background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
          color: "#070c17",
          border: "none",
          borderRadius: 10,
          padding: "0.75rem 2rem",
          fontSize: "0.95rem",
          fontWeight: 700,
          cursor: "pointer",
          letterSpacing: "-0.01em",
          boxShadow: "0 0 16px rgba(0,194,168,0.35)",
          transition: "opacity 0.15s",
        }}
        onMouseOver={(e) => (e.currentTarget.style.opacity = "0.85")}
        onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
      >
        Log in to continue
      </button>

      <p
        style={{
          color: "#334155",
          fontSize: "0.8rem",
          marginTop: "2rem",
        }}
      >
        Secure single sign-on
      </p>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#070c17",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 16px rgba(0,194,168,0.4)",
          fontFamily: "'Raleway', sans-serif",
          fontWeight: 900,
          fontSize: 19,
          color: "#070c17",
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      >
        N
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <LoginScreen />;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      {/* Admin portal — standalone, no shared layout, no auth gate */}
      <Route path="/admin" component={AdminPage} />

      {/* Standard app routes — all behind Replit Auth */}
      <Route>
        <AuthGate>
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
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </AuthGate>
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
