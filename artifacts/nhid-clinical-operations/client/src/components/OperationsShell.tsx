import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  Megaphone,
  ChevronRight,
  ClipboardCheck,
  Compass,
  FileUp,
  TableProperties,
  LayoutDashboard,
  Loader2,
  Mail,
  Menu,
  PanelLeft,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const navigation = [
  { label: "Command center", path: "/", icon: LayoutDashboard },
  { label: "Shadow Pilot CRM", path: "/partners", icon: UsersRound },
  { label: "Partner records", path: "/partners/records", icon: Activity },
  { label: "Pilot evidence", path: "/partners/evidence", icon: FileUp },
  { label: "Email command", path: "/email", icon: Mail, badge: "4" },
  { label: "Response templates", path: "/email/templates", icon: Mail },
  { label: "Campaign drafts", path: "/email/campaigns", icon: Megaphone },
  { label: "Knowledge base", path: "/knowledge", icon: BookOpen },
  { label: "Call evaluations", path: "/evaluations", icon: ClipboardCheck },
  { label: "Certification", path: "/certification", icon: ShieldCheck },
  { label: "Content calendar", path: "/calendar", icon: CalendarDays },
  { label: "Intelligence", path: "/intelligence", icon: Compass },
  {
    label: "Comparison matrix",
    path: "/intelligence/matrix",
    icon: TableProperties,
  },
  { label: "Settings", path: "/settings", icon: Settings },
  { label: "My profile", path: "/settings/profile", icon: UserRound },
];

export function OperationsShell({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const navigateTo = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };
  const runSharedAction = () => {
    setIsRefreshing(true);
    window.setTimeout(() => {
      setIsRefreshing(false);
      toast.success("Workspace activity refreshed");
    }, 650);
  };

  return (
    <div className="min-h-screen bg-[#07131f] text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r border-white/8 bg-[#091826] lg:flex">
        <div className="flex h-[84px] items-center gap-3 border-b border-white/8 px-6">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#2dd4bf] text-[#07212b] shadow-[0_0_26px_rgba(45,212,191,.26)]">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-white">
              SHADOW PILOT
            </p>
            <p className="text-[10px] font-medium uppercase tracking-[.2em] text-[#71e5d3]">
              Operations CRM
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">
            Workspace
          </p>
          {navigation.map(item => {
            const active =
              item.path === "/"
                ? location === "/"
                : location.startsWith(item.path);
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigateTo(item.path)}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                  active
                    ? "bg-[#1e3a5f] text-white shadow-[inset_3px_0_0_#2dd4bf]"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${active ? "text-[#2dd4bf]" : "text-slate-500 group-hover:text-slate-300"}`}
                />
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="rounded-full bg-[#2dd4bf]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#65e6d2]">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/8 p-4">
          <div className="rounded-xl border border-[#2dd4bf]/15 bg-[#0c2132] p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[#98f3e3]">
              <BarChart3 className="h-3.5 w-3.5" /> Shadow Pilot readiness
            </div>
            <div className="mt-2 flex items-end justify-between">
              <span className="text-2xl font-semibold text-white">92%</span>
              <span className="text-[11px] text-slate-400">
                control pass rate
              </span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 px-1">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#1e3a5f] text-xs font-bold text-[#94eadc]">
              AR
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-slate-200">
                Avery Rivera
              </p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Admin workspace
              </p>
            </div>
            <PanelLeft className="h-4 w-4 text-slate-600" />
          </div>
        </div>
      </aside>

      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Workspace navigation"
        >
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-[#02090f]/75 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative flex h-full w-[292px] flex-col border-r border-white/10 bg-[#091826] shadow-2xl">
            <div className="flex h-[72px] items-center justify-between border-b border-white/8 px-5">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#2dd4bf] text-[#06242d]">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wide">
                    SHADOW PILOT
                  </p>
                  <p className="text-[9px] uppercase tracking-[.18em] text-[#71e5d3]">
                    Operations CRM
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
              {navigation.map(item => {
                const active =
                  item.path === "/"
                    ? location === "/"
                    : location.startsWith(item.path);
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => navigateTo(item.path)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${active ? "bg-[#1e3a5f] text-white shadow-[inset_3px_0_0_#2dd4bf]" : "text-slate-400 hover:bg-white/5"}`}
                  >
                    <Icon
                      className={`h-4 w-4 ${active ? "text-[#2dd4bf]" : "text-slate-500"}`}
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-[#2dd4bf]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#65e6d2]">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-white/8 p-4 text-xs text-slate-500">
              Avery Rivera · Admin workspace
            </div>
          </div>
        </div>
      ) : null}

      <main className="min-h-screen lg:pl-[272px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-white/8 bg-[#07131f]/90 px-5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/8 text-slate-300 hover:bg-white/5"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#2dd4bf] text-[#07212b]">
              <Bot className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">SHADOW PILOT</span>
          </div>
          <div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex">
            <span>NHID-Clinical</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-slate-300">Operations workspace</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {isRefreshing ? "Refreshing workspace…" : "Last synced just now"}
            </span>
            <div
              className={`h-2 w-2 rounded-full bg-[#2dd4bf] shadow-[0_0_12px_#2dd4bf] ${isRefreshing ? "animate-pulse" : ""}`}
            />
            <Button
              onClick={runSharedAction}
              disabled={isRefreshing}
              size="sm"
              className="bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
            >
              {isRefreshing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              New activity
            </Button>
          </div>
        </header>
        <div className="relative mx-auto max-w-[1600px] p-5 lg:p-8">
          {isRefreshing ? (
            <div className="absolute inset-x-5 top-3 z-10 h-0.5 overflow-hidden rounded-full bg-white/5 lg:inset-x-8">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-[#2dd4bf]" />
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
