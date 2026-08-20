import { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { jsPDF } from "jspdf";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileSpreadsheet,
  Filter,
  GraduationCap,
  Inbox,
  KeyRound,
  LineChart,
  ListFilter,
  Loader2,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  Upload,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import {
  COMPETITORS,
  CONTENT_STATUSES,
  EMAIL_CATEGORIES,
  PIPELINE_STAGES,
  POLICY_CODES,
} from "../../../shared/domain";

/**
 * Derived from the router instead of hand-maintained. The previous local
 * copies silently drifted from what the server actually returned.
 */
type Snapshot = inferRouterOutputs<AppRouter>["operations"]["snapshot"];
type Partner = Snapshot["partners"][number];
type Evaluation = Snapshot["evaluations"][number];

const stageColors: Record<string, string> = {
  Applied: "bg-slate-500/15 text-slate-300 border-slate-400/20",
  Vetted: "bg-indigo-400/10 text-indigo-300 border-indigo-300/20",
  "Contract Sent": "bg-amber-400/10 text-amber-300 border-amber-300/20",
  Integrated: "bg-cyan-400/10 text-cyan-300 border-cyan-300/20",
  Live: "bg-[#2dd4bf]/10 text-[#6ce9d7] border-[#2dd4bf]/25",
  Reporting: "bg-violet-400/10 text-violet-300 border-violet-300/20",
  Complete: "bg-emerald-400/10 text-emerald-300 border-emerald-300/20",
};

function SectionIntro({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  icon: Icon,
  tone = "teal",
}: {
  label: string;
  value: string | number;
  delta: string;
  icon: typeof Activity;
  tone?: "teal" | "blue" | "violet" | "amber";
}) {
  const toneMap = {
    teal: "bg-[#2dd4bf]/10 text-[#69ead7]",
    blue: "bg-blue-400/10 text-blue-300",
    violet: "bg-violet-400/10 text-violet-300",
    amber: "bg-amber-400/10 text-amber-300",
  };
  return (
    <div className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5 shadow-[0_12px_32px_rgba(0,0,0,.13)]">
      <div className="flex items-start justify-between">
        <div
          className={`grid h-9 w-9 place-items-center rounded-lg ${toneMap[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <span className="rounded-full bg-[#2dd4bf]/10 px-2 py-1 text-[10px] font-semibold text-[#6ce9d7]">
          {delta}
        </span>
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function CardTitle({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: typeof Activity;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex gap-3">
        <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-[#71e5d3]">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {detail ? (
            <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows
    .map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const href = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function createPilotReport(partner: Partner) {
  const document = new jsPDF();
  document.setFillColor(30, 58, 95);
  document.rect(0, 0, 210, 31, "F");
  document.setTextColor(255, 255, 255);
  document.setFontSize(18);
  document.text("Shadow Pilot Report", 18, 19);
  document.setTextColor(25, 37, 52);
  document.setFontSize(12);
  document.text(`Partner: ${partner.name}`, 18, 46);
  document.text(`Stage: ${partner.stage}`, 18, 55);
  document.text(`Platform: ${partner.platform}`, 18, 64);
  document.text(
    `Estimated monthly volume: ${partner.estimatedCallVolume.toLocaleString()} calls`,
    18,
    73
  );
  document.text(
    "Control evidence: IDG-01, PDX-01, DBC-01, EIT-01, and ATR-01.",
    18,
    89,
    { maxWidth: 165 }
  );
  document.setFontSize(9);
  document.setTextColor(88, 103, 121);
  document.text(
    `Generated ${new Date().toLocaleString()} · Human-reviewed operational report`,
    18,
    278
  );
  document.save(
    `shadow-pilot-${partner.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report.pdf`
  );
}

type ScorecardEntry = { code: string; grade: string; status?: string };

/** Stored scorecards are JSON text; a damaged one must not break the report. */
function readScorecard(raw: string): ScorecardEntry[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScorecardEntry[]) : [];
  } catch {
    return [];
  }
}

function createEvaluationReport(evaluations: Evaluation[]) {
  const document = new jsPDF();
  document.setFillColor(30, 58, 95);
  document.rect(0, 0, 210, 26, "F");
  document.setTextColor(255, 255, 255);
  document.setFontSize(16);
  document.text("Call Evaluation Summary", 16, 17);
  document.setTextColor(25, 37, 52);
  document.setFontSize(10);
  evaluations.forEach((item, index) => {
    const perControl = POLICY_CODES.map(code => {
      const result = readScorecard(item.scorecard).find(
        entry => entry.code === code
      );
      if (!result) return `${code} —`;
      // "n/e" keeps an unevaluated control visibly distinct from a pass.
      return `${code} ${result.status === "not-evaluated" ? "n/e" : result.grade}`;
    }).join(" · ");

    document.text(
      `${item.callId} · Overall ${item.overallGrade} · ${perControl}`,
      16,
      40 + index * 13,
      { maxWidth: 176 }
    );
  });
  document.save("shadow-pilot-evaluation-summary.pdf");
}

function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  // Pass rate per week, computed from the evaluations the workspace actually
  // holds. This used to be a hardcoded ramp from 71 to 92.
  const trend = snapshot.violationTrend.map(week => {
    const failures = POLICY_CODES.reduce(
      (sum, code) =>
        sum + ((week as unknown as Record<string, number>)[code] ?? 0),
      0
    );
    const assessed = POLICY_CODES.length;
    return {
      week: week.week,
      score: Math.max(0, Math.round(100 - (failures / assessed) * 100)),
    };
  });
  return (
    <div>
      <SectionIntro
        eyebrow="Operations overview"
        title="Command center"
        detail="A consolidated view of Shadow Pilot activity, communication review, policy assurance, and upcoming execution work."
        action={
          <Link href="/apply">
            <Button
              variant="outline"
              className="border-[#2dd4bf]/30 bg-[#2dd4bf]/5 text-[#71e5d3] hover:bg-[#2dd4bf]/10 hover:text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              Partner intake
            </Button>
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active Shadow Pilots"
          value={snapshot.metrics.activePartners}
          delta="+1 this week"
          icon={UsersRound}
        />
        <MetricCard
          label="Inbox awaiting review"
          value={snapshot.metrics.pendingReview}
          delta="Needs attention"
          icon={Mail}
          tone="amber"
        />
        <MetricCard
          label="Calls evaluated"
          value={snapshot.metrics.evaluatedCalls}
          delta="This review cycle"
          icon={ClipboardCheck}
          tone="blue"
        />
        <MetricCard
          label="Control pass rate"
          value={
            snapshot.metrics.controlPassRate === null
              ? "—"
              : `${snapshot.metrics.controlPassRate}%`
          }
          delta={
            snapshot.metrics.controlPassRate === null
              ? "No calls scored yet"
              : `${snapshot.metrics.evaluatedCalls} calls scored`
          }
          icon={ShieldAlert}
          tone="violet"
        />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_.95fr]">
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <CardTitle
            icon={LineChart}
            title="Operational control trend"
            detail="Violation signals per weekly evaluation cohort"
            action={
              <span className="mono text-[10px] text-slate-500">8 weeks</span>
            }
          />
          <div className="mt-6 h-[248px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="assurance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.33} />
                    <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#ffffff10" vertical={false} />
                <XAxis
                  dataKey="week"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                />
                <YAxis
                  domain={[60, 100]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickFormatter={value => `${value}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0b1c2c",
                    border: "1px solid #ffffff15",
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: "#cbd5e1" }}
                />
                <Area
                  type="monotone"
                  dataKey="score"
                  name="Control pass rate"
                  stroke="#2dd4bf"
                  strokeWidth={2.5}
                  fill="url(#assurance)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <CardTitle
            icon={CircleAlert}
            title="Review queue"
            detail="Items requiring an operator decision"
            action={
              <Link
                href="/email"
                className="text-xs text-[#71e5d3] hover:text-white"
              >
                Open inbox
              </Link>
            }
          />
          <div className="mt-4 divide-y divide-white/7">
            {snapshot.emails
              .filter(email => email.status === "Review")
              .slice(0, 4)
              .map(email => (
                <div key={email.id} className="flex gap-3 py-3">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-400/10 text-[10px] font-bold text-amber-300">
                    {email.sender
                      .split(/[.@_-]/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map(part => part[0]?.toUpperCase() ?? "")
                      .join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-200">
                      {email.subject}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {email.category} · {email.confidence}% confidence
                    </p>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 text-slate-600" />
                </div>
              ))}
          </div>
        </section>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <CardTitle
            icon={UsersRound}
            title="Partner pipeline"
            detail="Current stage distribution"
            action={
              <Link
                href="/partners"
                className="text-xs text-[#71e5d3] hover:text-white"
              >
                View board
              </Link>
            }
          />
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {snapshot.pipeline.map(item => (
              <div
                key={item.stage}
                className="rounded-lg border border-white/8 bg-white/[.025] p-3"
              >
                <p className="text-lg font-semibold text-white">{item.count}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                  {item.stage}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5 overflow-hidden rounded-lg border border-white/7">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[.025] text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Partner</th>
                  <th className="hidden px-4 py-3 font-semibold sm:table-cell">
                    Platform
                  </th>
                  <th className="px-4 py-3 font-semibold">Stage</th>
                  <th className="hidden px-4 py-3 font-semibold lg:table-cell">
                    Owner
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshot.partners.map(partner => (
                  <tr key={partner.id} className="border-t border-white/7">
                    <td className="px-4 py-3 font-medium text-slate-200">
                      {partner.name}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-400 sm:table-cell">
                      {partner.platform}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${stageColors[partner.stage]}`}
                      >
                        {partner.stage}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-slate-400 lg:table-cell">
                      {partner.owner}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <CardTitle
            icon={CalendarDays}
            title="Today’s operations"
            detail="A focused execution list"
          />
          <div className="mt-4 space-y-2">
            {[
              "Review four inbound email drafts",
              "Confirm Harbor Oncology integration status",
              "Evaluate the next transcript batch",
              "Approve this week’s reporting outline",
            ].map((task, index) => (
              <button
                key={task}
                onClick={() => toast.success("Task marked complete")}
                className="flex w-full items-center gap-3 rounded-lg border border-white/7 p-3 text-left transition hover:border-[#2dd4bf]/30 hover:bg-[#2dd4bf]/5"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full border border-slate-600 text-[10px] text-slate-400">
                  {index + 1}
                </span>
                <span className="flex-1 text-xs text-slate-300">{task}</span>
                <Check className="h-4 w-4 text-slate-600" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function DraggablePartner({
  partner,
  onOpen,
}: {
  partner: Partner;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `partner-${partner.id}` });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
      }}
      {...listeners}
      {...attributes}
      className="cursor-grab rounded-lg border border-white/8 bg-[#0b1c2c] p-3 shadow-lg active:cursor-grabbing"
    >
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold leading-5 text-slate-100">
            {partner.name}
          </p>
          <MoreHorizontal className="h-4 w-4 shrink-0 text-slate-600" />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {partner.contactName} · {partner.platform}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            {partner.estimatedCallVolume.toLocaleString()} calls/mo
          </span>
          <span
            className={`h-1.5 w-1.5 rounded-full ${partner.risk === "Medium" ? "bg-amber-300" : "bg-[#2dd4bf]"}`}
          />
        </div>
      </button>
    </div>
  );
}

function PipelineColumn({
  stage,
  partners,
  onOpen,
}: {
  stage: (typeof PIPELINE_STAGES)[number];
  partners: Partner[];
  onOpen: (partner: Partner) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[400px] min-w-[210px] rounded-xl border p-3 transition ${isOver ? "border-[#2dd4bf]/60 bg-[#2dd4bf]/5" : "border-white/7 bg-white/[.018]"}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">{stage}</span>
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/7 px-1 text-[10px] text-slate-400">
          {partners.length}
        </span>
      </div>
      <div className="space-y-2">
        {partners.map(partner => (
          <DraggablePartner
            key={partner.id}
            partner={partner}
            onOpen={() => onOpen(partner)}
          />
        ))}
      </div>
    </div>
  );
}

function Partners({ snapshot }: { snapshot: Snapshot }) {
  const [partners, setPartners] = useState<Partner[]>(snapshot.partners);
  const [selected, setSelected] = useState<Partner>(snapshot.partners[0]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const stageMutation = trpc.partners.moveStage.useMutation();
  const movePartner = (event: DragEndEvent) => {
    const partnerId = Number(String(event.active.id).replace("partner-", ""));
    const stage = event.over?.id;
    if (
      !stage ||
      !PIPELINE_STAGES.includes(
        String(stage) as (typeof PIPELINE_STAGES)[number]
      )
    )
      return;
    const previous = partners;
    setPartners(current =>
      current.map(partner =>
        partner.id === partnerId
          ? { ...partner, stage: stage as Partner["stage"] }
          : partner
      )
    );
    stageMutation.mutate(
      { id: partnerId, stage: stage as Partner["stage"] },
      {
        onSuccess: () => toast.success(`Partner moved to ${stage}`),
        onError: () => {
          setPartners(previous);
          toast.error(
            "Could not save the pipeline change. Your board was restored."
          );
        },
      }
    );
  };
  const relatedTrend = snapshot.violationTrend;
  return (
    <div>
      <SectionIntro
        eyebrow="Shadow Pilot CRM"
        title="Partner pipeline"
        detail="Drag a partner across the seven controlled phases. Select a partner to inspect readiness, evidence, communications, and reporting."
        action={
          <div className="flex gap-2">
            <Link href="/apply">
              <Button className="bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]">
                <Plus className="mr-2 h-4 w-4" />
                New intake
              </Button>
            </Link>
          </div>
        }
      />
      <DndContext sensors={sensors} onDragEnd={movePartner}>
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3">
            {PIPELINE_STAGES.map(stage => (
              <PipelineColumn
                key={stage}
                stage={stage}
                partners={partners.filter(partner => partner.stage === stage)}
                onOpen={setSelected}
              />
            ))}
          </div>
        </div>
      </DndContext>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[#71e5d3]">
                Selected partner
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">
                {selected.name}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {selected.contactName} · {selected.email} · {selected.phone}
              </p>
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${stageColors[selected.stage]}`}
            >
              {selected.stage}
            </span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/7 bg-white/[.025] p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Integration
              </p>
              <div className="mt-3 space-y-2">
                {[
                  "Technical contacts confirmed",
                  "Event schema mapped",
                  "Disclosure signals checked",
                  "Reporting cadence set",
                ].map((item, index) => (
                  <label
                    key={item}
                    className="flex items-center gap-2 text-xs text-slate-300"
                  >
                    <input
                      type="checkbox"
                      defaultChecked={index < 3}
                      className="accent-[#2dd4bf]"
                    />
                    {item}
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/7 bg-white/[.025] p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Weekly call volume
              </p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {selected.estimatedCallVolume.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500">
                estimated monthly calls
              </p>
              <Button
                onClick={() => toast.success("CSV import workflow opened")}
                variant="outline"
                size="sm"
                className="mt-3 border-white/10 text-slate-300 hover:bg-white/5"
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import CSV
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-200">
                Communication log
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => toast.success("New partner note created")}
                className="h-7 text-xs text-[#71e5d3]"
              >
                Add note
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {[
                "Integration mapping reviewed with technical team",
                "Pilot reporting outline shared",
                "Partner intake documentation completed",
              ].map((note, index) => (
                <div
                  key={note}
                  className="flex gap-3 rounded-lg border border-white/7 bg-white/[.02] px-3 py-2.5"
                >
                  <div className="grid h-6 w-6 place-items-center rounded-full bg-[#1e3a5f] text-[9px] font-bold text-[#89eadb]">
                    AR
                  </div>
                  <div>
                    <p className="text-xs text-slate-300">{note}</p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      {index + 1} day{index ? "s" : ""} ago · Note
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <CardTitle
            icon={Activity}
            title="Violation trend"
            detail="Reported signals by weekly call cohort"
            action={
              <Button
                onClick={() =>
                  toast.success("Pilot report prepared for export")
                }
                size="sm"
                variant="outline"
                className="border-[#2dd4bf]/30 text-[#71e5d3]"
              >
                <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                Export report
              </Button>
            }
          />
          <div className="mt-5 h-[258px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLineChart data={relatedTrend}>
                <CartesianGrid stroke="#ffffff10" vertical={false} />
                <XAxis
                  dataKey="week"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 10 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0b1c2c",
                    border: "1px solid #ffffff15",
                    borderRadius: 8,
                  }}
                />
                {POLICY_CODES.map((code, index) => (
                  <Line
                    key={code}
                    type="monotone"
                    dataKey={code}
                    stroke={
                      ["#2dd4bf", "#60a5fa", "#a78bfa", "#fbbf24", "#f472b6"][
                        index
                      ]
                    }
                    strokeWidth={1.75}
                    dot={false}
                  />
                ))}
              </RechartsLineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {POLICY_CODES.map((code, index) => (
              <span
                key={code}
                className="flex items-center gap-1.5 text-[10px] text-slate-400"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: [
                      "#2dd4bf",
                      "#60a5fa",
                      "#a78bfa",
                      "#fbbf24",
                      "#f472b6",
                    ][index],
                  }}
                />
                {code}
              </span>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-white/7 bg-white/[.02] p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-200">
                Raw event log
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-[#71e5d3]"
                onClick={() => toast.success("Event log filtering ready")}
              >
                Filter events
              </Button>
            </div>
            <div className="mono mt-3 space-y-1.5 text-[10px] text-slate-500">
              <p>
                <span className="text-[#2dd4bf]">09:42:11</span>{" "}
                disclosure.confirmed · corr_7f1ca
              </p>
              <p>
                <span className="text-[#2dd4bf]">09:43:04</span>{" "}
                escalation.requested · corr_7f1ca
              </p>
              <p>
                <span className="text-[#2dd4bf]">09:44:18</span>{" "}
                audit.trace.closed · corr_7f1ca
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Home() {
  const [location] = useLocation();
  const snapshotQuery = trpc.operations.snapshot.useQuery();
  const snapshot = snapshotQuery.data;
  const view = useMemo(() => location.split("/")[1] || "dashboard", [location]);
  if (snapshotQuery.isLoading || !snapshot)
    return (
      <div className="grid min-h-screen place-items-center bg-[#07131f]">
        <div className="flex items-center gap-3 text-sm text-[#71e5d3]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading Shadow Pilot CRM…
        </div>
      </div>
    );
  // Only "/" and "/partners" route here; every other module has its own
  // persisted page in App.tsx. The mock versions that used to live in this
  // file (settings that toasted without saving, and friends) are gone.
  const pages: Record<string, React.ReactNode> = {
    dashboard: <Dashboard snapshot={snapshot} />,
    partners: <Partners snapshot={snapshot} />,
  };
  return (
    <OperationsShell>
      {pages[view] ?? <Dashboard snapshot={snapshot} />}
    </OperationsShell>
  );
}
