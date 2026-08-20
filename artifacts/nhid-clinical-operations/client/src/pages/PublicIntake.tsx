import { useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function PublicIntake() {
  const [submitted, setSubmitted] = useState(false);
  const submit = trpc.partners.publicIntake.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Submission received — pipeline stage set to Applied.");
    },
    onError: () =>
      toast.error(
        "We could not submit the intake form. Please review the fields and try again."
      ),
  });

  if (submitted)
    return (
      <div className="grid min-h-screen place-items-center bg-[#07131f] px-5 text-slate-100">
        <div className="max-w-lg rounded-2xl border border-[#2dd4bf]/25 bg-[#0b1c2c] p-10 text-center shadow-2xl">
          <CheckCircle2 className="mx-auto h-12 w-12 text-[#2dd4bf]" />
          <h1 className="mt-5 text-2xl font-semibold">
            Your Shadow Pilot request is in.
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Our operations team will review your submission and follow up about
            the next readiness step.
          </p>
          <Button
            className="mt-7 bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
            onClick={() => setSubmitted(false)}
          >
            Submit another request
          </Button>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-[#07131f] px-5 py-10 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#2dd4bf] text-[#06242d]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold tracking-wide">SHADOW PILOT</p>
            <p className="text-xs text-[#7cebd9]">
              NHID-Clinical partner intake
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0b1c2c] p-6 shadow-2xl sm:p-9">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#2dd4bf]">
            Start a pilot
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Tell us about your healthcare AI workflow.
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            A Shadow Pilot is a 30-day operational assessment focused on
            measurable control readiness. Required fields are marked through
            validation.
          </p>
          <form
            className="mt-8 grid gap-5 sm:grid-cols-2"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              submit.mutate({
                name: String(form.get("name")),
                contactName: String(form.get("contactName")),
                email: String(form.get("email")),
                phone: String(form.get("phone")),
                platform: String(form.get("platform")) as
                  | "Twilio"
                  | "VAPI"
                  | "Amazon Connect"
                  | "Retell"
                  | "Other",
                estimatedCallVolume: Number(form.get("volume")),
                useCase: String(form.get("useCase")),
              });
            }}
          >
            <div>
              <Label htmlFor="name">Organization name</Label>
              <Input id="name" name="name" required className="mt-2" />
            </div>
            <div>
              <Label htmlFor="contactName">Contact name</Label>
              <Input
                id="contactName"
                name="contactName"
                required
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" className="mt-2" />
            </div>
            <div>
              <Label htmlFor="platform">EHR / platform</Label>
              <select
                id="platform"
                name="platform"
                className="mt-2 flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option>Twilio</option>
                <option>VAPI</option>
                <option>Amazon Connect</option>
                <option>Retell</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <Label htmlFor="volume">Estimated monthly call volume</Label>
              <Input
                id="volume"
                name="volume"
                type="number"
                min="0"
                required
                className="mt-2"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="useCase">Primary use case</Label>
              <Textarea
                id="useCase"
                name="useCase"
                required
                className="mt-2 min-h-28"
                placeholder="For example: appointment routing, referral management, care navigation…"
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                disabled={submit.isPending}
                className="w-full bg-[#2dd4bf] text-[#06242d] hover:bg-[#66e6d2]"
              >
                {submit.isPending
                  ? "Submitting…"
                  : "Submit Shadow Pilot request"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
