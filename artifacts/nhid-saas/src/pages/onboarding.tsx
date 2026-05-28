import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Copy, Check, Eye, EyeOff } from "lucide-react";

import { useCreateOrg, useApiKey } from "@/hooks/use-nhid";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  orgName: z.string().min(2, "Organization name must be at least 2 characters.").max(120),
});
type FormValues = z.infer<typeof schema>;

const NHIDLogo = () => (
  <div style={{ textAlign: "center", marginBottom: 36 }}>
    <div
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 68, height: 68, borderRadius: 20,
        background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
        boxShadow: "0 0 50px rgba(0,194,168,0.5), 0 0 100px rgba(0,194,168,0.15)",
        fontSize: 30, fontWeight: 900, color: "#070c17",
        marginBottom: 18, fontFamily: "'Raleway', sans-serif",
        letterSpacing: "-0.03em",
      }}
    >
      N
    </div>
    <div style={{ fontSize: 24, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em", marginBottom: 5 }}>
      NHID Clinical
    </div>
    <div style={{ fontSize: 12, color: "var(--nhid-muted)", letterSpacing: "0.02em" }}>
      Enterprise AI Audit Infrastructure
    </div>
  </div>
);

function ApiKeyReveal({ apiKey, orgName, onContinue }: { apiKey: string; orgName: string; onContinue: () => void }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(apiKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{ animation: "fadeSlideUp 0.3s ease" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div
          style={{
            fontSize: 40, marginBottom: 12, display: "inline-block",
            background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
            borderRadius: "50%", width: 64, height: 64,
            lineHeight: "64px", textAlign: "center",
            boxShadow: "0 0 30px rgba(0,194,168,0.4)",
            color: "#070c17", fontWeight: 900,
          }}
        >
          ✓
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--nhid-teal)", marginBottom: 5 }}>
          Workspace Created
        </div>
        <div style={{ fontSize: 12, color: "var(--nhid-muted)" }}>
          <strong style={{ color: "var(--nhid-text)", fontWeight: 700 }}>{orgName}</strong> is now on NHID Clinical
        </div>
      </div>

      <div
        style={{
          background: "rgba(0,0,0,0.3)", border: "1px solid var(--nhid-border)",
          borderRadius: 10, padding: "16px", marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 10, fontWeight: 700, color: "var(--nhid-muted)",
            textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10,
          }}
        >
          Your API Key
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <code
            style={{
              flex: 1, fontSize: 11, color: "var(--nhid-cyan)", fontFamily: "monospace",
              wordBreak: "break-all", lineHeight: 1.5,
              filter: revealed ? "none" : "blur(5px)",
              transition: "filter 0.2s",
              userSelect: revealed ? "text" : "none",
            }}
          >
            {apiKey}
          </code>
          <button
            onClick={() => setRevealed(r => !r)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--nhid-muted)", padding: 4, flexShrink: 0,
            }}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={copy}
            style={{
              padding: "6px 12px", borderRadius: 6, flexShrink: 0,
              background: copied ? "rgba(0,194,168,0.2)" : "rgba(255,255,255,0.06)",
              border: "1px solid var(--nhid-border)",
              color: copied ? "var(--nhid-teal)" : "var(--nhid-muted)",
              fontSize: 11, cursor: "pointer",
              fontFamily: "'Raleway', sans-serif",
              display: "flex", alignItems: "center", gap: 4,
              transition: "all 0.15s",
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div
        style={{
          fontSize: 11, color: "#fbbd24", padding: "10px 12px",
          background: "rgba(251,189,36,0.06)", border: "1px solid rgba(251,189,36,0.2)",
          borderRadius: 8, marginBottom: 22, lineHeight: 1.6,
        }}
      >
        ⚠ Save your API key now — it will not be shown again.
      </div>

      <button
        onClick={onContinue}
        style={{
          width: "100%", padding: "13px", borderRadius: 10,
          background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
          border: "none", color: "#070c17", fontSize: 14, fontWeight: 800,
          cursor: "pointer", fontFamily: "'Raleway', sans-serif",
          boxShadow: "0 0 30px rgba(0,194,168,0.35)",
          letterSpacing: "0.01em",
        }}
      >
        Enter Dashboard →
      </button>

      <style>{`@keyframes fadeSlideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const apiKey = useApiKey();
  const createOrg = useCreateOrg();
  const { toast } = useToast();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdOrg, setCreatedOrg] = useState<string>("");

  useEffect(() => {
    if (apiKey && !createdKey) setLocation("/dashboard");
  }, [apiKey, createdKey, setLocation]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { orgName: "" },
  });

  const onSubmit = (data: FormValues) => {
    createOrg.mutate({ orgName: data.orgName }, {
      onSuccess: (res) => {
        setCreatedOrg(data.orgName);
        setCreatedKey(res.api_key);
        toast({ title: "Workspace created", description: "Your API key is ready." });
      },
      onError: () => {
        toast({
          title: "Could not create workspace",
          description: "Please try again in a moment.",
          variant: "destructive",
        });
      },
    });
  };

  const watchOrgName = form.watch("orgName");

  return (
    <div
      style={{
        minHeight: "100dvh", background: "var(--nhid-bg)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", overflow: "hidden", padding: "20px",
      }}
    >
      {/* Ambient glows */}
      <div
        style={{
          position: "absolute", top: -200, left: "50%", transform: "translateX(-50%)",
          width: 700, height: 700, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,194,168,0.10) 0%, transparent 65%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute", bottom: -200, right: "15%",
          width: 500, height: 500, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(83,216,251,0.07) 0%, transparent 65%)",
          pointerEvents: "none",
        }}
      />
      {/* Grid */}
      <div
        style={{
          position: "absolute", inset: 0, opacity: 0.025,
          backgroundImage: "linear-gradient(rgba(0,194,168,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,194,168,1) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          pointerEvents: "none",
        }}
      />

      {/* Card */}
      <div style={{ width: "100%", maxWidth: 460, position: "relative", zIndex: 1 }}>
        <NHIDLogo />

        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--nhid-border)",
            borderRadius: 16, padding: "32px",
            backdropFilter: "blur(20px)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,194,168,0.04) inset",
          }}
        >
          {createdKey ? (
            <ApiKeyReveal
              apiKey={createdKey}
              orgName={createdOrg}
              onContinue={() => setLocation("/dashboard")}
            />
          ) : (
            <>
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.01em", marginBottom: 6 }}>
                  Create your workspace
                </div>
                <div style={{ fontSize: 12, color: "var(--nhid-muted)", lineHeight: 1.7 }}>
                  Get started free. Upgrade to a paid plan any time from your dashboard.
                </div>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <FormField
                    control={form.control}
                    name="orgName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)" }}>
                          Organization Name
                        </FormLabel>
                        <FormControl>
                          <input
                            {...field}
                            placeholder="e.g. MemorialHealth AI"
                            autoFocus
                            data-testid="input-orgname"
                            style={{
                              width: "100%", padding: "12px 14px", borderRadius: 9,
                              background: "rgba(255,255,255,0.05)", border: "1px solid var(--nhid-border)",
                              color: "var(--nhid-text)", fontSize: 14, outline: "none",
                              fontFamily: "'Raleway', sans-serif",
                              transition: "border-color 0.2s",
                            }}
                            onFocus={e => e.target.style.borderColor = "rgba(0,194,168,0.4)"}
                            onBlur={e => e.target.style.borderColor = "var(--nhid-border)"}
                          />
                        </FormControl>
                        <FormMessage style={{ fontSize: 11, color: "#ef4444" }} />
                      </FormItem>
                    )}
                  />

                  {/* Plan info — informational only, no form field */}
                  <div
                    style={{
                      padding: "14px 16px", borderRadius: 10,
                      background: "rgba(0,194,168,0.05)",
                      border: "1px solid rgba(0,194,168,0.15)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--nhid-teal)" }}>Free Plan</span>
                      <span style={{ fontSize: 11, color: "var(--nhid-muted)" }}>$0 / month</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--nhid-muted)", lineHeight: 1.6 }}>
                      100 audit events/day · Tamper-evident trail · Chain verification
                    </div>
                    <div style={{ fontSize: 10, color: "var(--nhid-muted)", marginTop: 8, opacity: 0.7 }}>
                      Upgrade to L1 / L2 / L3 from your dashboard after sign-up.
                    </div>
                  </div>

                  <button
                    type="submit"
                    data-testid="button-submit"
                    disabled={createOrg.isPending}
                    style={{
                      width: "100%", padding: "13px", borderRadius: 10,
                      background: watchOrgName.trim().length >= 2
                        ? "linear-gradient(135deg, #00c2a8, #53d8fb)"
                        : "rgba(255,255,255,0.06)",
                      border: "none",
                      color: watchOrgName.trim().length >= 2 ? "#070c17" : "var(--nhid-muted)",
                      fontSize: 14, fontWeight: 800,
                      cursor: createOrg.isPending ? "not-allowed" : "pointer",
                      fontFamily: "'Raleway', sans-serif",
                      boxShadow: watchOrgName.trim().length >= 2 ? "0 0 30px rgba(0,194,168,0.35)" : "none",
                      transition: "all 0.2s",
                      opacity: createOrg.isPending ? 0.75 : 1,
                      letterSpacing: "0.01em",
                    }}
                  >
                    {createOrg.isPending ? "Creating workspace…" : "Get Started →"}
                  </button>
                </form>
              </Form>
            </>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "var(--nhid-muted)", opacity: 0.6 }}>
          NHID Clinical · HIPAA-aligned audit infrastructure · v2.0
        </div>
      </div>
    </div>
  );
}
