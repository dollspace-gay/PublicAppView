import { Switch, Route } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Dashboard from '@/pages/dashboard';
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import InstancePolicy from '@/pages/instance-policy';
import AdminModeration from '@/pages/admin-moderation';
import UserPanel from '@/pages/user-panel';

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/firehose" component={Dashboard} />
      <Route path="/database" component={Dashboard} />
      <Route path="/api" component={Dashboard} />
      <Route path="/lexicons" component={Dashboard} />
      <Route path="/logs" component={Dashboard} />
      <Route path="/policy" component={InstancePolicy} />
      <Route path="/login" component={Login} />
      <Route path="/admin/moderation" component={AdminModeration} />
      <Route path="/user/panel" component={UserPanel} />
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
