import { useState } from "react";
import { CheckCircle2, TerminalSquare, Copy, Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { useTrace } from "@/hooks/use-nhid";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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

const EVENT_TYPES = [
  { value: "session_started", label: "Session Start", color: "#00c2a8" },
  { value: "inference_requested", label: "Inference", color: "#53d8fb" },
  { value: "policy_evaluation", label: "Policy Eval", color: "#fbbd24" },
  { value: "response_generated", label: "Response", color: "#a78bfa" },
  { value: "session_ended", label: "Session End", color: "#94a3b8" },
];

function StyledInput({
  value, onChange, onFocus, onBlur, placeholder = "", type = "text", className = "", style = {} as React.CSSProperties,
}: {
  value: string; onChange: (v: string) => void; onFocus?: () => void; onBlur?: () => void;
  placeholder?: string; type?: string; className?: string; style?: React.CSSProperties;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      style={{
        width: "100%", padding: "10px 13px", borderRadius: 8,
        background: "rgba(255,255,255,0.05)", border: "1px solid var(--nhid-border)",
        color: "var(--nhid-text)", fontSize: 13, outline: "none",
        fontFamily: "'Raleway', sans-serif",
        transition: "border-color 0.2s",
        ...style,
      }}
      onFocus={e => { e.target.style.borderColor = "rgba(0,194,168,0.4)"; onFocus?.(); }}
      onBlur={e => { e.target.style.borderColor = "var(--nhid-border)"; onBlur?.(); }}
    />
  );
}

function StyledTextarea({ value, onChange, placeholder = "", rows = 2 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "10px 13px", borderRadius: 8,
        background: "rgba(255,255,255,0.05)", border: "1px solid var(--nhid-border)",
        color: "var(--nhid-text)", fontSize: 13, outline: "none",
        fontFamily: "monospace", resize: "none",
        transition: "border-color 0.2s", lineHeight: 1.6,
      }}
      onFocus={e => e.target.style.borderColor = "rgba(0,194,168,0.4)"}
      onBlur={e => e.target.style.borderColor = "var(--nhid-border)"}
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function ReceiptItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(0,0,0,0.3)", borderRadius: 8,
          border: "1px solid var(--nhid-border)", padding: "8px 12px",
        }}
      >
        <code
          style={{
            flex: 1, fontSize: mono ? 10 : 12, color: "var(--nhid-cyan)",
            fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.5,
          }}
        >
          {value}
        </code>
        <button
          onClick={copy}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--nhid-muted)", padding: 2, flexShrink: 0 }}
        >
          {copied ? <Check size={12} style={{ color: "var(--nhid-teal)" }} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

export default function Trace() {
  const trace = useTrace();
  const { toast } = useToast();
  const [lastResult, setLastResult] = useState<{ session_id: string; request_id: string } | null>(null);

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

  const watchEventType = form.watch("event_type");

  const onSubmit = (data: FormValues) => {
    setLastResult(null);
    trace.mutate(data, {
      onSuccess: (res) => {
        setLastResult(res);
        toast({ title: "Trace submitted", description: `Request ID: ${res.request_id}` });
      },
      onError: (err: any) => {
        toast({ title: "Trace failed", description: err.message || "Unknown error", variant: "destructive" });
      },
    });
  };

  const applyPreset = (preset: "inference" | "policy") => {
    const sess = form.getValues("session_id");
    if (preset === "inference") {
      form.reset({
        session_id: sess, event_type: "inference_requested",
        state_before: "idle", state_after: "processing",
        input_text: "What is the recommended dosage for Aspirin?",
        policy_action: "", reason_code: "", response_text: "",
      });
    } else {
      form.reset({
        session_id: sess, event_type: "policy_evaluation",
        state_before: "processing", state_after: "blocked",
        input_text: "What is the recommended dosage for Aspirin?",
        policy_action: "block", reason_code: "P01_MEDICAL_ADVICE",
        response_text: "I cannot provide medical advice.",
      });
    }
  };

  const GlassCard = ({ children, style = {} as React.CSSProperties }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{
      background: "var(--nhid-surface)", border: "1px solid var(--nhid-border)",
      borderRadius: 14, backdropFilter: "blur(12px)", ...style,
    }}>
      {children}
    </div>
  );

  const selectedEventColor = EVENT_TYPES.find(e => e.value === watchEventType)?.color ?? "var(--nhid-teal)";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-400">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Submit Trace
          </h1>
          <p style={{ fontSize: 13, color: "var(--nhid-muted)" }}>
            Ingest audit events into the immutable hash-chained log.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => applyPreset("inference")}
            style={{
              padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: "rgba(83,216,251,0.08)", border: "1px solid rgba(83,216,251,0.2)",
              color: "var(--nhid-cyan)", fontFamily: "'Raleway', sans-serif",
            }}
          >
            Preset: Inference
          </button>
          <button
            onClick={() => applyPreset("policy")}
            style={{
              padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: "rgba(251,189,36,0.08)", border: "1px solid rgba(251,189,36,0.2)",
              color: "#fbbd24", fontFamily: "'Raleway', sans-serif",
            }}
          >
            Preset: Policy Block
          </button>
        </div>
      </div>

      {/* Event type pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {EVENT_TYPES.map((et) => {
          const active = watchEventType === et.value;
          return (
            <button
              key={et.value}
              type="button"
              onClick={() => form.setValue("event_type", et.value)}
              style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                cursor: "pointer", transition: "all 0.15s",
                fontFamily: "'Raleway', sans-serif", letterSpacing: "0.02em",
                background: active ? `${et.color}18` : "rgba(255,255,255,0.03)",
                border: `1px solid ${active ? et.color + "45" : "var(--nhid-border)"}`,
                color: active ? et.color : "var(--nhid-muted)",
                boxShadow: active ? `0 0 12px ${et.color}25` : "none",
              }}
            >
              {et.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form card */}
        <GlassCard style={{ overflow: "hidden" }}>
          <div style={{
            padding: "16px 20px", borderBottom: "1px solid var(--nhid-border)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <TerminalSquare size={14} style={{ color: selectedEventColor }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--nhid-text)" }}>Event Payload</span>
            <span
              style={{
                marginLeft: "auto", fontSize: 9, fontWeight: 700,
                padding: "2px 8px", borderRadius: 12, letterSpacing: "0.08em",
                background: `${selectedEventColor}18`,
                color: selectedEventColor,
                border: `1px solid ${selectedEventColor}30`,
                textTransform: "uppercase",
              }}
            >
              {watchEventType}
            </span>
          </div>
          <div style={{ padding: "20px" }}>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FormField
                    control={form.control}
                    name="session_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel asChild><FieldLabel>Session ID</FieldLabel></FormLabel>
                        <FormControl>
                          <StyledInput value={field.value} onChange={field.onChange} style={{ fontFamily: "monospace", fontSize: 11 }} />
                        </FormControl>
                        <FormMessage style={{ fontSize: 10, color: "#ef4444" }} />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="event_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel asChild><FieldLabel>Event Type</FieldLabel></FormLabel>
                        <FormControl>
                          <select
                            value={field.value}
                            onChange={e => field.onChange(e.target.value)}
                            style={{
                              width: "100%", padding: "10px 13px", borderRadius: 8,
                              background: "rgba(255,255,255,0.05)", border: "1px solid var(--nhid-border)",
                              color: "var(--nhid-text)", fontSize: 13, outline: "none",
                              fontFamily: "'Raleway', sans-serif", cursor: "pointer",
                            }}
                          >
                            {EVENT_TYPES.map(et => (
                              <option key={et.value} value={et.value} style={{ background: "#0d1520" }}>{et.value}</option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage style={{ fontSize: 10, color: "#ef4444" }} />
                      </FormItem>
                    )}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FormField
                    control={form.control}
                    name="state_before"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel asChild><FieldLabel>State Before</FieldLabel></FormLabel>
                        <FormControl>
                          <StyledInput value={field.value} onChange={field.onChange} style={{ fontFamily: "monospace", fontSize: 12 }} />
                        </FormControl>
                        <FormMessage style={{ fontSize: 10, color: "#ef4444" }} />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state_after"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel asChild><FieldLabel>State After</FieldLabel></FormLabel>
                        <FormControl>
                          <StyledInput value={field.value} onChange={field.onChange} style={{ fontFamily: "monospace", fontSize: 12 }} />
                        </FormControl>
                        <FormMessage style={{ fontSize: 10, color: "#ef4444" }} />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="input_text"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel asChild><FieldLabel>Input Text (optional)</FieldLabel></FormLabel>
                      <FormControl>
                        <StyledTextarea value={field.value ?? ""} onChange={field.onChange} rows={2} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FormField
                    control={form.control}
                    name="policy_action"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel asChild><FieldLabel>Policy Action</FieldLabel></FormLabel>
                        <FormControl>
                          <StyledInput value={field.value ?? ""} onChange={field.onChange} placeholder="allow, block" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="reason_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel asChild><FieldLabel>Reason Code</FieldLabel></FormLabel>
                        <FormControl>
                          <StyledInput value={field.value ?? ""} onChange={field.onChange} placeholder="P01_MEDICAL_ADVICE" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <button
                  type="submit"
                  disabled={trace.isPending}
                  style={{
                    width: "100%", padding: "12px", borderRadius: 10,
                    background: trace.isPending
                      ? "rgba(0,194,168,0.3)"
                      : "linear-gradient(135deg, #00c2a8, #53d8fb)",
                    border: "none", color: "#070c17", fontSize: 14, fontWeight: 800,
                    cursor: trace.isPending ? "not-allowed" : "pointer",
                    fontFamily: "'Raleway', sans-serif",
                    boxShadow: trace.isPending ? "none" : "0 0 24px rgba(0,194,168,0.3)",
                    transition: "all 0.2s",
                    letterSpacing: "0.01em",
                  }}
                >
                  {trace.isPending ? "Submitting…" : "Submit Audit Event →"}
                </button>
              </form>
            </Form>
          </div>
        </GlassCard>

        {/* Receipt panel */}
        <div>
          {lastResult ? (
            <GlassCard style={{
              borderColor: "rgba(0,194,168,0.35)",
              boxShadow: "0 0 40px rgba(0,194,168,0.1)",
              animation: "fadeSlideUp 0.3s ease",
            }}>
              <div style={{
                padding: "16px 20px", borderBottom: "1px solid rgba(0,194,168,0.15)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <CheckCircle2 size={16} style={{ color: "var(--nhid-teal)" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--nhid-teal)" }}>Event Accepted</span>
              </div>
              <div style={{ padding: "20px" }}>
                <div
                  style={{
                    padding: "10px 12px", borderRadius: 8, marginBottom: 20,
                    background: "rgba(0,194,168,0.06)", border: "1px solid rgba(0,194,168,0.15)",
                    fontSize: 12, color: "var(--nhid-muted)", lineHeight: 1.6,
                  }}
                >
                  Cryptographic hash generated and appended to the immutable chain. This event is now tamper-evident.
                </div>
                <ReceiptItem label="Session ID" value={lastResult.session_id} />
                <ReceiptItem label="Request ID (Hash Reference)" value={lastResult.request_id} mono />
                <div style={{ marginTop: 16 }}>
                  <a
                    href={`/proof`}
                    style={{
                      display: "block", width: "100%", padding: "10px",
                      borderRadius: 8, border: "1px solid var(--nhid-border)",
                      background: "rgba(255,255,255,0.03)", color: "var(--nhid-muted)",
                      fontSize: 12, cursor: "pointer", textDecoration: "none",
                      fontFamily: "'Raleway', sans-serif", fontWeight: 600,
                      textAlign: "center", transition: "all 0.15s",
                    }}
                  >
                    View Proof →
                  </a>
                </div>
              </div>
            </GlassCard>
          ) : (
            <div
              style={{
                minHeight: 300, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                border: "1px dashed var(--nhid-border)", borderRadius: 14,
                textAlign: "center", padding: 32,
                color: "var(--nhid-muted)",
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12, marginBottom: 14,
                background: "rgba(0,194,168,0.06)", border: "1px solid var(--nhid-border)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <TerminalSquare size={18} style={{ opacity: 0.4 }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                No Event Yet
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.6 }}>
                Submit an event to receive a cryptographic receipt with hash reference.
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}
