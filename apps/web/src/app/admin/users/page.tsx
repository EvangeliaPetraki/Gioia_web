"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useRequireAuth } from "@/lib/use-require-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type User = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  createdAt: Date | string;
};

export default function UserManagementPage() {
  const router = useRouter();
  const authed = useRequireAuth();
  const { data: session, isPending } = authClient.useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const { data, error: listError } = await authClient.admin.listUsers({
      query: { sortBy: "createdAt", sortDirection: "desc", limit: 100 },
    });
    if (listError) throw new Error(listError.message ?? "Could not load users.");
    setUsers(data?.users ?? []);
  }, []);

  useEffect(() => {
    if (!isPending && session?.user.role !== "admin") router.replace("/dashboard");
  }, [isPending, router, session]);

  useEffect(() => {
    if (authed && session?.user.role === "admin") {
      void loadUsers().catch((err) => setError(err instanceof Error ? err.message : "Could not load users."));
    }
  }, [authed, loadUsers, session?.user.role]);

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const { error: createError } = await authClient.admin.createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role: "user",
      });
      if (createError) throw new Error(createError.message ?? "Could not create user.");
      setName("");
      setEmail("");
      setPassword("");
      setNotice("User created. Share the email address and password securely.");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user.");
    } finally {
      setLoading(false);
    }
  }

  if (!authed || isPending || session?.user.role !== "admin") return null;

  return (
    <main className="container mx-auto max-w-4xl py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User management</h1>
          <p className="mt-1 text-muted-foreground">Create the accounts that can access Gioia.</p>
        </div>
        <Button asChild variant="outline"><a href="/dashboard">Back to dashboard</a></Button>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Create user</CardTitle>
          <CardDescription>New accounts are standard users; only this admin can create them.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={createUser}>
            <Input required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input required type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input required minLength={8} type="password" placeholder="Temporary password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" disabled={loading || !name.trim() || !email.trim() || password.length < 8}>
              {loading ? "Creating..." : "Create user"}
            </Button>
          </form>
          {notice && <p className="mt-3 text-sm text-green-700">{notice}</p>}
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Users</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {users.map((user) => <TableRow key={user.id}><TableCell>{user.name}</TableCell><TableCell>{user.email}</TableCell><TableCell>{user.role ?? "user"}</TableCell><TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell></TableRow>)}
              {users.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No users found.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
