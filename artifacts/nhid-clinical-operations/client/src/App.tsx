import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import {
  CalendarWorkspace,
  CertificationWorkspace,
  IntelligenceWorkspace,
  SettingsWorkspace,
} from "./pages/ManagementWorkspaces";
import CertificationPersisted from "./pages/CertificationPersisted";
import EvaluationPersisted from "./pages/EvaluationPersisted";
import CalendarDetail from "./pages/CalendarDetail";
import KnowledgePersisted from "./pages/KnowledgePersisted";
import ProfileSettings from "./pages/ProfileSettings";
import EmailPersisted from "./pages/EmailPersisted";
import CampaignManager from "./pages/CampaignManager";
import TemplateManager from "./pages/TemplateManager";
import MatrixManager from "./pages/MatrixManager";
import PartnerRecords from "./pages/PartnerRecords";
import PartnerEvidence from "./pages/PartnerEvidence";
import PublicIntake from "./pages/PublicIntake";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/apply"} component={PublicIntake} />
      <Route path={"/partners"} component={Home} />
      <Route path={"/partners/records"} component={PartnerRecords} />
      <Route path={"/partners/evidence"} component={PartnerEvidence} />
      <Route path={"/email"} component={EmailPersisted} />
      <Route path={"/email/campaigns"} component={CampaignManager} />
      <Route path={"/email/templates"} component={TemplateManager} />
      <Route path={"/knowledge"} component={KnowledgePersisted} />
      <Route path={"/evaluations"} component={EvaluationPersisted} />
      <Route path={"/certification"} component={CertificationPersisted} />
      <Route path={"/calendar"} component={CalendarDetail} />
      <Route path={"/intelligence"} component={IntelligenceWorkspace} />
      <Route path={"/intelligence/matrix"} component={MatrixManager} />
      <Route path={"/settings"} component={SettingsWorkspace} />
      <Route path={"/settings/profile"} component={ProfileSettings} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
