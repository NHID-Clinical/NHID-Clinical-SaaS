import { useState } from "react";
import { Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

import { useProof } from "@/hooks/use-nhid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Proof() {
  const [searchInput, setSearchInput] = useState("");
  const [activeSession, setActiveSession] = useState("");

  const { data: proof, isLoading, isError, error } = useProof(activeSession);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setActiveSession(searchInput.trim());
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Trail Proof</h1>
        <p className="text-muted-foreground mt-1">
          Verify cryptographic integrity of session event chains.
        </p>
      </div>

      <Card className="border-border">
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-3">
            <Input 
              placeholder="Enter Session ID (e.g. sess_abc123)" 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="font-mono"
            />
            <Button type="submit">
              <Search className="w-4 h-4 mr-2" />
              Verify Chain
            </Button>
          </form>
        </CardContent>
      </Card>

      {activeSession && (
        <div className="space-y-6">
          {isLoading && (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}

          {isError && (
             <Card className="border-destructive bg-destructive/5">
               <CardContent className="pt-6 flex items-center gap-3 text-destructive">
                 <ShieldAlert className="w-6 h-6" />
                 <div>
                   <p className="font-semibold">Verification Failed</p>
                   <p className="text-sm">{(error as any)?.message || "Session not found or chain corrupted."}</p>
                 </div>
               </CardContent>
             </Card>
          )}

          {proof && (
            <>
              <Card className="border-border">
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">Chain Status</CardTitle>
                    <CardDescription className="font-mono mt-1 text-xs">{proof.session_id}</CardDescription>
                  </div>
                  {proof.valid_chain ? (
                    <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-white gap-1 py-1">
                      <ShieldCheck className="w-3 h-3" /> Valid Chain
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1 py-1">
                      <ShieldAlert className="w-3 h-3" /> Broken Chain
                    </Badge>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Event Count</div>
                      <div className="text-xl font-bold font-mono">{proof.event_count}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Org ID</div>
                      <div className="text-sm font-medium font-mono">{proof.org_id}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <h3 className="font-medium text-lg border-b border-border pb-2">Event Ledger</h3>
                {Array.isArray(proof.trace) && proof.trace.length > 0 ? (
                  <div className="relative border-l-2 border-border ml-3 space-y-6 pb-4">
                    {proof.trace.map((evt: any, i: number) => (
                      <div key={i} className="relative pl-6">
                        <div className="absolute w-3 h-3 bg-card border-2 border-primary rounded-full -left-[7px] top-1.5" />
                        <Card className="border-border text-sm">
                          <CardHeader className="p-3 pb-2 bg-secondary/30 flex flex-row items-center justify-between border-b border-border">
                            <span className="font-mono font-bold text-primary">{evt.event_type}</span>
                            {evt.timestamp && (
                               <span className="text-xs text-muted-foreground font-mono">
                                 {format(new Date(evt.timestamp), "HH:mm:ss.SSS")}
                               </span>
                            )}
                          </CardHeader>
                          <CardContent className="p-3 grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
                            <div>
                              <span className="text-muted-foreground">State Transition: </span>
                              <span className="text-foreground">{evt.state_before} &rarr; {evt.state_after}</span>
                            </div>
                            {evt.policy_action && (
                               <div>
                                 <span className="text-muted-foreground">Policy: </span>
                                 <Badge variant={evt.policy_action === 'allow' ? 'outline' : 'destructive'} className="text-[10px]">
                                   {evt.policy_action} {evt.reason_code && `(${evt.reason_code})`}
                                 </Badge>
                               </div>
                            )}
                            {evt.input_text && (
                              <div className="col-span-full border-t border-border pt-2 mt-1">
                                <span className="text-muted-foreground block mb-1">Input:</span>
                                <div className="bg-secondary/50 p-2 rounded text-foreground">{evt.input_text}</div>
                              </div>
                            )}
                            {evt.response_text && (
                              <div className="col-span-full">
                                <span className="text-muted-foreground block mb-1">Response:</span>
                                <div className="bg-secondary/50 p-2 rounded text-foreground">{evt.response_text}</div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground italic">No events found in payload.</div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
