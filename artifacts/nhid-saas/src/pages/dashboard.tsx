import { useGetMe, useGetRecent } from "@/hooks/use-nhid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Activity, Server, ShieldCheck, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: profile, isLoading: loadingProfile } = useGetMe();
  const { data: recent, isLoading: loadingRecent } = useGetRecent(5);

  if (loadingProfile) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const usagePercent = profile.plan_details.daily_limit 
    ? (profile.usage_count / profile.plan_details.daily_limit) * 100 
    : 0;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">
          Operations center for {profile.org_name}.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Plan</CardTitle>
            <ShieldCheck className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{profile.plan}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {profile.plan_details.features.length} features enabled
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total API Requests</CardTitle>
            <Server className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{profile.usage_count.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Since {format(new Date(profile.created_at), "MMM d, yyyy")}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Daily Quota</CardTitle>
            <Zap className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {profile.rate_limit.remaining ?? '∞'} <span className="text-lg text-muted-foreground font-normal">/ {profile.plan_details.daily_limit ?? '∞'}</span>
            </div>
            <Progress value={Math.min(usagePercent, 100)} className="h-2 mt-3" />
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent Activity
          </CardTitle>
          <CardDescription>Live feed of requests across all endpoints.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRecent ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : recent?.activity && recent.activity.length > 0 ? (
            <div className="space-y-4">
              {recent.activity.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between p-3 rounded-md border border-border bg-card/50 hover:bg-secondary/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <Badge variant={entry.status_code === 200 ? "default" : "destructive"} className="font-mono uppercase px-2 py-0.5 text-[10px]">
                      {entry.method} {entry.status_code}
                    </Badge>
                    <div>
                      <p className="text-sm font-mono font-medium">{entry.endpoint}</p>
                      {entry.session_id && (
                        <p className="text-xs text-muted-foreground font-mono">Session: {entry.session_id}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(entry.timestamp), "HH:mm:ss.SSS")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-md">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>No activity yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
