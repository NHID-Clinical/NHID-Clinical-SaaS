import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import Usage from "@/pages/usage";
import Trace from "@/pages/trace";
import Proof from "@/pages/proof";
import AdminPage from "@/pages/admin";
import { useApiKey } from "@/hooks/use-nhid";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, ...rest }: any) {
  const apiKey = useApiKey();
  
  if (!apiKey) {
    return <Redirect to="/" />;
  }
  
  return <Component {...rest} />;
}

function Router() {
  return (
    <Switch>
      {/* Admin portal — standalone, no shared layout, not in nav */}
      <Route path="/admin" component={AdminPage} />

      {/* Standard app routes */}
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={Onboarding} />
            <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
            <Route path="/usage"><ProtectedRoute component={Usage} /></Route>
            <Route path="/trace"><ProtectedRoute component={Trace} /></Route>
            <Route path="/proof"><ProtectedRoute component={Proof} /></Route>
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
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
