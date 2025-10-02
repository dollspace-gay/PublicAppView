import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardAuthGuard } from "@/components/dashboard-auth-guard";
import Dashboard from "@/pages/dashboard";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <DashboardAuthGuard>
          <Dashboard />
        </DashboardAuthGuard>
      </Route>
      <Route path="/firehose">
        <DashboardAuthGuard>
          <Dashboard />
        </DashboardAuthGuard>
      </Route>
      <Route path="/database">
        <DashboardAuthGuard>
          <Dashboard />
        </DashboardAuthGuard>
      </Route>
      <Route path="/api">
        <DashboardAuthGuard>
          <Dashboard />
        </DashboardAuthGuard>
      </Route>
      <Route path="/lexicons">
        <DashboardAuthGuard>
          <Dashboard />
        </DashboardAuthGuard>
      </Route>
      <Route path="/config">
        <DashboardAuthGuard>
          <Dashboard />
        </DashboardAuthGuard>
      </Route>
      <Route path="/logs">
        <DashboardAuthGuard>
          <Dashboard />
        </DashboardAuthGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
