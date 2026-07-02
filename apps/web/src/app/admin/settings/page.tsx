"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisSettingsResponseDto } from "@gioia/dto";
import { authClient } from "@/lib/auth-client";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Settings = AnalysisSettingsResponseDto["settings"];
type Options = AnalysisSettingsResponseDto["options"];

export default function AnalysisSettingsPage() {
  const router = useRouter();
  const authed = useRequireAuth();
  const { data: session, isPending } = authClient.useSession();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isAdmin = session?.user.role === "admin";

  const load = useCallback(async () => {
    const res = await api.getSettings();
    setSettings(res.settings);
    setOptions(res.options);
  }, []);

  useEffect(() => {
    if (!isPending && !isAdmin) router.replace("/dashboard");
  }, [isPending, isAdmin, router]);

  useEffect(() => {
    if (authed && isAdmin) {
      void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load settings."));
    }
  }, [authed, isAdmin, load]);

  const patch = (p: Partial<Settings>) => {
    setNotice(null);
    setSettings((s) => (s ? { ...s, ...p } : s));
  };

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateSettings({ mode: "staged", profile: settings.profile, effort: settings.effort });
      setNotice("Saved. New uploads will use this configuration.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!authed || isPending || !isAdmin) return null;
  if (!settings || !options) {
    return <main className="container mx-auto max-w-2xl py-12 text-muted-foreground">Loading…</main>;
  }

  return (
    <main className="container mx-auto max-w-2xl py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analysis model</h1>
          <p className="mt-1 text-muted-foreground">
            Choose which model(s) run the Gioia pipeline. Applies to new uploads.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/dashboard">Back to dashboard</a>
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Which model runs each tier of the 5-stage pipeline (extract · concepts · reasoning).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {options.profiles.map((p) => (
            <label key={p.value} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <input
                type="radio"
                name="profile"
                className="mt-1"
                checked={settings.profile === p.value}
                onChange={() => patch({ profile: p.value })}
              />
              <span>
                <span className="font-medium">{p.label}</span>
                <span className="block text-sm text-muted-foreground">{p.description}</span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Reasoning effort</CardTitle>
          <CardDescription>
            How hard Claude models think on the reasoning stages. Lower is cheaper and faster;
            no effect on open (Chutes) models.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {options.efforts.map((e) => (
              <Button
                key={e}
                type="button"
                variant={settings.effort === e ? "default" : "outline"}
                size="sm"
                onClick={() => patch({ effort: e })}
              >
                {e}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {notice && <span className="text-sm text-green-700">{notice}</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </main>
  );
}
