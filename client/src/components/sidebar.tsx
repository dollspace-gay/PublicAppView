import { Link, useLocation } from "wouter";
import { Activity, Database, Terminal, Settings, FileText, Zap, BookOpen } from "lucide-react";

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { path: "/", icon: Activity, label: "Overview" },
    { path: "/firehose", icon: Zap, label: "Firehose Monitor" },
    { path: "/database", icon: Database, label: "Database Schema" },
    { path: "/api", icon: Terminal, label: "API Endpoints" },
    { path: "/lexicons", icon: BookOpen, label: "Lexicon Validator" },
    { path: "/logs", icon: FileText, label: "Logs & Analytics" },
  ];

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">AT App View</h1>
            <p className="text-xs text-muted-foreground font-mono">v1.0.0</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path;
          
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={`flex items-center space-x-3 px-4 py-3 rounded-lg font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">Status: Active</span>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
            <span>Connected</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
