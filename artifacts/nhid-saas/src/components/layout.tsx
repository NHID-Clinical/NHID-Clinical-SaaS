import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Shield, Search } from "lucide-react";
import { useApiKey } from "@/hooks/use-nhid";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const apiKey = useApiKey();

  if (!apiKey) {
    return <>{children}</>;
  }

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Usage", href: "/usage", icon: Activity },
    { name: "Trace", href: "/trace", icon: Shield },
    { name: "Proof", href: "/proof", icon: Search },
  ];

  return (
    <div className="flex min-h-[100dvh] w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold tracking-tighter">
            NH
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight leading-tight">NHID Clinical</h1>
            <p className="text-xs text-muted-foreground font-mono">Control Plane</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive 
                    ? "bg-primary/10 text-primary font-medium" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                data-testid={`nav-${item.name.toLowerCase()}`}
              >
                <Icon className="w-4 h-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            System Operational
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card flex items-center px-6 sticky top-0 z-10">
          <div className="flex-1" />
          <div className="flex items-center gap-4">
             <div className="text-xs font-mono text-muted-foreground truncate w-48 text-right">
               {apiKey ? `Key: ...${apiKey.slice(-6)}` : 'No Key'}
             </div>
          </div>
        </header>
        <div className="flex-1 p-6 md:p-10 max-w-7xl mx-auto w-full overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
