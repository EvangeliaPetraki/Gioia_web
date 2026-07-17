"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Already signed in → skip the gate.
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && session) router.replace("/dashboard");
  }, [isPending, router, session]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const id = identifier.trim();
      // A value containing "@" is treated as an email; otherwise as a username.
      const { error: signInError } = id.includes("@")
        ? await authClient.signIn.email({ email: id, password })
        : await authClient.signIn.username({ username: id, password });
      if (signInError) throw new Error(signInError.message ?? "Unable to sign in.");
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container mx-auto flex min-h-screen max-w-md flex-col justify-center py-12">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Gioia</h1>
      <p className="mb-8 text-muted-foreground">Policy-analysis workspace</p>

      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            This workspace is restricted. Use the account created for you by an administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Input
              type="text"
              autoFocus
              autoComplete="username"
              placeholder="Username or email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
            <PasswordInput
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" disabled={loading || !identifier.trim() || !password}>
              {loading ? "Checking…" : "Continue"}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Curious what this does?{" "}
        <a className="underline underline-offset-4 hover:text-foreground" href="/how-it-works">
          See how it works
        </a>
        .
      </p>
    </main>
  );
}
