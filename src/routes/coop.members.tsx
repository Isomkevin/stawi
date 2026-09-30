import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, MessageSquare, Upload, UserPlus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyLink } from "@/components/stawi/CopyLink";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/features/shared/DashboardShell";
import { api, ApiError, type RosterColumnMap, type RosterImportRow, type RosterPreview } from "@/lib/api";
import { ConfirmDelete } from "@/components/stawi/ConfirmDelete";
import { downloadCsv, MEMBER_TEMPLATE, normalizeKePhone, rowsToRosterCsv } from "@/lib/csv";
import { accountName, mockDb } from "@/lib/mock";
import { coopMembersOptions, coopOptions } from "@/lib/queries";
import { useCoopId } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/coop/members")({
  head: () => ({
    meta: [
      { title: "Members — Stawi co-op" },
      { name: "description", content: "Your farmer roster, contribution shares and invites." },
      { property: "og:title", content: "Members — Stawi co-op" },
      { property: "og:description", content: "Your farmer roster, contribution shares and invites." },
    ],
  }),
  component: Members,
});

function Members() {
  const coopId = useCoopId();
  const qc = useQueryClient();
  const members = useQuery(coopMembersOptions(coopId));
  const coop = useQuery(coopOptions(coopId));
  const [shares, setShares] = useState<Record<string, number>>({});
  const [invite, setInvite] = useState(false);
  const [drag, setDrag] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [sourceB64, setSourceB64] = useState<string | null>(null);
  const [inv, setInv] = useState({ phone: "+2547", share: 5 });

  useEffect(() => {
    if (members.data) setShares(Object.fromEntries(members.data.map((m) => [m.account_id, m.contribution_share])));
  }, [members.data]);

  const total = Object.values(shares).reduce((s, v) => s + (Number(v) || 0), 0);
  const dirty = members.data?.some((m) => shares[m.account_id] !== m.contribution_share);
  const invalidShare = Object.values(shares).some((v) => !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100);
  const coopName = coop.data?.name ?? "your co-op";

  const save = useMutation({
    mutationFn: () => Promise.all(Object.entries(shares).map(([id, s]) => api.updateMemberShare(coopId, id, s))),
    onSuccess: () => {
      toast.success("Shares saved");
      void qc.invalidateQueries({ queryKey: ["coop", coopId] });
    },
  });

  const accounts = mockDb.accounts;
  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/onboarding?coop=${encodeURIComponent(coopName)}&share=${inv.share}&phone=${encodeURIComponent(inv.phone)}`
      : "";

  async function loadFile(file: File) {
    setImportOpen(true);
    setReading(true);
    setPreview(null);
    try {
      const csv_base64 = await fileToBase64(file);
      setSourceB64(csv_base64);
      setPreview(await api.previewMemberImport(coopId, { csv_base64 }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't read that CSV");
      setImportOpen(false);
    } finally {
      setReading(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void loadFile(file);
      }}
      className={cn(drag && "rounded-2xl ring-2 ring-lime")}
    >
      <PageHeader
        title="Members"
        description="Standing shares describe the roster. They can total more than 100%. A shipment is where selected farmers must fill 100% of that lot."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" onClick={() => downloadCsv("stawi-members-template.csv", MEMBER_TEMPLATE)}>
              <Download className="size-4" /> Template
            </Button>
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm hover:border-sage">
              <Upload className="size-4" /> Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <Button className="h-11" onClick={() => setInvite(true)}><UserPlus className="size-4" /> Invite farmer</Button>
          </div>
        }
      />

      <div className="mb-4 rounded-2xl border border-border bg-card p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span>Standing shares</span>
          <span className="tabular font-medium">{formatShare(total)}%</span>
        </div>
        <p className="text-xs text-muted-foreground">Each farmer is between 0 and 100. The roster total is not a shipment, so it can pass 100%.</p>
        {invalidShare && <p className="mt-2 text-xs text-terracotta">Each share must be between 0 and 100.</p>}
        <div className="mt-4 flex gap-2">
          <Button disabled={!dirty || invalidShare || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save shares
          </Button>
          {dirty && <Button variant="ghost" onClick={() => members.data && setShares(Object.fromEntries(members.data.map((m) => [m.account_id, m.contribution_share])))}>Reset</Button>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        {members.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-normal">Farmer</th>
                <th className="hidden px-4 py-3 font-normal sm:table-cell">Phone</th>
                <th className="hidden px-4 py-3 text-right font-normal md:table-cell">Kilos</th>
                <th className="px-4 py-3 font-normal">M-Pesa</th>
                <th className="px-4 py-3 text-right font-normal">Share %</th>
                <th className="w-12 px-2 py-3"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {members.data?.map((m) => {
                const acc = accounts.find((a) => a.id === m.account_id);
                const verified = acc?.payout_destinations.some((d) => d.is_verified);
                const name = m.full_name ?? accountName(m.account_id);
                return (
                  <tr key={m.account_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{name}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground tabular sm:table-cell">{acc?.phone_number}</td>
                    <td className="hidden px-4 py-3 text-right tabular md:table-cell">{m.kilos ?? "—"}</td>
                    <td className="px-4 py-3"><StatusChip status={verified ? "verified" : "missing"} label={verified ? "Verified" : "Not verified"} /></td>
                    <td className="px-4 py-3 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        aria-label={`Share for ${name}`}
                        value={shares[m.account_id] ?? 0}
                        onChange={(e) => setShares((s) => ({ ...s, [m.account_id]: Number(e.target.value) }))}
                        className="ml-auto h-10 w-20 text-right tabular"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <ConfirmDelete
                        label={`Remove ${name}`}
                        title={`Remove ${name} from the co-op?`}
                        description="They'll stop being added to new shipments. Money they've already earned stays in their account."
                        onConfirm={async () => {
                          try {
                            await api.removeCoopMember(coopId, m.account_id);
                            toast.success(`${name} removed`);
                            await qc.invalidateQueries({ queryKey: ["coop", coopId] });
                          } catch (e) {
                            toast.error(e instanceof ApiError && e.status === 404 ? "The server can't remove farmers yet." : "Couldn't remove this farmer.");
                          }
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={invite} onOpenChange={setInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a farmer</DialogTitle>
            <DialogDescription>They'll get a link that sets up their account with your co-op and share filled in.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <div className="space-y-1.5"><Label>Phone</Label><Input value={inv.phone} onChange={(e) => setInv({ ...inv, phone: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Share %</Label><Input type="number" value={inv.share} onChange={(e) => setInv({ ...inv, share: Number(e.target.value) })} /></div>
          </div>
          <CopyLink url={inviteUrl} subject="Join our co-op on Stawi" />
        </DialogContent>
      </Dialog>

      <ImportDialog
        open={importOpen}
        reading={reading}
        preview={preview}
        sourceB64={sourceB64}
        coopId={coopId}
        coopName={coopName}
        onPreview={setPreview}
        onClose={() => {
          setImportOpen(false);
          setPreview(null);
          setSourceB64(null);
        }}
      />
    </div>
  );
}

function formatShare(n: number) {
  return (Math.round(n * 1000) / 1000).toLocaleString("en-KE", { maximumFractionDigits: 3 });
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

type Invite = { name: string; phone: string; share: number; url: string };
type DraftRow = {
  line: number;
  name: string;
  phone: string;
  share: string;
  kilos: string;
  error?: string;
  status?: RosterImportRow["status"];
};

const STATUS_LABEL: Record<NonNullable<RosterImportRow["status"]>, string> = {
  add: "On Stawi · add",
  update: "Update",
  invite: "Invite",
  other_coop: "In another co-op",
};

function ImportDialog({
  open,
  reading,
  preview,
  sourceB64,
  coopId,
  coopName,
  onPreview,
  onClose,
}: {
  open: boolean;
  reading: boolean;
  preview: RosterPreview | null;
  sourceB64: string | null;
  coopId: string;
  coopName: string;
  onPreview: (preview: RosterPreview) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.applyMemberImport>> | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [map, setMap] = useState({ name: "", phone: "", share: "", kilos: "" });
  const dirty = useRef(false);
  const draftRef = useRef<DraftRow[]>([]);

  useEffect(() => {
    if (!preview || preview.needs_mapping) return;
    const next: DraftRow[] = preview.rows.map((row) => {
      const item: DraftRow = {
        line: row.line,
        name: row.name,
        phone: row.phone,
        share: String(row.share),
        kilos: row.kilos === undefined ? "" : String(row.kilos),
      };
      if (row.error) item.error = row.error;
      if (row.status) item.status = row.status;
      return item;
    });
    draftRef.current = next;
    setDraft(next);
    setResult(null);
  }, [preview]);

  const ready = draft.filter((row) => !row.error && row.status !== "other_coop");

  async function refresh(rows: DraftRow[]) {
    setChecking(true);
    try {
      const csv = rowsToRosterCsv(rows.map((row) => ({
        name: row.name,
        phone: row.phone,
        share: row.share.trim() === "" ? 0 : Number(row.share),
        kilos: row.kilos.trim() === "" ? undefined : Number(row.kilos),
      })));
      onPreview(await api.previewMemberImport(coopId, { csv }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't check those rows");
    } finally {
      setChecking(false);
    }
  }

  function edit(index: number, field: "name" | "phone" | "share" | "kilos", value: string) {
    dirty.current = true;
    setDraft((rows) => {
      const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
      draftRef.current = next;
      return next;
    });
  }

  function blurRow() {
    if (!dirty.current) return;
    dirty.current = false;
    void refresh(draftRef.current);
  }

  const apply = useMutation({
    mutationFn: () => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      return api.applyMemberImport(
        coopId,
        {
          origin,
          rows: draft.map((row) => {
            const item: RosterImportRow = {
              line: row.line,
              name: row.name,
              phone: row.phone,
              share: row.share.trim() === "" ? 0 : Number(row.share),
            };
            if (row.kilos.trim() !== "") item.kilos = Number(row.kilos);
            return item;
          }),
        },
        crypto.randomUUID(),
      );
    },
    onSuccess: (out) => {
      setResult(out);
      void qc.invalidateQueries({ queryKey: ["coop", coopId] });
      toast.success(`Imported ${out.added.length + out.updated.length} farmers, ${out.invites.length} invites ready`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't import"),
  });

  async function applyMap(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceB64 || map.name === "" || map.phone === "") return;
    const columns: RosterColumnMap = { name: Number(map.name), phone: Number(map.phone) };
    if (map.share !== "") columns.share = Number(map.share);
    if (map.kilos !== "") columns.kilos = Number(map.kilos);
    setChecking(true);
    try {
      onPreview(await api.previewMemberImport(coopId, { csv_base64: sourceB64, columns }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't map those columns");
    } finally {
      setChecking(false);
    }
  }

  const close = () => {
    setResult(null);
    setSmsOpen(false);
    onClose();
  };

  return (
    <>
      <Dialog open={open && !smsOpen} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{result ? "Import finished" : "Import farmers"}</DialogTitle>
            <DialogDescription>
              {result
                ? `${coopName} farmers already on Stawi were saved. New farmers need their invite link to set up M-Pesa and a PIN.`
                : "Drop a CSV or pick a file. Name, phone, share, and optional kilos. Standing shares do not have to total 100%."}
            </DialogDescription>
          </DialogHeader>

          {(reading || checking) && !preview && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Reading the file…</p>
          )}

          {preview?.needs_mapping && !result && (
            <form className="space-y-3" onSubmit={(e) => void applyMap(e)}>
              <p className="text-sm text-muted-foreground">These column names are not ones Stawi knows. Choose which column is which.</p>
              <div className="grid grid-cols-2 gap-3">
                {(["name", "phone", "share", "kilos"] as const).map((field) => (
                  <label key={field} className="space-y-1 text-sm">
                    <span className="capitalize">{field}{field === "name" || field === "phone" ? "" : " (optional)"}</span>
                    <select
                      className="h-10 w-full rounded-md border border-border bg-background px-2"
                      value={map[field]}
                      required={field === "name" || field === "phone"}
                      onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}
                    >
                      <option value="">{field === "name" || field === "phone" ? "Choose a column" : "Skip"}</option>
                      {preview.headers.map((header, index) => (
                        <option key={index} value={index}>{header || `Column ${index + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <Button type="submit" disabled={checking || map.name === "" || map.phone === ""}>Use these columns</Button>
            </form>
          )}

          {preview && !preview.needs_mapping && !result && (
            <>
              {checking && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Checking rows…</p>}
              <div className="max-h-80 overflow-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-2 py-2 font-normal">Name</th>
                      <th className="px-2 py-2 font-normal">Phone</th>
                      <th className="px-2 py-2 font-normal">Share</th>
                      <th className="px-2 py-2 font-normal">Kilos</th>
                      <th className="px-2 py-2 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.map((row, index) => (
                      <tr key={row.line} className="border-b border-border last:border-0">
                        <td className="p-1"><Input aria-label={`Name on row ${row.line}`} value={row.name} onChange={(e) => edit(index, "name", e.target.value)} onBlur={blurRow} /></td>
                        <td className="p-1"><Input aria-label={`Phone on row ${row.line}`} value={row.phone} onChange={(e) => edit(index, "phone", e.target.value)} onBlur={blurRow} /></td>
                        <td className="p-1"><Input aria-label={`Share on row ${row.line}`} value={row.share} onChange={(e) => edit(index, "share", e.target.value)} onBlur={blurRow} className="w-20" /></td>
                        <td className="p-1"><Input aria-label={`Kilos on row ${row.line}`} value={row.kilos} onChange={(e) => edit(index, "kilos", e.target.value)} onBlur={blurRow} className="w-20" /></td>
                        <td className="px-2 py-1 text-xs">
                          {row.error ? <span className="text-terracotta">{row.error}</span> : row.status ? <StatusChip status={row.status === "invite" ? "pending" : row.status === "other_coop" ? "missing" : "verified"} label={STATUS_LABEL[row.status]} /> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Standing shares in this file: <span className="tabular">{formatShare(preview.total_share)}%</span>. That total can pass 100%.
              </p>
              <Button disabled={ready.length === 0 || apply.isPending || checking} onClick={() => apply.mutate()}>
                {apply.isPending && <Loader2 className="size-4 animate-spin" />} Import {ready.length} farmers
              </Button>
            </>
          )}

          {result && (
            <>
              <ul className="space-y-1 text-sm">
                <li>Added to co-op: <strong className="tabular">{result.added.length}</strong></li>
                <li>Shares updated: <strong className="tabular">{result.updated.length}</strong></li>
                <li>Invites to send: <strong className="tabular">{result.invites.length}</strong></li>
                {result.failed.length > 0 && <li className="text-terracotta">Skipped: {result.failed.map((f) => `${f.name} (${f.reason})`).join(", ")}</li>}
              </ul>
              {result.invites.length > 0 && (
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {result.invites.map((invite) => (
                    <div key={invite.phone}>
                      <p className="mb-1 text-xs text-muted-foreground">{invite.name} · {invite.phone}</p>
                      <CopyLink url={invite.url} subject="Join our co-op on Stawi" />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {result.invites.length > 0 && (
                  <>
                    <Button onClick={() => setSmsOpen(true)}><MessageSquare className="size-4" /> Text invites</Button>
                    <Button variant="outline" onClick={() => downloadCsv("stawi-invites.csv", [["name", "phone", "share", "invite_link"], ...result.invites.map((i) => [i.name, i.phone, i.share, i.url])])}>
                      <Download className="size-4" /> Download list
                    </Button>
                  </>
                )}
                <Button variant={result.invites.length ? "ghost" : "default"} onClick={close}>Done</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {result && <SendInvitesDialog open={smsOpen} onOpenChange={setSmsOpen} coopId={coopId} invites={result.invites} />}
    </>
  );
}

function SendInvitesDialog({
  open,
  onOpenChange,
  coopId,
  invites,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  coopId: string;
  invites: Invite[];
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(invites.map((i) => i.phone)));
  const [status, setStatus] = useState<Record<string, { sent: boolean; error?: string | undefined }>>({});
  const [progress, setProgress] = useState<string | null>(null);
  useEffect(() => { setPicked(new Set(invites.map((i) => i.phone))); setStatus({}); setProgress(null); }, [invites]);
  const all = picked.size === invites.length;
  const toggle = (phone: string) =>
    setPicked((prev) => { const n = new Set(prev); if (n.has(phone)) n.delete(phone); else n.add(phone); return n; });

  const send = useMutation({
    mutationFn: () =>
      api.sendInviteSms(
        coopId,
        invites.filter((i) => picked.has(i.phone)).map((i) => ({ phone_number: i.phone, full_name: i.name, link: i.url })),
        (p) => setProgress(`Texted ${p.done} of ${p.total}`),
      ),
    onSuccess: (r) => {
      const next: Record<string, { sent: boolean; error?: string | undefined }> = {};
      for (const x of r.results) next[normalizeKePhone(x.phone_number) || x.phone_number] = { sent: x.sent, error: x.error };
      setStatus(next);
      setProgress(null);
      if (r.failed === 0) toast.success(`Texted ${r.sent} farmers`);
      else toast.error(`Texted ${r.sent}, ${r.failed} failed`);
      setPicked(new Set(invites.filter((i) => next[i.phone] && !next[i.phone]!.sent).map((i) => i.phone)));
    },
    onError: (e) => {
      setProgress(null);
      toast.error(e instanceof ApiError ? e.message : "Couldn't send texts");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Text invite links</DialogTitle>
          <DialogDescription>Each farmer gets an SMS with their own link. A long list is sent in batches, so it is not stopped at 500.</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 border-b border-border pb-2 text-sm font-medium">
          <Checkbox checked={all ? true : picked.size ? "indeterminate" : false} onCheckedChange={() => setPicked(all ? new Set() : new Set(invites.map((i) => i.phone)))} />
          Select all ({picked.size}/{invites.length})
        </label>
        <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
          {invites.map((i) => {
            const st = status[i.phone];
            return (
              <li key={i.phone}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted">
                  <Checkbox checked={picked.has(i.phone)} onCheckedChange={() => toggle(i.phone)} />
                  <span className="min-w-0 flex-1 truncate">{i.name}</span>
                  <span className="tabular text-xs text-muted-foreground">{i.phone}</span>
                  {st && <StatusChip status={st.sent ? "verified" : "failed"} label={st.sent ? "Sent" : "Failed"} />}
                </label>
                {st?.error && <p className="pl-8 text-xs text-terracotta">{st.error}</p>}
              </li>
            );
          })}
        </ul>
        {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
        <div className="flex gap-2">
          <Button disabled={picked.size === 0 || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />} {progress ?? `Send ${picked.size} texts`}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


