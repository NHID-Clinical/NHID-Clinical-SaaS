import { useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import {
  CalendarDays,
  CheckCircle2,
  FileDown,
  GraduationCap,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

function Header({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mb-7">
      <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
        {eyebrow}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          {title}
        </h1>
        {eyebrow === "Administration" ? (
          <Link
            href="/settings/profile"
            className="rounded-md border border-[#2dd4bf]/25 px-3 py-1.5 text-xs font-medium text-[#71e5d3] hover:bg-[#2dd4bf]/10"
          >
            Manage my profile
          </Link>
        ) : null}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">{detail}</p>
    </div>
  );
}

export function SettingsWorkspace() {
  const organization = trpc.settings.organization.useQuery();
  const [name, setName] = useState("NHID-Clinical");
  const [supportEmail, setSupportEmail] = useState("contact@nhid-clinical.org");
  useEffect(() => {
    const value = organization.data;
    if (value) {
      setName(value.name);
      setSupportEmail(value.supportEmail ?? "");
    }
  }, [organization.data]);
  const save = trpc.settings.saveOrganization.useMutation({
    onSuccess: () => {
      toast.success("Organization settings saved");
      organization.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save organization settings."),
  });
  return (
    <OperationsShell>
      <Header
        eyebrow="Administration"
        title="Organization settings"
        detail="Persist organization defaults and review the exact Admin, Consultant, and Partner access profiles."
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_.9fr]">
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#2dd4bf]/10 text-[#71e5d3]">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Role access</h2>
              <p className="text-xs text-slate-500">
                Access rules defined for the workspace
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {[
              ["Admin", "Full configuration and operational access"],
              ["Consultant", "Operational access to assigned work"],
              ["Partner", "View-only access to the partner’s own data"],
            ].map(([role, description], index) => (
              <div
                key={role}
                className={`flex items-center gap-4 rounded-lg border p-4 ${index === 0 ? "border-[#2dd4bf]/30 bg-[#2dd4bf]/5" : "border-white/8 bg-white/[.02]"}`}
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#1e3a5f] text-xs font-bold text-[#71e5d3]">
                  {role[0]}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{role}</p>
                  <p className="text-xs text-slate-500">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="space-y-5">
          <div className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
            <div className="flex items-center gap-3">
              <Settings2 className="h-4 w-4 text-[#71e5d3]" />
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Organization profile
                </h2>
                <p className="text-xs text-slate-500">
                  Saved to the operations database
                </p>
              </div>
            </div>
            <label className="mt-5 block text-xs text-slate-400">
              Organization name
              <Input
                value={name}
                onChange={event => setName(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <label className="mt-3 block text-xs text-slate-400">
              Operations email
              <Input
                value={supportEmail}
                onChange={event => setSupportEmail(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <Button
              disabled={save.isPending}
              onClick={() => save.mutate({ name, supportEmail })}
              className="mt-4 bg-[#1e3a5f] hover:bg-[#29507f]"
            >
              <Save className="mr-2 h-4 w-4" />
              {save.isPending ? "Saving…" : "Save organization"}
            </Button>
          </div>
          <div className="rounded-xl border border-[#2dd4bf]/15 bg-gradient-to-br from-[#12324a] to-[#0b1c2c] p-5">
            <div className="flex justify-between">
              <Sparkles className="h-4 w-4 text-[#71e5d3]" />
              <span className="rounded-full bg-white/7 px-2 py-1 text-[10px] font-bold text-slate-300">
                Coming Soon
              </span>
            </div>
            <h2 className="mt-5 text-lg font-semibold text-white">
              Stripe billing
            </h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Billing remains a placeholder until production packaging is
              finalized.
            </p>
          </div>
        </section>
      </div>
    </OperationsShell>
  );
}

export function IntelligenceWorkspace() {
  const list = trpc.intelligence.list.useQuery();
  const save = trpc.intelligence.save.useMutation({
    onSuccess: () => {
      toast.success("Competitor profile saved");
      list.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save intelligence updates."),
  });
  const [selected, setSelected] = useState(0);
  const profile = list.data?.[selected];
  const [profileText, setProfileText] = useState("");
  const [positioning, setPositioning] = useState("");
  useEffect(() => {
    if (profile) {
      setProfileText(profile.profile);
      setPositioning(profile.positioning);
    }
  }, [profile]);
  const competitors = list.data ?? [];
  return (
    <OperationsShell>
      <Header
        eyebrow="Competitive intelligence"
        title="Positioning workspace"
        detail="Maintain the four approved competitor profiles and a transparent feature-comparison matrix for sales preparation."
      />
      <div className="grid gap-5 xl:grid-cols-[.95fr_1.05fr]">
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <h2 className="text-sm font-semibold text-white">
            Competitor profiles
          </h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {competitors.map((item, index) => (
              <button
                key={item.id}
                onClick={() => setSelected(index)}
                className={`rounded-lg border p-4 text-left ${selected === index ? "border-[#2dd4bf]/30 bg-[#2dd4bf]/5" : "border-white/8 bg-white/[.02]"}`}
              >
                <p className="text-sm font-semibold text-slate-200">
                  {item.name}
                </p>
                <p className="mt-1 text-xs text-slate-500">Editable profile</p>
              </button>
            ))}
          </div>
          <div className="mt-5 border-t border-white/7 pt-5">
            <p className="text-xs font-semibold text-slate-300">
              {profile?.name ?? "Select a profile"}
            </p>
            <Textarea
              value={profileText}
              onChange={event => setProfileText(event.target.value)}
              className="mt-3 min-h-24 border-white/8 bg-white/[.025] text-xs"
              placeholder="Operational profile"
            />
            <Textarea
              value={positioning}
              onChange={event => setPositioning(event.target.value)}
              className="mt-3 min-h-20 border-white/8 bg-white/[.025] text-xs"
              placeholder="Positioning note"
            />
            <Button
              disabled={!profile || save.isPending}
              onClick={() =>
                profile &&
                save.mutate({
                  id: profile.id,
                  name: profile.name,
                  profile: profileText,
                  positioning,
                })
              }
              className="mt-3 bg-[#1e3a5f] hover:bg-[#29507f]"
            >
              <Save className="mr-2 h-4 w-4" />
              Save profile
            </Button>
          </div>
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <h2 className="text-sm font-semibold text-white">
            Feature comparison matrix
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Qualitative sales preparation matrix; validate claims before
            external use.
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[550px] text-left text-xs">
              <thead className="border-b border-white/8 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-3">Capability</th>
                  <th className="p-3">NHID-Clinical</th>
                  <th className="p-3">Hyro</th>
                  <th className="p-3">Orbita</th>
                  <th className="p-3">Credo AI</th>
                  <th className="p-3">Arthur AI</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Shadow Pilot delivery",
                    "Primary",
                    "Adjacent",
                    "Adjacent",
                    "Adjacent",
                    "Adjacent",
                  ],
                  [
                    "Five-control evidence",
                    "Primary",
                    "Review",
                    "Review",
                    "Review",
                    "Review",
                  ],
                  [
                    "Call-level evaluation",
                    "Primary",
                    "Workflow",
                    "Workflow",
                    "Policy",
                    "Monitoring",
                  ],
                  ["Operational email queue", "Primary", "—", "—", "—", "—"],
                ].map(row => (
                  <tr key={row[0]} className="border-b border-white/7">
                    <td className="p-3 font-medium text-slate-200">{row[0]}</td>
                    {row.slice(1).map((value, index) => (
                      <td
                        key={index}
                        className={`p-3 ${index === 0 ? "text-[#71e5d3]" : "text-slate-400"}`}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 rounded-lg border border-[#2dd4bf]/15 bg-[#2dd4bf]/5 p-4">
            <p className="text-xs font-semibold text-[#a6f4e7]">
              Positioning cheat sheet
            </p>
            <p className="mt-2 text-xs leading-6 text-slate-400">
              Lead with visible operational evidence, a controlled 30-day Shadow
              Pilot, and an audit-ready connection between workflows,
              communications, and evaluations.
            </p>
          </div>
        </section>
      </div>
    </OperationsShell>
  );
}

export function CalendarWorkspace() {
  const list = trpc.calendar.list.useQuery();
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<"LinkedIn" | "Twitter">("LinkedIn");
  const [status, setStatus] = useState<
    "Idea" | "Draft" | "Scheduled" | "Published"
  >("Idea");
  const save = trpc.calendar.save.useMutation({
    onSuccess: () => {
      toast.success("Content calendar entry saved");
      setTitle("");
      list.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save calendar entries."),
  });
  return (
    <OperationsShell>
      <Header
        eyebrow="Content & marketing"
        title="30-day editorial calendar"
        detail="Manage the full seeded calendar, post status, platform, and future publication information."
      />
      <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
        <div className="flex flex-col gap-3 border-b border-white/7 pb-5 lg:flex-row lg:items-end">
          <label className="flex-1 text-xs text-slate-400">
            Post title
            <Input
              value={title}
              onChange={event => setTitle(event.target.value)}
              className="mt-2 border-white/8 bg-white/[.025]"
              placeholder="New content item"
            />
          </label>
          <label className="text-xs text-slate-400">
            Platform
            <select
              value={platform}
              onChange={event =>
                setPlatform(event.target.value as "LinkedIn" | "Twitter")
              }
              className="mt-2 block h-10 rounded-md border border-white/8 bg-white/[.025] px-3 text-sm text-slate-200"
            >
              <option>LinkedIn</option>
              <option>Twitter</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Status
            <select
              value={status}
              onChange={event =>
                setStatus(
                  event.target.value as
                    | "Idea"
                    | "Draft"
                    | "Scheduled"
                    | "Published"
                )
              }
              className="mt-2 block h-10 rounded-md border border-white/8 bg-white/[.025] px-3 text-sm text-slate-200"
            >
              <option>Idea</option>
              <option>Draft</option>
              <option>Scheduled</option>
              <option>Published</option>
            </select>
          </label>
          <Button
            disabled={!title || save.isPending}
            onClick={() =>
              save.mutate({ title, platform, status, publishDate: new Date() })
            }
            className="bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add post
          </Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(list.data ?? []).map(entry => (
            <article
              key={entry.id}
              className="rounded-lg border border-white/7 bg-white/[.02] p-4"
            >
              <div className="flex justify-between">
                <span className="mono text-[10px] text-slate-500">
                  {new Date(entry.publishDate).toLocaleDateString()}
                </span>
                <span className="rounded-full bg-[#2dd4bf]/10 px-2 py-1 text-[9px] font-bold text-[#71e5d3]">
                  {entry.status}
                </span>
              </div>
              <h2 className="mt-4 text-sm font-semibold text-slate-200">
                {entry.title}
              </h2>
              <p className="mt-2 text-xs text-slate-500">
                {entry.platform} · {entry.hashtags || "No hashtags"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </OperationsShell>
  );
}

export function CertificationWorkspace() {
  const modules = ["101", "102", "103", "104", "105", "106", "107"] as const;
  const [completed, setCompleted] = useState(5);
  const complete = trpc.certification.completeModule.useMutation({
    onSuccess: () => {
      setCompleted(value => Math.min(value + 1, 7));
      toast.success("Assessment result saved");
    },
    onError: () =>
      toast.error("Sign in as an administrator to save assessment results."),
  });
  const certificate = () => {
    const document = new jsPDF();
    document.setFillColor(30, 58, 95);
    document.rect(0, 0, 210, 35, "F");
    document.setTextColor(255, 255, 255);
    document.setFontSize(19);
    document.text("NHID-Clinical Consultant Certificate", 26, 22);
    document.setTextColor(27, 43, 55);
    document.setFontSize(17);
    document.text("Alex Morgan", 70, 85);
    document.setFontSize(11);
    document.text(
      "has completed modules 101 through 107 in the Shadow Pilot CRM certification track.",
      26,
      102,
      { maxWidth: 158 }
    );
    document.text(`Issued ${new Date().toLocaleDateString()}`, 26, 262);
    document.save("nhid-clinical-consultant-certificate.pdf");
    toast.success("Certificate downloaded as PDF");
  };
  return (
    <OperationsShell>
      <Header
        eyebrow="Consultant certification"
        title="Trainee readiness tracker"
        detail="Persist assessment results for modules 101–107 and issue completion evidence when requirements are met."
      />
      <div className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#2dd4bf]/10 text-[#71e5d3]">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Alex Morgan</h2>
              <p className="text-xs text-slate-500">
                alex.morgan@example.org · Consultant trainee
              </p>
            </div>
          </div>
          <div className="mt-6 rounded-lg border border-[#2dd4bf]/15 bg-[#2dd4bf]/5 p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Current progress
            </p>
            <p className="mt-1 text-3xl font-semibold text-white">
              {completed}{" "}
              <span className="text-base font-medium text-slate-500">
                / 7 modules
              </span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-[#2dd4bf]"
                style={{ width: `${(completed / 7) * 100}%` }}
              />
            </div>
            <Button
              onClick={certificate}
              className="mt-5 bg-[#1e3a5f] hover:bg-[#29507f]"
            >
              <FileDown className="mr-2 h-4 w-4" />
              Download certificate
            </Button>
          </div>
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <h2 className="text-sm font-semibold text-white">
            Module assessment actions
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {modules.map((module, index) => (
              <button
                key={module}
                disabled={complete.isPending || index > completed}
                onClick={() =>
                  complete.mutate({ traineeId: 1, module, score: 93 })
                }
                className={`flex items-center justify-between rounded-lg border p-4 text-left ${index < completed ? "border-[#2dd4bf]/25 bg-[#2dd4bf]/5" : "border-white/8 bg-white/[.02]"}`}
              >
                <div>
                  <p className="mono text-xs font-semibold text-slate-200">
                    Module {module}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {index < completed
                      ? "Assessment completed"
                      : index === completed
                        ? "Save assessment result"
                        : "Locked"}
                  </p>
                </div>
                {index < completed ? (
                  <CheckCircle2 className="h-4 w-4 text-[#2dd4bf]" />
                ) : (
                  <CalendarDays className="h-4 w-4 text-slate-600" />
                )}
              </button>
            ))}
          </div>
        </section>
      </div>
    </OperationsShell>
  );
}
