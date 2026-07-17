"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useRequireAuth } from "@/lib/use-require-auth";
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
  username?: string | null;
  displayUsername?: string | null;
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
  const [usernameField, setUsernameField] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-user management panel.
  const [managingUser, setManagingUser] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");

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
      const uname = usernameField.trim();
      const { error: createError } = await authClient.admin.createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role: "user",
        // The username plugin stores `username` lowercased (unique) and keeps the
        // original casing in `displayUsername`.
        data: { username: uname, displayUsername: uname },
      });
      if (createError) throw new Error(createError.message ?? "Could not create user.");
      setName("");
      setEmail("");
      setUsernameField("");
      setPassword("");
      setNotice("User created. Share the username (or email) and password securely.");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user.");
    } finally {
      setLoading(false);
    }
  }

  function openManage(user: User) {
    setError(null);
    setNotice(null);
    if (managingUser === user.id) {
      setManagingUser(null);
      return;
    }
    setManagingUser(user.id);
    setEditName(user.name);
    setEditUsername(user.displayUsername ?? user.username ?? "");
    setNewPassword("");
  }

  async function runAction(fn: () => Promise<void>, successMsg: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(successMsg);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setLoading(false);
    }
  }

  const saveProfile = (userId: string) =>
    runAction(async () => {
      const data: Record<string, unknown> = { name: editName.trim() };
      const uname = editUsername.trim();
      if (uname) {
        data.username = uname;
        data.displayUsername = uname;
      }
      const { error: e } = await authClient.admin.updateUser({ userId, data });
      if (e) throw new Error(e.message ?? "Could not update user.");
    }, "Profile updated.");

  const changePassword = (userId: string) =>
    runAction(async () => {
      const { error: e } = await authClient.admin.setUserPassword({ userId, newPassword });
      if (e) throw new Error(e.message ?? "Could not set password.");
      setNewPassword("");
    }, "Password updated.");

  const deleteUser = (userId: string) =>
    runAction(async () => {
      const { error: e } = await authClient.admin.removeUser({ userId });
      if (e) throw new Error(e.message ?? "Could not delete user.");
      setManagingUser(null);
    }, "User deleted.");

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
            <Input
              required
              minLength={3}
              placeholder="Username (for login, 3+ characters)"
              value={usernameField}
              onChange={(e) => setUsernameField(e.target.value)}
            />
            <PasswordInput required minLength={8} placeholder="Temporary password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button
              type="submit"
              disabled={loading || !name.trim() || !email.trim() || usernameField.trim().length < 3 || password.length < 8}
            >
              {loading ? "Creating..." : "Create user"}
            </Button>
          </form>
          {notice && <p className="mt-3 text-sm text-green-700">{notice}</p>}
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Manage an account to rename it, change its username or password, or delete it.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <Fragment key={user.id}>
                  <TableRow>
                    <TableCell>{user.name}</TableCell>
                    <TableCell>{user.displayUsername ?? user.username ?? "—"}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.role ?? "user"}</TableCell>
                    <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openManage(user)}>
                        {managingUser === user.id ? "Close" : "Manage"}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {managingUser === user.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <div className="grid gap-6 py-2 sm:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Profile</p>
                            <Input
                              placeholder="Name"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                            />
                            <Input
                              placeholder="Username (3+ characters)"
                              value={editUsername}
                              onChange={(e) => setEditUsername(e.target.value)}
                            />
                            <Button
                              size="sm"
                              onClick={() => void saveProfile(user.id)}
                              disabled={
                                loading ||
                                !editName.trim() ||
                                (editUsername.trim().length > 0 && editUsername.trim().length < 3)
                              }
                            >
                              Save profile
                            </Button>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Security</p>
                            <PasswordInput
                              minLength={8}
                              placeholder="New password (8+ characters)"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                onClick={() => void changePassword(user.id)}
                                disabled={loading || newPassword.length < 8}
                              >
                                Set password
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={loading || user.id === session?.user.id}
                                onClick={() => {
                                  if (confirm(`Delete user "${user.name}"? This cannot be undone.`)) {
                                    void deleteUser(user.id);
                                  }
                                }}
                              >
                                Delete user
                              </Button>
                            </div>
                            {user.id === session?.user.id && (
                              <p className="text-xs text-muted-foreground">You cannot delete your own account.</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">No users found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
