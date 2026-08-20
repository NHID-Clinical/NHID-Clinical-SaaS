import { useEffect, useState } from "react";
import { CalendarDays, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export default function CalendarDetail() {
  const list = trpc.calendar.list.useQuery();
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const selected =
    list.data?.find(entry => entry.id === selectedId) ?? list.data?.[0];
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [platform, setPlatform] = useState<"LinkedIn" | "Twitter">("LinkedIn");
  const [status, setStatus] = useState<
    "Idea" | "Draft" | "Scheduled" | "Published"
  >("Idea");
  const [publishDate, setPublishDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setBody(selected.body ?? "");
      setHashtags(selected.hashtags ?? "");
      setPublishedUrl(selected.publishedUrl ?? "");
      setPlatform(selected.platform);
      setStatus(selected.status);
      setPublishDate(new Date(selected.publishDate).toISOString().slice(0, 10));
    }
  }, [selected?.id]);
  const save = trpc.calendar.save.useMutation({
    onSuccess: () => {
      toast.success("Calendar entry saved");
      list.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save content changes."),
  });
  const create = () => {
    setSelectedId(undefined);
    setTitle("");
    setBody("");
    setHashtags("");
    setPublishedUrl("");
    setPlatform("LinkedIn");
    setStatus("Idea");
    setPublishDate(new Date().toISOString().slice(0, 10));
  };
  return (
    <OperationsShell>
      <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
            Content & marketing
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Calendar detail manager
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Manage all 30 seeded entries and add the full post information
            required for publishing operations.
          </p>
        </div>
        <Button
          onClick={create}
          className="bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
        >
          <Plus className="mr-2 h-4 w-4" />
          New entry
        </Button>
      </div>
      <div className="grid gap-5 xl:grid-cols-[330px_1fr]">
        <section className="max-h-[680px] overflow-y-auto rounded-xl border border-white/8 bg-[#0b1c2c] p-3">
          <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">
            All entries · {list.data?.length ?? 0}
          </p>
          {(list.data ?? []).map(entry => (
            <button
              key={entry.id}
              onClick={() => setSelectedId(entry.id)}
              className={`w-full rounded-lg p-3 text-left ${selected?.id === entry.id ? "bg-[#1e3a5f]/65" : "hover:bg-white/[.025]"}`}
            >
              <div className="flex justify-between gap-2">
                <span className="truncate text-xs font-semibold text-slate-200">
                  {entry.title}
                </span>
                <span className="text-[10px] text-slate-500">
                  {new Date(entry.publishDate).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-[#71e5d3]">
                {entry.status} · {entry.platform}
              </p>
            </button>
          ))}
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-4 w-4 text-[#71e5d3]" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                {selected ? "Edit post details" : "Create post details"}
              </h2>
              <p className="text-xs text-slate-500">
                Fields are persisted through the calendar server contract.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2 text-xs text-slate-400">
              Title
              <Input
                value={title}
                onChange={event => setTitle(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <label className="text-xs text-slate-400">
              Platform
              <select
                value={platform}
                onChange={event =>
                  setPlatform(event.target.value as "LinkedIn" | "Twitter")
                }
                className="mt-2 block h-10 w-full rounded-md border border-white/8 bg-white/[.025] px-3 text-sm text-slate-200"
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
                className="mt-2 block h-10 w-full rounded-md border border-white/8 bg-white/[.025] px-3 text-sm text-slate-200"
              >
                <option>Idea</option>
                <option>Draft</option>
                <option>Scheduled</option>
                <option>Published</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Publish date
              <Input
                type="date"
                value={publishDate}
                onChange={event => setPublishDate(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <label className="text-xs text-slate-400">
              Published URL
              <Input
                value={publishedUrl}
                onChange={event => setPublishedUrl(event.target.value)}
                placeholder="https://"
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <label className="sm:col-span-2 text-xs text-slate-400">
              Hashtags
              <Input
                value={hashtags}
                onChange={event => setHashtags(event.target.value)}
                className="mt-2 border-white/8 bg-white/[.025]"
              />
            </label>
            <label className="sm:col-span-2 text-xs text-slate-400">
              Post copy
              <Textarea
                value={body}
                onChange={event => setBody(event.target.value)}
                className="mt-2 min-h-44 border-white/8 bg-white/[.025] text-xs leading-6"
              />
            </label>
          </div>
          <Button
            disabled={!title || save.isPending}
            onClick={() =>
              save.mutate({
                id: selected?.id,
                title,
                body,
                hashtags,
                platform,
                status,
                publishDate: new Date(`${publishDate}T12:00:00`),
                ...(publishedUrl ? { publishedUrl } : {}),
              })
            }
            className="mt-5 bg-[#1e3a5f] hover:bg-[#29507f]"
          >
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Saving…" : "Save calendar entry"}
          </Button>
        </section>
      </div>
    </OperationsShell>
  );
}
