import { useState } from "react";
import { Download, FileUp, Loader2 } from "lucide-react";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export default function PartnerEvidence() {
  const utils = trpc.useUtils();
  const snapshot = trpc.operations.snapshot.useQuery();
  const [partnerId, setPartnerId] = useState(1);
  const [lastImport, setLastImport] = useState<string | null>(null);
  const partner =
    snapshot.data?.partners.find(item => item.id === partnerId) ??
    snapshot.data?.partners[0];
  const importCsv = trpc.partners.importCallVolume.useMutation({
    onSuccess: async result => {
      setLastImport(
        `Stored ${result.rows} weekly rows totaling ${result.totalCalls.toLocaleString()} calls.`
      );
      await utils.operations.snapshot.invalidate();
      toast.success(
        `Imported ${result.rows} weeks / ${result.totalCalls.toLocaleString()} calls.`
      );
    },
    onError: error => toast.error(error.message),
  });
  const exportReport = () => {
    if (!partner) return;
    const document = new jsPDF();
    document.setFillColor(30, 58, 95);
    document.rect(0, 0, 210, 32, "F");
    document.setTextColor(255, 255, 255);
    document.setFontSize(18);
    document.text("Shadow Pilot Report", 18, 20);
    document.setTextColor(27, 43, 55);
    document.setFontSize(12);
    document.text(`Partner: ${partner.name}`, 18, 48);
    document.text(`Stage: ${partner.stage}`, 18, 58);
    document.text(`Platform: ${partner.platform}`, 18, 68);
    document.text(
      `Estimated monthly volume: ${partner.estimatedCallVolume.toLocaleString()} calls`,
      18,
      78
    );
    document.text(
      "Evidence controls: IDG-01, PDX-01, DBC-01, EIT-01, and ATR-01.",
      18,
      94,
      { maxWidth: 168 }
    );
    document.setFontSize(9);
    document.setTextColor(88, 103, 121);
    document.text(
      `Generated ${new Date().toLocaleString()} · Human-reviewed operational report`,
      18,
      277
    );
    document.save(
      `shadow-pilot-${partner.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report.pdf`
    );
    toast.success("Pilot report downloaded as PDF.");
  };
  return (
    <OperationsShell>
      <div className="mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
          Shadow Pilot CRM
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Partner evidence & reporting
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Import weekly CSV call volume, receive parsed evidence feedback, and
          download a one-click operational pilot report.
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[310px_1fr]">
        <aside className="rounded-xl border border-white/8 bg-[#0b1c2c] p-3">
          <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">
            Select partner
          </p>
          {(snapshot.data?.partners ?? []).map(item => (
            <button
              key={item.id}
              onClick={() => setPartnerId(item.id)}
              className={`w-full rounded-lg p-3 text-left ${partner?.id === item.id ? "bg-[#1e3a5f]/65" : "hover:bg-white/[.025]"}`}
            >
              <p className="text-xs font-semibold text-slate-200">
                {item.name}
              </p>
              <p className="mt-1 text-[10px] text-[#71e5d3]">
                {item.stage} · {item.platform}
              </p>
            </button>
          ))}
        </aside>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-6">
          <h2 className="text-lg font-semibold text-white">
            {partner?.name ?? "Loading partner"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {partner?.estimatedCallVolume.toLocaleString() ?? "—"} estimated
            monthly calls · {partner?.platform}
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#2dd4bf]/30 bg-[#2dd4bf]/5 p-5 text-center hover:bg-[#2dd4bf]/10">
              <FileUp className="h-6 w-6 text-[#71e5d3]" />
              <span className="mt-3 text-sm font-semibold text-slate-200">
                Import weekly call-volume CSV
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Expected columns include week and calls.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async event => {
                  const file = event.target.files?.[0];
                  if (!file || !partner) return;
                  const csvContent = await file.text();
                  importCsv.mutate({
                    partnerId: partner.id,
                    fileName: file.name,
                    csvContent,
                  });
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-white/8 bg-white/[.02] p-5 text-center">
              <Download className="h-6 w-6 text-[#71e5d3]" />
              <p className="mt-3 text-sm font-semibold text-slate-200">
                One-click pilot report
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Download a formatted PDF summary of the selected pilot.
              </p>
              <Button
                onClick={exportReport}
                className="mt-4 bg-[#1e3a5f] hover:bg-[#29507f]"
              >
                <Download className="mr-2 h-4 w-4" />
                Download report
              </Button>
            </div>
          </div>
          {importCsv.isPending ? (
            <p className="mt-4 inline-flex items-center text-sm text-[#71e5d3]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading and parsing CSV evidence…
            </p>
          ) : null}
          {lastImport ? (
            <p className="mt-4 rounded-md border border-[#2dd4bf]/20 bg-[#2dd4bf]/5 p-3 text-sm text-[#a6f4e7]">
              {lastImport} Workspace data refreshed.
            </p>
          ) : null}
        </section>
      </div>
    </OperationsShell>
  );
}
