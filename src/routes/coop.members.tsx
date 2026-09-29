import { useEffect, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/features/shared/DashboardShell";
import { api, ApiError } from "@/lib/api";
import { ConfirmDelete } from "@/components/stawi/ConfirmDelete";
import { downloadCsv, normalizeKePhone, parseMembersCsv, type MemberCsvRow } from "@/lib/csv";
import { accountName, mockDb } from "@/lib/mock";
import type { CoopMember } from "@/lib/types";
import { coopMembersOptions } from "@/lib/queries";
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
  const [shares, setShares] = useState<Record<string, number>>({});
  const [invite, setInvite] = useState(false);
  const [csvRows, setCsvRows] = useState<ReturnType<typeof parseMembersCsv>>([]);
  const [inv, setInv] = useState({ phone: "+2547", share: 5 });

  useEffect(() => {
    if (members.data) setShares(Object.fromEntries(members.data.map((m) => [m.account_id, m.contribution_share])));
  }, [members.data]);

  const total = Object.values(shares).reduce((s, v) => s + (Number(v) || 0), 0);
  const dirty = members.data?.some((m) => shares[m.account_id] !== m.contribution_share);

  const save = useMutation({
    mutationFn: () => Promise.all(Object.entries(shares).map(([id, s]) => api.updateMemberShare(coopId, id, s))),
    onSuccess: () => {
      toast.success("Shares saved");
      void qc.invalidateQueries({ queryKey: ["coop", coopId] });
    },
  });

  const accounts = mockDb.accounts;
  // TODO(backend): add to contract — co-op invite links
  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/onboarding?coop=${encodeURIComponent("Kiambu Highlands Coffee Co-op")}&share=${inv.share}&phone=${encodeURIComponent(inv.phone)}`
      : "";

  return (
    <div>
      <PageHeader
        title="Members"
        description="Shares decide how every payment is split. They must add up to 100%."
        action={
          <div className="flex gap-2">
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm hover:border-sage">
              <Upload className="size-4" /> Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setCsvRows(parseMembersCsv(await f.text()));
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
          <span>Total shares</span>
          <span className={cn("tabular font-medium", total === 100 ? "text-lime" : "text-terracotta")}>{total}%</span>
        </div>
        <Progress value={Math.min(total, 100)} />
        {total !== 100 && <p className="mt-2 text-xs text-terracotta">{total < 100 ? `${100 - total}% still to assign` : `${total - 100}% over`}</p>}
        <div className="mt-4 flex gap-2">
          <Button disabled={!dirty || total !== 100 || save.isPending} onClick={() => save.mutate()}>
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
                        description="They'll stop getting a share of new payments. Money they've already earned stays in their account. Re-balance shares to 100% afterwards."
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
        rows={csvRows}
        onClose={() => setCsvRows([])}
        coopId={coopId}
        members={members.data ?? []}
        currentShares={shares}
      />
    </div>
  );
}

const COOP_NAME = "Kiambu Highlands Coffee Co-op";

type Invite = { name: string; phone: string; share: number; url: string };
type ImportResult = { added: string[]; updated: string[]; invites: Invite[]; failed: Array<{ name: string; reason: string }> };

function ImportDialog({
  rows,
  onClose,
  coopId,
  currentShares,
}: {
  rows: MemberCsvRow[];
  onClose: () => void;
  coopId: string;
  members: CoopMember[];
  currentShares: Record<string, number>;
}) {
  const qc = useQueryClient();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const valid = rows.filter((r) => !r.error);
  const invalid = rows.filter((r) => r.error);

  // Ask the server which phones already have a Stawi account.
  const lookup = useQuery({
    queryKey: ["coop", coopId, "lookup", valid.map((r) => r.phone).join(",")],
    queryFn: () => api.lookupPhones(coopId, valid.map((r) => r.phone)),
    enabled: valid.length > 0,
    staleTime: 30_000,
  });
  const found = lookup.data ?? [];
  const plan = valid.map((r, i) => {
    const hit = found[i];
    const acc = hit?.account_id ? { id: hit.account_id, full_name: hit.full_name ?? r.name } : undefined;
    const kind = hit?.already_member ? ("update" as const) : acc ? ("add" as const) : ("invite" as const);
    return { row: r, acc, kind };
  });
  const touched = new Set(plan.filter((p) => p.acc).map((p) => p.acc!.id));
  const projected =
    Object.entries(currentShares).filter(([id]) => !touched.has(id)).reduce((s, [, v]) => s + (Number(v) || 0), 0) +
    valid.reduce((s, r) => s + r.share, 0);

  const run = useMutation({
    mutationFn: async () => {
      const out: ImportResult = { added: [], updated: [], invites: [], failed: [] };
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      for (const p of plan) {
        try {
          if (p.kind === "update") {
            await api.updateMemberShare(coopId, p.acc!.id, p.row.share);
            out.updated.push(p.row.name);
          } else if (p.kind === "add") {
            await api.addCoopMember(coopId, { account_id: p.acc!.id, full_name: p.acc!.full_name, contribution_share: p.row.share, kilos: p.row.kilos });
            out.added.push(p.row.name);
          } else {
            const q = new URLSearchParams({ coop: COOP_NAME, share: String(p.row.share), phone: p.row.phone, name: p.row.name });
            out.invites.push({ name: p.row.name, phone: p.row.phone, share: p.row.share, url: `${origin}/onboarding?${q.toString()}` });
          }
        } catch (e) {
          out.failed.push({ name: p.row.name, reason: e instanceof ApiError ? e.message : "Couldn't save" });
        }
      }
      return out;
    },
    onSuccess: (out) => {
      setResult(out);
      void qc.invalidateQueries({ queryKey: ["coop", coopId] });
      toast.success(`Imported ${out.added.length + out.updated.length} farmers, ${out.invites.length} invites ready`);
    },
  });

  const close = () => { setResult(null); onClose(); };

  return (
    <>
    <Dialog open={rows.length > 0 && !smsOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? "Import finished" : `Import ${rows.length} farmers`}</DialogTitle>
          <DialogDescription>
            {result
              ? "Farmers already on Stawi were added with their share. New farmers need to open their invite link to set up M-Pesa and a PIN."
              : "Columns: name, phone, share %, and optionally kilos. Farmers already on Stawi are added directly; new ones get an invite link."}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <>
            {lookup.isLoading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Checking who is already on Stawi…</p>}
            {lookup.isError && <p className="text-xs text-terracotta">Couldn't check phone numbers. Everyone will get an invite link instead.</p>}
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {rows.map((r) => {
                const p = plan.find((x) => x.row === r);
                return (
                  <li key={r.line} className="flex items-center justify-between gap-2 border-b border-border py-1.5">
                    <span className="min-w-0 truncate">{r.name || <em className="text-muted-foreground">Row {r.line}</em>}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular text-xs text-muted-foreground">
                      {r.phone} · {r.share}%
                      {r.error ? (
                        <span className="text-terracotta">{r.error}</span>
                      ) : (
                        <StatusChip status={p?.kind === "invite" ? "pending" : "verified"} label={p?.kind === "invite" ? "Invite" : p?.kind === "update" ? "Update share" : "On Stawi · add"} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {invalid.length > 0 && <p className="text-xs text-terracotta">{invalid.length} row(s) will be skipped. Fix them in the file and import again.</p>}
            <p className={cn("text-xs", projected === 100 ? "text-muted-foreground" : "text-terracotta")}>
              Shares after import: <span className="tabular">{projected}%</span>
              {projected !== 100 && " — adjust shares to reach 100% before the next split."}
            </p>
            <Button disabled={valid.length === 0 || run.isPending || lookup.isLoading} onClick={() => run.mutate()}>
              {run.isPending && <Loader2 className="size-4 animate-spin" />} Import {valid.length} farmers
            </Button>
          </>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              <li>Added to co-op: <strong className="tabular">{result.added.length}</strong></li>
              <li>Shares updated: <strong className="tabular">{result.updated.length}</strong></li>
              <li>Invites to send: <strong className="tabular">{result.invites.length}</strong></li>
              {result.failed.length > 0 && <li className="text-terracotta">Failed: {result.failed.map((f) => `${f.name} (${f.reason})`).join(", ")}</li>}
            </ul>
            {result.invites.length > 0 && (
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {result.invites.map((i) => (
                  <div key={i.phone}>
                    <p className="mb-1 text-xs text-muted-foreground">{i.name} · {i.phone}</p>
                    <CopyLink url={i.url} subject="Join our co-op on Stawi" />
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {result.invites.length > 0 && (
                <>
                  <Button onClick={() => setSmsOpen(true)}>
                    <MessageSquare className="size-4" /> Text invites
                  </Button>
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
    {result && (
      <SendInvitesDialog open={smsOpen} onOpenChange={setSmsOpen} coopId={coopId} invites={result.invites} />
    )}
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
  const [status, setStatus] = useState<Record<string, { sent: boolean; error?: string }>>({});
  useEffect(() => { setPicked(new Set(invites.map((i) => i.phone))); setStatus({}); }, [invites]);
  const all = picked.size === invites.length;
  const toggle = (phone: string) =>
    setPicked((prev) => { const n = new Set(prev); if (n.has(phone)) n.delete(phone); else n.add(phone); return n; });

  const send = useMutation({
    mutationFn: () =>
      api.sendInviteSms(
        coopId,
        invites.filter((i) => picked.has(i.phone)).map((i) => ({ phone_number: i.phone, full_name: i.name, link: i.url })),
      ),
    onSuccess: (r) => {
      const next: Record<string, { sent: boolean; error?: string }> = {};
      for (const x of r.results) next[normalizeKePhone(x.phone_number) || x.phone_number] = { sent: x.sent, error: x.error };
      setStatus(next);
      if (r.failed === 0) toast.success(`Texted ${r.sent} farmers`);
      else toast.error(`Texted ${r.sent}, ${r.failed} failed`);
      // Leave the failed ones ticked so they can be retried.
      setPicked(new Set(invites.filter((i) => next[i.phone] && !next[i.phone]!.sent).map((i) => i.phone)));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't send texts"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Text invite links</DialogTitle>
          <DialogDescription>Each farmer gets an SMS with their own link to join your co-op on Stawi. Untick anyone you don't want to text.</DialogDescription>
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
        <div className="flex gap-2">
          <Button disabled={picked.size === 0 || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />} Send {picked.size} texts
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
