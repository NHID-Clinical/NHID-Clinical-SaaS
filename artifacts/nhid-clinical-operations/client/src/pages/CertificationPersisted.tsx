import { jsPDF } from "jspdf";
import {
  CheckCircle2,
  FileDown,
  GraduationCap,
  Lock,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const modules = ["101", "102", "103", "104", "105", "106", "107"] as const;

export default function CertificationPersisted() {
  const progress = trpc.certification.progress.useQuery({ traineeId: 1 });
  const completed = progress.data?.progress.length ?? 0;
  const complete = trpc.certification.completeModule.useMutation({
    onSuccess: result => {
      toast.success(
        result.certified
          ? `All ${result.totalModules} modules complete — trainee certified.`
          : `Assessment saved (${result.completedModules}/${result.totalModules} modules).`
      );
      progress.refetch();
    },
    onError: error =>
      toast.error(error.message || "Could not save the assessment."),
  });
  const downloadCertificate = () => {
    if (progress.data?.trainee?.status !== "Certified") {
      toast.error(
        "The trainee must have a persisted Certified status before issuing a certificate."
      );
      return;
    }
    const name = progress.data?.trainee?.name ?? "Consultant";
    const document = new jsPDF();
    document.setFillColor(30, 58, 95);
    document.rect(0, 0, 210, 34, "F");
    document.setTextColor(255, 255, 255);
    document.setFontSize(19);
    document.text("NHID-Clinical Consultant Certificate", 26, 22);
    document.setTextColor(28, 43, 56);
    document.setFontSize(20);
    document.text(name, 72, 88);
    document.setFontSize(11);
    document.text(
      "has completed modules 101 through 107 in the Shadow Pilot CRM certification track.",
      26,
      106,
      { maxWidth: 160 }
    );
    document.text(`Issued ${new Date().toLocaleDateString()}`, 26, 264);
    document.save("nhid-clinical-consultant-certificate.pdf");
    toast.success("Certificate downloaded as PDF.");
  };
  return (
    <OperationsShell>
      <div className="mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
          Consultant certification
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Trainee readiness tracker
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Progress loads from the certification record and only supports a
          certificate after all seven modules are complete.
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#2dd4bf]/10 text-[#71e5d3]">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {progress.data?.trainee?.name ?? "Alex Morgan"}
              </h2>
              <p className="text-xs text-slate-500">
                {progress.data?.trainee?.email ?? "alex.morgan@example.org"}
              </p>
            </div>
          </div>
          <div className="mt-6 rounded-lg border border-[#2dd4bf]/15 bg-[#2dd4bf]/5 p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Persisted completion
            </p>
            <p className="mt-1 text-3xl font-semibold text-white">
              {completed}
              <span className="text-base font-medium text-slate-500">
                {" "}
                / 7 modules
              </span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-[#2dd4bf]"
                style={{ width: `${(completed / modules.length) * 100}%` }}
              />
            </div>
            <Button
              disabled={progress.data?.trainee?.status !== "Certified"}
              onClick={downloadCertificate}
              className="mt-5 bg-[#1e3a5f] hover:bg-[#29507f]"
            >
              <FileDown className="mr-2 h-4 w-4" />
              Download certificate
            </Button>
          </div>
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <h2 className="text-sm font-semibold text-white">
            Module assessment records
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {modules.map((module, index) => {
              const completeRecord = progress.data?.progress.find(
                item => item.module === module
              );
              const unlocked = index <= completed;
              return (
                <button
                  key={module}
                  disabled={
                    !unlocked || complete.isPending || Boolean(completeRecord)
                  }
                  onClick={() =>
                    complete.mutate({ traineeId: 1, module, score: 93 })
                  }
                  className={`flex items-center justify-between rounded-lg border p-4 text-left ${completeRecord ? "border-[#2dd4bf]/25 bg-[#2dd4bf]/5" : unlocked ? "border-white/12 bg-white/[.025] hover:border-[#2dd4bf]/30" : "border-white/7 bg-white/[.01] opacity-60"}`}
                >
                  <div>
                    <p className="mono text-xs font-semibold text-slate-200">
                      Module {module}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {completeRecord
                        ? `Saved score: ${completeRecord.score ?? "—"}`
                        : unlocked
                          ? "Save 93% assessment"
                          : "Locked"}
                    </p>
                  </div>
                  {completeRecord ? (
                    <CheckCircle2 className="h-4 w-4 text-[#2dd4bf]" />
                  ) : unlocked ? (
                    <Save className="h-4 w-4 text-slate-400" />
                  ) : (
                    <Lock className="h-4 w-4 text-slate-600" />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </OperationsShell>
  );
}
