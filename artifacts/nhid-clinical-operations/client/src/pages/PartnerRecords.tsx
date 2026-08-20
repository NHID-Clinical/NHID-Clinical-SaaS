import { useState } from "react";
import { Activity, Filter, MessageSquareText, Search } from "lucide-react";
import { OperationsShell } from "@/components/OperationsShell";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export default function PartnerRecords() {
  const partners = trpc.operations.snapshot.useQuery();
  const [partnerId, setPartnerId] = useState(1);
  const [filter, setFilter] = useState("");
  const details = trpc.partners.detail.useQuery({ id: partnerId });
  const events = (details.data?.events ?? []).filter(event =>
    `${event.eventType} ${event.correlationId} ${event.payload}`
      .toLowerCase()
      .includes(filter.toLowerCase())
  );
  return (
    <OperationsShell>
      <div className="mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
          Shadow Pilot CRM
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Partner records
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Inspect persistent raw events and chronological partner communications
          alongside the selected Shadow Pilot record.
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
        <aside className="rounded-xl border border-white/8 bg-[#0b1c2c] p-3">
          <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">
            Partner directory
          </p>
          {(partners.data?.partners ?? []).map(partner => (
            <button
              key={partner.id}
              onClick={() => setPartnerId(partner.id)}
              className={`w-full rounded-lg p-3 text-left ${partnerId === partner.id ? "bg-[#1e3a5f]/65" : "hover:bg-white/[.025]"}`}
            >
              <p className="text-xs font-semibold text-slate-200">
                {partner.name}
              </p>
              <p className="mt-1 text-[10px] text-[#71e5d3]">
                {partner.stage} · {partner.platform}
              </p>
            </button>
          ))}
        </aside>
        <div className="space-y-5">
          <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
            <div className="flex items-center gap-3">
              <Activity className="h-4 w-4 text-[#71e5d3]" />
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Raw event log
                </h2>
                <p className="text-xs text-slate-500">
                  {details.data?.partner?.name ?? "Loading partner"} ·
                  query-backed operational evidence
                </p>
              </div>
            </div>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder="Filter event type, correlation ID, or payload"
                className="border-white/8 bg-white/[.025] pl-9"
              />
            </div>
            <div className="mt-4 space-y-3">
              {details.isLoading ? (
                <p className="text-sm text-slate-500">Loading raw events…</p>
              ) : events.length ? (
                events.map(event => (
                  <article
                    key={event.id}
                    className="rounded-lg border border-white/7 bg-white/[.02] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="mono text-xs font-semibold text-[#71e5d3]">
                        {event.eventType}
                      </span>
                      <span className="mono text-[10px] text-slate-500">
                        {event.correlationId}
                      </span>
                    </div>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-slate-400">
                      {event.payload}
                    </pre>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-500">
                  No events match this filter.
                </p>
              )}
            </div>
          </section>
          <section className="rounded-xl border border-white/8 bg-[#0b1c2c] p-5">
            <div className="flex items-center gap-3">
              <MessageSquareText className="h-4 w-4 text-[#71e5d3]" />
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Communication timeline
                </h2>
                <p className="text-xs text-slate-500">
                  Chronological persisted partner activity
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-4 border-l border-[#2dd4bf]/20 pl-5">
              {(details.data?.communications ?? []).length ? (
                (details.data?.communications ?? []).map(item => (
                  <article key={item.id} className="relative">
                    <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full bg-[#2dd4bf] shadow-[0_0_10px_#2dd4bf]" />
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/7 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
                        {item.type}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-200">
                      {item.subject}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      {item.body}
                    </p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-500">
                  No saved communications for this partner.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </OperationsShell>
  );
}
