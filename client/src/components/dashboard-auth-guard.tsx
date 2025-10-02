import { useEffect, useState } from "react";
import { useLocation } from "wouter";

interface AuthGuardProps {
  children: React.ReactNode;
}

export function DashboardAuthGuard({ children }: AuthGuardProps) {
  const [, setLocation] = useLocation();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const checkResponse = await fetch("/api/dashboard/check-auth");
      const checkData = await checkResponse.json();

      if (!checkData.authRequired) {
        setIsAuthenticated(true);
        setIsChecking(false);
        return;
      }

      const token = localStorage.getItem("dashboard_token");
      
      if (!token) {
        setLocation("/login");
        return;
      }

      const metricsResponse = await fetch("/api/metrics", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (metricsResponse.status === 401) {
        localStorage.removeItem("dashboard_token");
        setLocation("/login");
        return;
      }

      setIsAuthenticated(true);
    } catch (error) {
      console.error("Auth check failed:", error);
      setLocation("/login");
    } finally {
      setIsChecking(false);
    }
  };

  if (isChecking) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
