import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, TerminalSquare } from "lucide-react";

import { useTrace } from "@/hooks/use-nhid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  session_id: z.string().min(1, "Session ID is required"),
  event_type: z.string().min(1, "Event type is required"),
  state_before: z.string().min(1, "State before is required"),
  state_after: z.string().min(1, "State after is required"),
  input_text: z.string().optional(),
  policy_action: z.string().optional(),
  reason_code: z.string().optional(),
  response_text: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function Trace() {
  const trace = useTrace();
  const { toast } = useToast();
  const [lastResult, setLastResult] = useState<{session_id: string, request_id: string} | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      session_id: `sess_${Math.random().toString(36).substring(2, 9)}`,
      event_type: "inference_requested",
      state_before: "idle",
      state_after: "processing",
      input_text: "",
      policy_action: "",
      reason_code: "",
      response_text: "",
    },
  });

  const onSubmit = (data: FormValues) => {
    setLastResult(null);
    trace.mutate(data, {
      onSuccess: (res) => {
        setLastResult(res);
        toast({ title: "Trace submitted", description: `Request ID: ${res.request_id}` });
        // Generate new session ID for next trace optionally, or keep same
      },
      onError: (err: any) => {
        toast({ title: "Trace failed", description: err.message || "Unknown error", variant: "destructive" });
      }
    });
  };

  const applyPreset = (preset: "inference" | "policy") => {
    const sess = form.getValues("session_id");
    if (preset === "inference") {
      form.reset({
        session_id: sess,
        event_type: "inference_requested",
        state_before: "idle",
        state_after: "processing",
        input_text: "What is the recommended dosage for Aspirin?",
        policy_action: "",
        reason_code: "",
        response_text: "",
      });
    } else {
      form.reset({
        session_id: sess,
        event_type: "policy_evaluation",
        state_before: "processing",
        state_after: "blocked",
        input_text: "What is the recommended dosage for Aspirin?",
        policy_action: "block",
        reason_code: "P01_MEDICAL_ADVICE",
        response_text: "I cannot provide medical advice.",
      });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Submit Trace</h1>
          <p className="text-muted-foreground mt-1">
            Ingest audit events directly into the immutable log.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => applyPreset("inference")}>Preset: Inference</Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset("policy")}>Preset: Policy Block</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TerminalSquare className="w-5 h-5" />
              Event Payload
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="session_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Session ID</FormLabel>
                        <FormControl><Input {...field} className="font-mono text-xs" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="event_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Event Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="session_started">session_started</SelectItem>
                            <SelectItem value="inference_requested">inference_requested</SelectItem>
                            <SelectItem value="policy_evaluation">policy_evaluation</SelectItem>
                            <SelectItem value="response_generated">response_generated</SelectItem>
                            <SelectItem value="session_ended">session_ended</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="state_before"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State Before</FormLabel>
                        <FormControl><Input {...field} className="font-mono text-xs" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state_after"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State After</FormLabel>
                        <FormControl><Input {...field} className="font-mono text-xs" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="input_text"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Input Text (Optional)</FormLabel>
                      <FormControl><Textarea {...field} rows={2} className="resize-none" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="policy_action"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Policy Action</FormLabel>
                        <FormControl><Input {...field} placeholder="e.g. allow, block" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="reason_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reason Code</FormLabel>
                        <FormControl><Input {...field} placeholder="e.g. P01" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button type="submit" className="w-full mt-4" disabled={trace.isPending}>
                  {trace.isPending ? "Submitting..." : "Submit Event"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <div>
          {lastResult ? (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="w-5 h-5" />
                  Event Accepted
                </CardTitle>
                <CardDescription>Cryptographic hash generated.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Session ID</div>
                  <div className="font-mono text-sm font-medium bg-background border border-border p-2 rounded">{lastResult.session_id}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Request ID (Hash Ref)</div>
                  <div className="font-mono text-xs text-muted-foreground bg-background border border-border p-2 rounded break-all">
                    {lastResult.request_id}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
             <div className="h-full min-h-[300px] flex items-center justify-center border border-dashed border-border rounded-xl text-muted-foreground p-8 text-center">
               Submit a trace event to see the cryptographic receipt.
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
