"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CaseStudyCatalogDto } from "@gioia/dto";
import { api } from "@/lib/api";
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

const EMPTY: CaseStudyCatalogDto = { regions: [], caseStudyTypes: [] };

interface UserOption {
  id: string;
  name: string;
  email: string;
}

export default function CaseStudyManagementPage() {
  const router = useRouter();
  const authed = useRequireAuth();
  const { data: session, isPending } = authClient.useSession();

  const [catalog, setCatalog] = useState<CaseStudyCatalogDto>(EMPTY);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create-form state.
  const [country, setCountry] = useState("");
  const [regionName, setRegionName] = useState("");
  const [regionOwners, setRegionOwners] = useState<string[]>([]);
  const [typeName, setTypeName] = useState("");
  const [attachRegion, setAttachRegion] = useState("");
  const [attachType, setAttachType] = useState("");
  const [busy, setBusy] = useState(false);

  // Per-region owner editing.
  const [editingRegion, setEditingRegion] = useState<string | null>(null);
  const [editOwners, setEditOwners] = useState<string[]>([]);

  // Per-region rename editing.
  const [renamingRegion, setRenamingRegion] = useState<string | null>(null);
  const [renameCountry, setRenameCountry] = useState("");
  const [renameName, setRenameName] = useState("");

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const load = useCallback(async () => {
    const [catalogData, userList] = await Promise.all([
      api.getCatalog(),
      authClient.admin.listUsers({
        query: { sortBy: "createdAt", sortDirection: "desc", limit: 200 },
      }),
    ]);
    setCatalog(catalogData);
    if (userList.error) throw new Error(userList.error.message ?? "Could not load users.");
    setUsers(
      (userList.data?.users ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email })),
    );
  }, []);

  useEffect(() => {
    if (!isPending && session?.user.role !== "admin") router.replace("/dashboard");
  }, [isPending, router, session]);

  useEffect(() => {
    if (authed && session?.user.role === "admin") {
      void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load catalog."));
    }
  }, [authed, load, session?.user.role]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const createRegion = () =>
    run(async () => {
      await api.createRegion(country.trim(), regionName.trim(), regionOwners);
      setCountry("");
      setRegionName("");
      setRegionOwners([]);
    });

  const saveOwners = (regionId: string) =>
    run(async () => {
      await api.setRegionOwners(regionId, editOwners);
      setEditingRegion(null);
    });

  const saveRename = (regionId: string) =>
    run(async () => {
      await api.updateRegion(regionId, renameCountry.trim(), renameName.trim());
      setRenamingRegion(null);
    });

  const createType = () =>
    run(async () => {
      await api.createCaseStudyType(typeName.trim());
      setTypeName("");
    });

  const attach = () =>
    run(async () => {
      await api.createRegionCaseStudy(attachRegion, attachType);
      setAttachType("");
    });

  if (!authed || isPending || session?.user.role !== "admin") return null;

  return (
    <main className="container mx-auto max-w-4xl py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Regions &amp; case studies</h1>
          <p className="mt-1 text-muted-foreground">
            Create the regions and the case studies analysts upload files into. A file analysed
            under a case study is reused for the same case study elsewhere.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/dashboard">Back to dashboard</a>
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add region</CardTitle>
            <CardDescription>
              A region belongs to a country (e.g. Greece · Crete) and is assigned to one or more
              users who may see its case studies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <Input placeholder="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
              <Input placeholder="Region name" value={regionName} onChange={(e) => setRegionName(e.target.value)} />
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Owners (select one or more)</p>
                <UserCheckboxList
                  users={users}
                  selected={regionOwners}
                  onToggle={(id) => setRegionOwners((prev) => toggle(prev, id))}
                />
              </div>
              <Button
                onClick={() => void createRegion()}
                disabled={busy || !country.trim() || !regionName.trim() || regionOwners.length === 0}
              >
                Add region
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add case-study type</CardTitle>
            <CardDescription>A shared theme (tourism, food, transportation…).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <Input placeholder="Case-study name" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
              <Button onClick={() => void createType()} disabled={busy || !typeName.trim()}>
                Add case-study type
              </Button>
            </div>
            {catalog.caseStudyTypes.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {catalog.caseStudyTypes.map((t) => t.name).join(" · ")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Attach a case study to a region</CardTitle>
          <CardDescription>Creates the unit analysts upload files into (e.g. Crete · transportation).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={attachRegion}
              onChange={(e) => setAttachRegion(e.target.value)}
            >
              <option value="">Select region…</option>
              {catalog.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.country} · {r.name}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={attachType}
              onChange={(e) => setAttachType(e.target.value)}
            >
              <option value="">Select case-study type…</option>
              {catalog.caseStudyTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button onClick={() => void attach()} disabled={busy || !attachRegion || !attachType}>
              Attach case study
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Regions</CardTitle>
          <CardDescription>Each region and the case studies it runs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {catalog.regions.length === 0 && (
            <p className="text-sm text-muted-foreground">No regions yet.</p>
          )}
          {catalog.regions.map((r) => (
            <div key={r.id} className="rounded-md border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="font-medium">{r.name}</span>{" "}
                  <span className="text-sm text-muted-foreground">· {r.country}</span>
                  <div className="text-xs text-muted-foreground">
                    {r.owners.length > 0
                      ? `Owners: ${r.owners.map((o) => o.name).join(", ")}`
                      : "No owners (admin-only)"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const opening = renamingRegion !== r.id;
                      setRenamingRegion(opening ? r.id : null);
                      setRenameCountry(r.country);
                      setRenameName(r.name);
                    }}
                  >
                    {renamingRegion === r.id ? "Cancel" : "Rename"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingRegion(editingRegion === r.id ? null : r.id);
                      setEditOwners(r.owners.map((o) => o.id));
                    }}
                  >
                    {editingRegion === r.id ? "Cancel" : "Edit owners"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        if (confirm(`Delete region "${r.name}" and its case-study links? Analyses are kept.`)) {
                          await api.deleteRegion(r.id);
                        }
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {renamingRegion === r.id && (
                <div className="mt-3 rounded-md border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Rename region</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="Country"
                      value={renameCountry}
                      onChange={(e) => setRenameCountry(e.target.value)}
                    />
                    <Input
                      placeholder="Region name"
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void saveRename(r.id)}
                      disabled={busy || !renameCountry.trim() || !renameName.trim()}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenamingRegion(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {editingRegion === r.id && (
                <div className="mt-3 rounded-md border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Owners — tick everyone who may access this region
                  </p>
                  <UserCheckboxList
                    users={users}
                    selected={editOwners}
                    onToggle={(id) => setEditOwners((prev) => toggle(prev, id))}
                  />
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => void saveOwners(r.id)} disabled={busy}>
                      Save owners
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingRegion(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {r.caseStudies.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No case studies attached.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {r.caseStudies.map((cs) => (
                    <li key={cs.id} className="flex items-center justify-between text-sm">
                      <span>
                        {cs.caseStudyName}{" "}
                        <span className="text-muted-foreground">· {cs.documentCount} file{cs.documentCount === 1 ? "" : "s"}</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void run(async () => {
                            if (confirm(`Remove the "${cs.caseStudyName}" case study from ${r.name}?`)) {
                              await api.deleteRegionCaseStudy(cs.id);
                            }
                          })
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}

function UserCheckboxList({
  users,
  selected,
  onToggle,
}: {
  users: UserOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (users.length === 0) {
    return <p className="text-xs text-muted-foreground">No users available.</p>;
  }
  return (
    <div className="max-h-40 overflow-y-auto rounded-md border">
      {users.map((u) => (
        <label
          key={u.id}
          className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-accent/50"
        >
          <input
            type="checkbox"
            checked={selected.includes(u.id)}
            onChange={() => onToggle(u.id)}
          />
          <span>
            {u.name} <span className="text-muted-foreground">({u.email})</span>
          </span>
        </label>
      ))}
    </div>
  );
}
