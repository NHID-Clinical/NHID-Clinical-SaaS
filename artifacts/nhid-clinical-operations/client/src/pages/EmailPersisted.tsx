import { useEffect, useState } from "react";
import { Mail, Plus, Save, Sparkles, Tag } from "lucide-react";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

const categories = [
  "Pilot Inquiry",
  "Pricing",
  "Integration",
  "Consulting",
  "Media",
  "Investor",
  "Research",
  "Vendor",
  "General",
] as const;

export default function EmailPersisted() {
  const inbox = trpc.email.inbox.useQuery();
  const templates = trpc.email.templates.useQuery();
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const email =
    inbox.data?.find(item => item.id === selectedId) ?? inbox.data?.[0];
  const [category, setCategory] =
    useState<(typeof categories)[number]>("General");
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (email) {
      setCategory(email.category);
      setDraft("");
    }
  }, [email?.id]);
  const categorize = trpc.email.categorize.useQuery(
    { subject: email?.subject ?? "Message", body: email?.body ?? "General" },
    { enabled: Boolean(email) }
  );
  const apply = trpc.email.applyCategory.useMutation({
    onSuccess: () => {
      toast.success("Inbox category saved");
      inbox.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save category changes."),
  });
  const generate = trpc.email.generateDraft.useMutation({
    onSuccess: result => {
      setDraft(result.draft);
      toast.success(`Draft placed in ${result.status} (${result.source}).`);
    },
    onError: () => toast.error("Could not generate the reviewed draft."),
  });
  const [templateId, setTemplateId] = useState<number | undefined>();
  const template =
    templates.data?.find(item => item.id === templateId) ?? templates.data?.[0];
  const [templateName, setTemplateName] = useState("");
  const [templateType, setTemplateType] = useState("Pilot Inquiry");
  const [templateSubject, setTemplateSubject] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  useEffect(() => {
    if (template) {
      setTemplateId(template.id);
      setTemplateName(template.name);
      setTemplateType(template.type);
      setTemplateSubject(template.subject);
      setTemplateBody(template.body);
    }
  }, [template?.id]);
  const saveTemplate = trpc.email.saveTemplate.useMutation({
    onSuccess: () => {
      toast.success("Response template saved");
      templates.refetch();
    },
    onError: () =>
      toast.error("Sign in as an administrator to save templates."),
  });
  if (inbox.isLoading || templates.isLoading)
    return (
      <OperationsShell>
        <div className="grid min-h-[55vh] place-items-center text-sm text-slate-400">
          Loading inbox and approved response templates…
        </div>
      </OperationsShell>
    );
  if (inbox.error || templates.error)
    return (
      <OperationsShell>
        <div className="max-w-xl rounded-xl border border-rose-400/20 bg-rose-400/5 p-6">
          <p className="text-sm font-semibold text-rose-200">
            Email workspace unavailable
          </p>
          <p className="mt-2 text-sm text-slate-400">
            The inbox or template library could not be retrieved. Refresh the
            workspace and try again.
          </p>
          <Button
            onClick={() => {
              inbox.refetch();
              templates.refetch();
            }}
            className="mt-4 bg-[#1e3a5f] hover:bg-[#29507f]"
          >
            Retry retrieval
          </Button>
        </div>
      </OperationsShell>
    );
  return (
    <OperationsShell>
      <div className="mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
          Email command center
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Review and response operations
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Classify inbound communication, create knowledge-grounded drafts for
          human review, and manage reusable response or campaign-draft
          templates.
        </p>
      </div>
      <div className="grid gap-5 2xl:grid-cols-[330px_1fr_360px]">
        <aside className="max-h-[680px] overflow-y-auto rounded-xl border border-white/8 bg-[#0b1c2c] p-3">
          <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">
            Inbound queue · {inbox.data?.length ?? 0}
          </p>
          {(inbox.data ?? []).map(item => (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={`w-full rounded-lg p-3 text-left ${email?.id === item.id ? "bg-[#1e3a5f]/65" : "hover:bg-white/[.025]"}`}
            >
              <p className="truncate text-xs font-semibold text-slate-200">
                {item.sender}
              </p>
              <p className="mt-1 truncate text-xs text-slate-400">
                {item.subject}
              </p>
              <div className="mt-2 flex justify-between">
                <span className="text-[10px] text-[#71e5d3]">
                  {item.category}
                </span>
                <span className="text-[10px] text-slate-500">
                  {item.status}
                </span>
              </div>
            </button>
          ))}
        </aside>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex gap-3">
            <Mail className="h-4 w-4 text-[#71e5d3]" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                {email?.subject ?? "Select an email"}
              </h2>
              <p className="text-xs text-slate-500">
                {email?.sender ?? "No message selected"}
              </p>
            </div>
          </div>
          {email ? (
            <>
              <div className="mt-5 rounded-lg border border-white/7 bg-white/[.02] p-4 text-sm leading-6 text-slate-300">
                {email.body}
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="text-xs text-slate-400">
                  Category
                  <select
                    value={category}
                    onChange={event =>
                      setCategory(
                        event.target.value as (typeof categories)[number]
                      )
                    }
                    className="mt-2 block h-10 rounded-md border border-white/8 bg-white/[.025] px-3 text-sm text-slate-200"
                  >
                    {categories.map(item => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <span className="text-xs text-slate-500">
                  Auto-confidence:{" "}
                  {categorize.data?.confidence ?? email.confidence}%
                </span>
                <Button
                  size="sm"
                  disabled={apply.isPending}
                  onClick={() => apply.mutate({ id: email.id, category })}
                  variant="outline"
                  className="border-white/12"
                >
                  <Tag className="mr-2 h-3.5 w-3.5" />
                  Save category
                </Button>
              </div>
              <Button
                disabled={generate.isPending}
                onClick={() =>
                  generate.mutate({
                    senderName: email.sender,
                    subject: email.subject,
                    category,
                  })
                }
                className="mt-5 bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {generate.isPending ? "Drafting…" : "Generate AI draft"}
              </Button>
              {draft ? (
                <div className="mt-4 rounded-lg border border-[#2dd4bf]/20 bg-[#2dd4bf]/5 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#71e5d3]">
                    Draft → Review → Send
                  </p>
                  <Textarea
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    className="mt-3 min-h-36 border-white/8 bg-[#07131f]/50 text-sm leading-6"
                  />
                  <p className="mt-2 text-[11px] text-slate-500">
                    Human review is required before any send action.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
        <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Template & campaign drafts
              </h2>
              <p className="text-xs text-slate-500">
                Ten seeded response templates
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setTemplateId(undefined);
                setTemplateName("New campaign draft");
                setTemplateType("Campaign");
                setTemplateSubject("");
                setTemplateBody("");
              }}
              variant="outline"
              className="border-white/12"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <select
            value={templateId ?? ""}
            onChange={event => {
              const value = Number(event.target.value);
              setTemplateId(value || undefined);
            }}
            className="mt-4 h-10 w-full rounded-md border border-white/8 bg-white/[.025] px-3 text-sm text-slate-200"
          >
            <option value="">New template</option>
            {(templates.data ?? []).map(item => (
              <option key={item.id} value={item.id}>
                {item.type}: {item.name}
              </option>
            ))}
          </select>
          <label className="mt-3 block text-xs text-slate-400">
            Template name
            <Input
              value={templateName}
              onChange={event => setTemplateName(event.target.value)}
              className="mt-2 border-white/8 bg-white/[.025]"
            />
          </label>
          <label className="mt-3 block text-xs text-slate-400">
            Type
            <Input
              value={templateType}
              onChange={event => setTemplateType(event.target.value)}
              className="mt-2 border-white/8 bg-white/[.025]"
            />
          </label>
          <label className="mt-3 block text-xs text-slate-400">
            Subject
            <Input
              value={templateSubject}
              onChange={event => setTemplateSubject(event.target.value)}
              className="mt-2 border-white/8 bg-white/[.025]"
            />
          </label>
          <label className="mt-3 block text-xs text-slate-400">
            Body
            <Textarea
              value={templateBody}
              onChange={event => setTemplateBody(event.target.value)}
              className="mt-2 min-h-28 border-white/8 bg-white/[.025] text-xs"
            />
          </label>
          <Button
            disabled={
              saveTemplate.isPending ||
              !templateName ||
              !templateSubject ||
              !templateBody
            }
            onClick={() =>
              saveTemplate.mutate({
                id: templateId,
                type: templateType,
                name: templateName,
                subject: templateSubject,
                body: templateBody,
              })
            }
            className="mt-4 bg-[#1e3a5f] hover:bg-[#29507f]"
          >
            <Save className="mr-2 h-4 w-4" />
            Save template
          </Button>
        </section>
      </div>
    </OperationsShell>
  );
}
