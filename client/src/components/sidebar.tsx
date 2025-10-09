import { Link, useLocation } from "wouter";
import { Activity, Database, Terminal, Settings, FileText, Zap, BookOpen, Shield, AlertTriangle, User, LogIn, LogOut } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface InstancePolicy {
  enabled: boolean;
  jurisdiction: string;
  legalContact: string;
  labelerDid: string;
  labels: Array<{
    value: string;
    severity: string;
    reason: string;
    description: string;
  }>;
  autoModeration: {
    enabled: boolean;
    reportThreshold: number;
  };
}

export function Sidebar() {
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: policy } = useQuery<InstancePolicy>({
    queryKey: ['/api/instance/policy'],
  });

  const { data: session, isLoading: isSessionLoading } = useQuery<{ isAdmin?: boolean }>({
    queryKey: ['/api/auth/session'],
    retry: false,
  });

  const isAuthenticated = !isSessionLoading && session !== undefined;

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/api/auth/logout', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/session'] });
      window.location.href = '/';
    },
    onError: (error: Error) => {
      toast({
        title: "Logout Failed",
        description: error.message || "Failed to logout",
        variant: "destructive",
      });
    },
  });

  const allNavItems = [
    { path: "/", icon: Activity, label: "Overview" },
    { path: "/firehose", icon: Zap, label: "Firehose Monitor" },
    { path: "/database", icon: Database, label: "Database Schema" },
    { path: "/api", icon: Terminal, label: "API Endpoints" },
    { path: "/lexicons", icon: BookOpen, label: "Lexicon Validator" },
    { path: "/logs", icon: FileText, label: "Logs & Analytics" },
    { path: "/policy", icon: Shield, label: "Instance Policy" },
    { path: "/login", icon: LogIn, label: "Login", authHidden: true },
    { path: "/admin/moderation", icon: Shield, label: "Admin Control Panel", adminOnly: true, requiresAuth: true },
    { path: "/user/panel", icon: User, label: "User Data Panel", requiresAuth: true },
  ];

  const navItems = allNavItems.filter(item => {
    if (item.authHidden && isAuthenticated) return false;
    if (item.requiresAuth && !isAuthenticated) return false;
    if (item.adminOnly && !session?.isAdmin) return false;
    return true;
  });

  // Check if using default/unedited config
  const isDefaultConfig = policy?.legalContact === 'legal@example.com' || 
                          policy?.jurisdiction === 'US' && policy?.legalContact === 'legal@example.com';

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col shadow-xl">
      <div className="px-8 py-4 border-b border-border h-[73px] flex items-center">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center shadow-lg">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground leading-tight">App View</h1>
            <p className="text-xs text-muted-foreground font-mono leading-tight">Dashboard</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path;
          const showWarning = item.path === '/policy' && isDefaultConfig;
          
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={`flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-center space-x-3">
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </div>
                {showWarning && (
                  <div title="Using default configuration">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border bg-muted/30 space-y-3">
        {isAuthenticated && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="w-full"
            data-testid="button-sidebar-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            {logoutMutation.isPending ? "Logging out..." : "Logout"}
          </Button>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">Status: Active</span>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-success rounded-full animate-pulse shadow-sm"></div>
            <span>Live</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
