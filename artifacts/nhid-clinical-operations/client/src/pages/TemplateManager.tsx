import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export default function TemplateManager() {
  const templates = trpc.email.templates.useQuery();
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const selected =
    templates.data?.find(item => item.id === selectedId) ?? templates.data?.[0];
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setType(selected.type);
      setSubject(selected.subject);
      setBody(selected.body);
    }
  }, [selected?.id]);
  const save = trpc.email.saveTemplate.useMutation({
    onSuccess: () => {
      toast.success("Response template saved");
      templates.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save templates."),
  });
  const remove = trpc.email.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success("Response template deleted");
      setSelectedId(undefined);
      templates.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to delete templates."),
  });
  const create = () => {
    setSelectedId(undefined);
    setName("New response template");
    setType("General");
    setSubject("");
    setBody("");
  };
  return (
    <OperationsShell>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
            Email command center
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Response templates
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Create, review, update, and delete reusable response templates. All
            outbound content remains subject to human review.
          </p>
        </div>
        <Button
          onClick={create}
          className="bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
        >
          <Plus className="mr-2 h-4 w-4" />
          New template
        </Button>
      </div>
      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <aside className="max-h-[600px] overflow-y-auto rounded-xl border border-white/8 bg-[#0b1c2c] p-3">
          <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">
            Template library · {templates.data?.length ?? 0}
          </p>
          {(templates.data ?? []).map(item => (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={`w-full rounded-lg p-3 text-left ${selected?.id === item.id ? "bg-[#1e3a5f]/65" : "hover:bg-white/[.025]"}`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#71e5d3]">
                {item.type}
              </p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-200">
                {item.name}
              </p>
            </button>
          ))}
        </aside>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              Template name
              <Input
                value={name}
                onChange={event => setName(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <label className="text-xs text-slate-400">
              Type
              <Input
                value={type}
                onChange={event => setType(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
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
              Body
              <Textarea
                value={body}
                onChange={event => setBody(event.target.value)}
                className="mt-2 min-h-64 border-white/8 bg-white/[.025] text-sm leading-6"
              />
            </label>
          </div>
          <div className="mt-5 flex gap-3">
            <Button
              disabled={!name || !type || !subject || !body || save.isPending}
              onClick={() =>
                save.mutate({ id: selected?.id, type, name, subject, body })
              }
              className="bg-[#1e3a5f] hover:bg-[#29507f]"
            >
              <Save className="mr-2 h-4 w-4" />
              Save template
            </Button>
            <Button
              disabled={!selected?.id || remove.isPending}
              onClick={() => selected?.id && remove.mutate({ id: selected.id })}
              variant="outline"
              className="border-rose-400/30 text-rose-300 hover:bg-rose-400/10"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete template
            </Button>
          </div>
        </section>
      </div>
    </OperationsShell>
  );
}
