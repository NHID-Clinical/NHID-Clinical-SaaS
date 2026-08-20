import { useEffect, useState } from "react";
import { BookOpen, Plus, Save, Search } from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export default function KnowledgePersisted() {
  const list = trpc.knowledge.list.useQuery();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const articles = (list.data ?? []).filter(article =>
    `${article.title} ${article.tag} ${article.body}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const selected =
    articles.find(article => article.id === selectedId) ?? articles[0];
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setTag(selected.tag);
      setBody(selected.body);
    }
  }, [selected?.id]);
  const save = trpc.knowledge.save.useMutation({
    onSuccess: () => {
      toast.success("Knowledge article saved");
      list.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save knowledge content."),
  });
  const newArticle = () => {
    setSelectedId(undefined);
    setTitle("New knowledge article");
    setTag("Operations");
    setBody(
      "# New knowledge article\n\nAdd reviewed operational content here."
    );
  };
  return (
    <OperationsShell>
      <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
            Knowledge base engine
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Operational knowledge editor
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Search, edit, and render Markdown source material for controls,
            pilots, integrations, terms, and the 20-question FAQ.
          </p>
        </div>
        <Button
          onClick={newArticle}
          className="bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
        >
          <Plus className="mr-2 h-4 w-4" />
          New article
        </Button>
      </div>
      <div className="grid gap-5 xl:grid-cols-[310px_1fr]">
        <aside className="max-h-[720px] overflow-y-auto rounded-xl border border-white/8 bg-[#0b1c2c] p-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search knowledge"
              className="border-white/8 bg-white/[.025] pl-9 text-xs"
            />
          </div>
          <div className="mt-4 space-y-1">
            {articles.map(article => (
              <button
                key={article.id}
                onClick={() => setSelectedId(article.id)}
                className={`w-full rounded-lg p-3 text-left ${selected?.id === article.id ? "bg-[#1e3a5f]/65" : "hover:bg-white/[.025]"}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#71e5d3]">
                  {article.tag}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-200">
                  {article.title}
                </p>
              </button>
            ))}
          </div>
        </aside>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex items-center gap-3">
            <BookOpen className="h-4 w-4 text-[#71e5d3]" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                Markdown authoring
              </h2>
              <p className="text-xs text-slate-500">
                Content is stored in the knowledge article database.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_180px]">
            <Input
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Article title"
              className="border-white/8 bg-white/[.025]"
            />
            <Input
              value={tag}
              onChange={event => setTag(event.target.value)}
              placeholder="Tag"
              className="border-white/8 bg-white/[.025]"
            />
          </div>
          <div className="mt-4 grid gap-5 xl:grid-cols-2">
            <Textarea
              value={body}
              onChange={event => setBody(event.target.value)}
              className="min-h-[420px] border-white/8 bg-white/[.025] font-mono text-xs leading-6"
            />
            <article className="min-h-[420px] rounded-lg border border-white/7 bg-white/[.02] p-5 text-sm leading-7 text-slate-300">
              <Streamdown>{body}</Streamdown>
            </article>
          </div>
          <Button
            disabled={!title || !tag || body.length < 10 || save.isPending}
            onClick={() => save.mutate({ id: selected?.id, title, tag, body })}
            className="mt-5 bg-[#1e3a5f] hover:bg-[#29507f]"
          >
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Saving…" : "Save Markdown article"}
          </Button>
        </section>
      </div>
    </OperationsShell>
  );
}
