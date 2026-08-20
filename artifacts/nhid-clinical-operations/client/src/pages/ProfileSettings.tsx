import { useEffect, useState } from "react";
import { ArrowLeft, Save, UserRound } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { OperationsShell } from "@/components/OperationsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export default function ProfileSettings() {
  const profile = trpc.profile.me.useQuery();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (profile.data) {
      setName(profile.data.name ?? "");
      setEmail(profile.data.email ?? "");
    }
  }, [profile.data]);
  const save = trpc.profile.save.useMutation({
    onSuccess: () => {
      toast.success("Profile settings saved");
      profile.refetch();
    },
    onError: () => toast.error("Sign in to manage your profile settings."),
  });
  if (profile.isLoading)
    return (
      <OperationsShell>
        <div className="grid min-h-[55vh] place-items-center">
          <p className="text-sm text-slate-400">
            Loading your authenticated profile…
          </p>
        </div>
      </OperationsShell>
    );
  if (profile.error || !profile.data)
    return (
      <OperationsShell>
        <div className="max-w-xl rounded-xl border border-amber-400/20 bg-amber-400/5 p-6">
          <p className="text-sm font-semibold text-amber-200">
            Profile sign-in required
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Sign in to view and update your personal workspace profile. Your
            organization settings remain available separately.
          </p>
          <Link
            href="/settings"
            className="mt-4 inline-flex text-sm text-[#71e5d3] hover:text-white"
          >
            Return to Settings
          </Link>
        </div>
      </OperationsShell>
    );
  return (
    <OperationsShell>
      <div className="mb-7">
        <Link
          href="/settings"
          className="inline-flex items-center text-xs text-[#71e5d3] hover:text-white"
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Back to organization settings
        </Link>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[.2em] text-[#2dd4bf]">
          Profile settings
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Your workspace profile
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Update the display identity used for internal operations activity and
          records.
        </p>
      </div>
      <section className="max-w-2xl rounded-xl border border-white/8 bg-[#0b1c2c] p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#2dd4bf]/10 text-[#71e5d3]">
            <UserRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">
              Authenticated profile
            </h2>
            <p className="text-xs text-slate-500">
              Changes are persisted to the current user record.
            </p>
          </div>
        </div>
        <label className="mt-6 block text-xs text-slate-400">
          Display name
          <Input
            value={name}
            onChange={event => setName(event.target.value)}
            className="mt-2 border-white/8 bg-white/[.025]"
            placeholder="Your name"
          />
        </label>
        <label className="mt-4 block text-xs text-slate-400">
          Email
          <Input
            value={email}
            onChange={event => setEmail(event.target.value)}
            className="mt-2 border-white/8 bg-white/[.025]"
            placeholder="you@example.org"
          />
        </label>
        <Button
          disabled={save.isPending || !name || !email}
          onClick={() => save.mutate({ name, email })}
          className="mt-5 bg-[#1e3a5f] hover:bg-[#29507f]"
        >
          <Save className="mr-2 h-4 w-4" />
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
      </section>
    </OperationsShell>
  );
}
