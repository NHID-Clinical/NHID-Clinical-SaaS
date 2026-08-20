import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const US = "NHID-Clinical";

export default function MatrixManager() {
  const matrix = trpc.intelligence.matrix.useQuery();
  const competitors = trpc.intelligence.list.useQuery();

  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [capability, setCapability] = useState("");
  const [cells, setCells] = useState<Record<string, string>>({});
  const [isNew, setIsNew] = useState(false);

  /**
   * Column set is derived from the competitors table, so adding a competitor
   * adds a column. It used to be five hardcoded fields.
   */
  const subjects = useMemo(
    () => [US, ...(competitors.data ?? []).map(entry => entry.name)],
    [competitors.data]
  );

  const selected = isNew
    ? undefined
    : (matrix.data?.find(item => item.id === selectedId) ?? matrix.data?.[0]);

  useEffect(() => {
    if (!selected) return;
    setCapability(selected.capability);
    setCells(
      Object.fromEntries(
        subjects.map(subject => [
          subject,
          selected.cells.find(cell => cell.subject === subject)?.value ?? "—",
        ])
      )
    );
  }, [selected?.id, subjects.join("|")]);

  const save = trpc.intelligence.saveMatrixRow.useMutation({
    onSuccess: () => {
      toast.success("Comparison matrix row saved");
      setIsNew(false);
      matrix.refetch();
    },
    onError: error =>
      toast.error(error.message || "Could not save the comparison row."),
  });

  const startNew = () => {
    setIsNew(true);
    setSelectedId(undefined);
    setCapability("");
    setCells(Object.fromEntries(subjects.map(subject => [subject, "—"])));
  };

  const isLoading = matrix.isLoading || competitors.isLoading;
  const error = matrix.error ?? competitors.error;

  return (
    <OperationsShell>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
            Competitive intelligence
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Feature comparison matrix
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Capabilities are rows and competitors are columns loaded from the
            competitor list, so adding a competitor no longer requires a schema
            change.
          </p>
        </div>
        <Button
          onClick={startNew}
          variant="outline"
          className="border-white/10 text-slate-300"
        >
          <Plus className="mr-2 h-4 w-4" />
          New capability
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-[#0b1c2c] p-8 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-[#71e5d3]" />
          Loading the comparison matrix…
        </div>
      ) : error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-400/25 bg-red-500/5 p-5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="text-sm font-semibold text-red-200">
              The comparison matrix could not be loaded.
            </p>
            <p className="mt-1 text-xs text-red-200/70">{error.message}</p>
            <Button
              onClick={() => {
                matrix.refetch();
                competitors.refetch();
              }}
              variant="outline"
              className="mt-3 border-red-400/30 text-red-100"
            >
              Try again
            </Button>
          </div>
        </div>
      ) : !matrix.data?.length ? (
        <div className="rounded-xl border border-white/8 bg-[#0b1c2c] p-8 text-center">
          <p className="text-sm font-semibold text-slate-200">
            No capabilities yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs text-slate-500">
            Add the first capability to start comparing NHID-Clinical against
            the tracked competitors.
          </p>
          <Button
            onClick={startNew}
            className="mt-4 bg-[#1e3a5f] hover:bg-[#29507f]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add a capability
          </Button>
        </div>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-white/8 bg-[#0b1c2c]">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead className="border-b border-white/8 text-[10px] uppercase tracking-[.14em] text-slate-500">
              <tr>
                <th className="p-3">Capability</th>
                {subjects.map(subject => (
                  <th key={subject} className="p-3">
                    {subject}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.data.map(item => (
                <tr
                  key={item.id}
                  onClick={() => {
                    setIsNew(false);
                    setSelectedId(item.id);
                  }}
                  className={`cursor-pointer border-b border-white/7 ${
                    selected?.id === item.id
                      ? "bg-[#1e3a5f]/35"
                      : "hover:bg-white/[.025]"
                  }`}
                >
                  <td className="p-3 font-medium text-slate-200">
                    {item.capability}
                  </td>
                  {subjects.map(subject => (
                    <td
                      key={subject}
                      className={
                        subject === US
                          ? "p-3 text-[#71e5d3]"
                          : "p-3 text-slate-400"
                      }
                    >
                      {item.cells.find(cell => cell.subject === subject)
                        ?.value ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-5 rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
        <h2 className="text-sm font-semibold text-white">
          {isNew ? "Create capability" : "Edit selected capability"}
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs text-slate-400 sm:col-span-2 xl:col-span-1">
            Capability
            <Input
              value={capability}
              onChange={event => setCapability(event.target.value)}
              placeholder="e.g. Call-level evaluation"
              className="mt-2 border-white/8 bg-white/[.025]"
            />
          </label>
          {subjects.map(subject => (
            <label key={subject} className="text-xs text-slate-400">
              {subject}
              <Input
                value={cells[subject] ?? ""}
                onChange={event =>
                  setCells(current => ({
                    ...current,
                    [subject]: event.target.value,
                  }))
                }
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
          ))}
        </div>
        <Button
          disabled={capability.trim().length < 2 || save.isPending}
          onClick={() =>
            save.mutate({
              id: isNew ? undefined : selected?.id,
              capability: capability.trim(),
              sortOrder: selected?.sortOrder ?? matrix.data?.length ?? 0,
              cells: Object.fromEntries(
                Object.entries(cells).filter(([, value]) => value.trim())
              ),
            })
          }
          className="mt-5 bg-[#1e3a5f] hover:bg-[#29507f]"
        >
          <Save className="mr-2 h-4 w-4" />
          {save.isPending ? "Saving…" : "Save comparison row"}
        </Button>
      </section>
    </OperationsShell>
  );
}
