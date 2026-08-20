import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export default function CampaignManager() {
  const list = trpc.email.campaignDrafts.useQuery();
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const selected =
    list.data?.find(item => item.id === selectedId) ?? list.data?.[0];
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"Draft" | "Review" | "Scheduled">(
    "Draft"
  );
  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setSubject(selected.subject);
      setBody(selected.body);
      setStatus(selected.status);
    }
  }, [selected?.id]);
  const save = trpc.email.saveCampaignDraft.useMutation({
    onSuccess: () => {
      toast.success("Campaign draft saved");
      list.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save campaign drafts."),
  });
  const remove = trpc.email.deleteCampaignDraft.useMutation({
    onSuccess: () => {
      toast.success("Campaign draft deleted");
      setSelectedId(undefined);
      list.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to delete campaign drafts."),
  });
  const create = () => {
    setSelectedId(undefined);
    setName("New campaign");
    setSubject("");
    setBody("");
    setStatus("Draft");
  };
  return (
    <OperationsShell>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
            Email command center
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Campaign drafts
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Build standalone campaign messages through Draft, Review, and
            Scheduled stages. Sending remains outside this workspace.
          </p>
        </div>
        <Button
          onClick={create}
          className="bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
        >
          <Plus className="mr-2 h-4 w-4" />
          New campaign
        </Button>
      </div>
      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <aside className="max-h-[600px] overflow-y-auto rounded-xl border border-white/8 bg-[#0b1c2c] p-3">
          <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">
            Saved campaigns
          </p>
          {(list.data ?? []).length ? (
            (list.data ?? []).map(item => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-lg p-3 text-left ${selected?.id === item.id ? "bg-[#1e3a5f]/65" : "hover:bg-white/[.025]"}`}
              >
                <p className="truncate text-xs font-semibold text-slate-200">
                  {item.name}
                </p>
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  {item.subject}
                </p>
                <span className="mt-2 inline-block rounded bg-[#2dd4bf]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#71e5d3]">
                  {item.status}
                </span>
              </button>
            ))
          ) : (
            <p className="p-3 text-xs text-slate-500">
              No campaign drafts yet.
            </p>
          )}
        </aside>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              Campaign name
              <Input
                value={name}
                onChange={event => setName(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <label className="text-xs text-slate-400">
              Workflow status
              <select
                value={status}
                onChange={event =>
                  setStatus(
                    event.target.value as "Draft" | "Review" | "Scheduled"
                  )
                }
                className="mt-2 block h-10 w-full rounded-md border border-white/8 bg-white/[.025] px-3 text-sm text-slate-200"
              >
                <option>Draft</option>
                <option>Review</option>
                <option>Scheduled</option>
              </select>
            </label>
            <label className="sm:col-span-2 text-xs text-slate-400">
              Subject
              <Input
                value={subject}
                onChange={event => setSubject(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <label className="sm:col-span-2 text-xs text-slate-400">
              Campaign body
              <Textarea
                value={body}
                onChange={event => setBody(event.target.value)}
                className="mt-2 min-h-64 border-white/8 bg-white/[.025] text-sm leading-6"
              />
            </label>
          </div>
          <div className="mt-5 flex gap-3">
            <Button
              disabled={!name || !subject || !body || save.isPending}
              onClick={() =>
                save.mutate({ id: selected?.id, name, subject, body, status })
              }
              className="bg-[#1e3a5f] hover:bg-[#29507f]"
            >
              <Save className="mr-2 h-4 w-4" />
              Save campaign
            </Button>
            <Button
              disabled={!selected?.id || remove.isPending}
              onClick={() => selected?.id && remove.mutate({ id: selected.id })}
              variant="outline"
              className="border-rose-400/30 text-rose-300 hover:bg-rose-400/10"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </section>
      </div>
    </OperationsShell>
  );
}
