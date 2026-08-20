import { useState } from "react";
import { Download, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type ControlResult = {
  code: string;
  grade: string;
  status: string;
  finding: string;
  evidence: Array<{ turn: number; speaker: string; quote: string }>;
};

/** A control with no trigger is exported as "Not evaluated", never as a grade. */
const displayGrade = (result: { grade: string; status: string }) =>
  result.status === "not-evaluated" ? "Not evaluated" : result.grade;

function downloadCsv(
  callId: string,
  overall: string,
  controls: ControlResult[]
) {
  const rows = [
    [
      "Call ID",
      "Overall Grade",
      "Policy Code",
      "Result",
      "Finding",
      "Evidence",
    ],
    ...controls.map(item => [
      callId,
      overall,
      item.code,
      displayGrade(item),
      item.finding,
      item.evidence
        .map(entry => `turn ${entry.turn + 1}: ${entry.quote}`)
        .join(" | "),
    ]),
  ];
  const content = rows
    .map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${callId}-evaluation.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function EvaluationPersisted() {
  const [callId, setCallId] = useState("DEMO-001");
  const [transcript, setTranscript] = useState(
    "Agent: Hello, you are speaking with an automated assistant.\nCaller: Hi, I need to reschedule my appointment.\nAgent: I can help with that. Can you confirm your date of birth?\nCaller: Actually, I would rather speak to a person.\nAgent: Of course, connecting you to a representative now."
  );
  const score = trpc.evaluations.scoreTranscript.useMutation({
    onError: () =>
      toast.error(
        "Provide a call identifier and at least 20 characters of transcript text."
      ),
  });
  const report = score.data;
  return (
    <OperationsShell>
      <div className="mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
          Call evaluation workbench
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Score transcript evidence
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Paste transcript evidence or import a text, CSV, or JSON source into
          the controlled five-policy evaluation flow.
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_.9fr]">
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex items-center gap-3">
            <FileText className="h-4 w-4 text-[#71e5d3]" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                Transcript input
              </h2>
              <p className="text-xs text-slate-500">
                Manual paste, CSV, JSON, or plain-text source
              </p>
            </div>
          </div>
          <label className="mt-5 block text-xs text-slate-400">
            Call identifier
            <Input
              value={callId}
              onChange={event => setCallId(event.target.value)}
              className="mt-2 border-white/8 bg-white/[.025]"
            />
          </label>
          <label className="mt-4 block text-xs text-slate-400">
            Transcript
            <span className="mt-1 block text-[11px] text-slate-600">
              One turn per line. Prefix lines with “Agent:” / “Caller:” — ATR-01
              needs speaker attribution to score above B.
            </span>
            <Textarea
              value={transcript}
              onChange={event => setTranscript(event.target.value)}
              className="mt-2 min-h-64 border-white/8 bg-white/[.025] text-xs leading-6"
            />
          </label>
          <label className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-md border border-white/10 px-3 text-xs text-slate-300 hover:bg-white/5">
            <Upload className="mr-2 h-4 w-4" />
            Import source file
            <input
              type="file"
              accept=".txt,.csv,.json,text/plain,text/csv,application/json"
              className="sr-only"
              onChange={async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                const content = await file.text();
                setTranscript(content);
                setCallId(file.name.replace(/\.[^.]+$/, "").slice(0, 64));
                toast.success(
                  "Source loaded; review the transcript before scoring."
                );
                event.currentTarget.value = "";
              }}
            />
          </label>
          <Button
            disabled={score.isPending}
            onClick={() => score.mutate({ callId, transcript })}
            className="mt-4 w-full bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
          >
            {score.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scoring evidence…
              </>
            ) : (
              "Score transcript"
            )}
          </Button>
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Evaluation report card
              </h2>
              <p className="text-xs text-slate-500">
                Grades are restricted to A, B, C, and F. Controls with no
                trigger in the transcript report as not evaluated.
              </p>
            </div>
            {report ? (
              <span
                className={`grid h-10 w-10 place-items-center rounded-lg text-lg font-bold ${report.overallGrade === "A" ? "bg-[#2dd4bf]/10 text-[#71e5d3]" : report.overallGrade === "B" ? "bg-blue-400/10 text-blue-300" : report.overallGrade === "C" ? "bg-amber-400/10 text-amber-300" : "bg-rose-400/10 text-rose-300"}`}
              >
                {report.overallGrade}
              </span>
            ) : null}
          </div>
          {report ? (
            <div className="mt-5">
              <div className="space-y-3">
                {report.policyResults.map(result => (
                  <div
                    key={result.code}
                    className="rounded-lg border border-white/7 bg-white/[.02] p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="mono text-xs font-semibold text-[#71e5d3]">
                        {result.code}
                      </span>
                      <span
                        className={`rounded px-2 py-1 text-xs font-bold ${
                          result.status === "not-evaluated"
                            ? "bg-white/5 text-slate-400"
                            : result.grade === "A"
                              ? "bg-[#2dd4bf]/10 text-[#71e5d3]"
                              : result.grade === "B"
                                ? "bg-blue-400/10 text-blue-300"
                                : result.grade === "C"
                                  ? "bg-amber-400/10 text-amber-300"
                                  : "bg-rose-400/10 text-rose-300"
                        }`}
                      >
                        {displayGrade(result)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      {result.finding}
                    </p>
                    {result.evidence.length ? (
                      <ul className="mt-3 space-y-1.5 border-l-2 border-white/10 pl-3">
                        {result.evidence.map((entry, index) => (
                          <li
                            key={index}
                            className="text-[11px] leading-5 text-slate-500"
                          >
                            <span className="text-slate-600">
                              turn {entry.turn + 1} · {entry.speaker}
                            </span>{" "}
                            <span className="italic text-slate-400">
                              “{entry.quote}”
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
              <Button
                onClick={() => {
                  downloadCsv(
                    report.callId,
                    report.overallGrade,
                    report.policyResults
                  );
                  toast.success("Evaluation downloaded as CSV.");
                }}
                variant="outline"
                className="mt-5 border-[#2dd4bf]/30 text-[#71e5d3]"
              >
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
            </div>
          ) : (
            <div className="grid min-h-80 place-items-center text-center">
              <p className="max-w-xs text-sm leading-6 text-slate-500">
                Run a transcript through the policy engine to create an
                explainable evaluation report card.
              </p>
            </div>
          )}
        </section>
      </div>
    </OperationsShell>
  );
}
