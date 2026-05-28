import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Shield } from "lucide-react";

import { useCreateOrg, useApiKey } from "@/hooks/use-nhid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plan } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const schema = z.object({
  orgName: z.string().min(2, "Organization name must be at least 2 characters."),
  plan: z.enum(["free", "l1", "l2", "l3"]),
  adminKey: z.string().min(5, "Admin key is required."),
});

type FormValues = z.infer<typeof schema>;

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const apiKey = useApiKey();
  const createOrg = useCreateOrg();
  const { toast } = useToast();

  useEffect(() => {
    if (apiKey) {
      setLocation("/dashboard");
    }
  }, [apiKey, setLocation]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      orgName: "",
      plan: "free",
      adminKey: "nhid-admin-key-dev", // Default from spec
    },
  });

  const onSubmit = (data: FormValues) => {
    createOrg.mutate(data, {
      onSuccess: () => {
        toast({ title: "Organization created", description: "API key securely stored." });
        setLocation("/dashboard");
      },
      onError: (err: any) => {
        toast({ title: "Failed to create organization", description: err.message || "Unknown error", variant: "destructive" });
      }
    });
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md border-border shadow-lg">
        <CardHeader className="space-y-2 text-center pb-6">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">NHID Clinical Setup</CardTitle>
          <CardDescription>Initialize your multi-tenant control plane</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="orgName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Health" {...field} data-testid="input-orgname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tier</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-plan">
                          <SelectValue placeholder="Select a plan" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="free">Free — 100 req/day (testing)</SelectItem>
                        <SelectItem value="l1">L1 — $99/mo · 10k req/day</SelectItem>
                        <SelectItem value="l2">L2 — $499/mo · 100k req/day</SelectItem>
                        <SelectItem value="l3">L3 — $2,500/mo · Unlimited</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="adminKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provisioning Key</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} data-testid="input-adminkey" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full font-semibold" disabled={createOrg.isPending} data-testid="button-submit">
                {createOrg.isPending ? "Provisioning..." : "Initialize Workspace"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
