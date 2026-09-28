import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Upload, UserPlus } from "lucide-react";
import { CopyLink } from "@/components/stawi/CopyLink";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/features/shared/DashboardShell";
import { api } from "@/lib/api";
import { parseMembersCsv } from "@/lib/csv";
import { accountName, mockDb } from "@/lib/mock";
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
              </tr>
            </thead>
            <tbody>
              {members.data?.map((m) => {
                const acc = accounts.find((a) => a.id === m.account_id);
                const verified = acc?.payout_destinations.some((d) => d.is_verified);
                return (
                  <tr key={m.account_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{m.full_name ?? accountName(m.account_id)}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground tabular sm:table-cell">{acc?.phone_number}</td>
                    <td className="hidden px-4 py-3 text-right tabular md:table-cell">{m.kilos ?? "—"}</td>
                    <td className="px-4 py-3"><StatusChip status={verified ? "verified" : "missing"} label={verified ? "Verified" : "Not verified"} /></td>
                    <td className="px-4 py-3 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        aria-label={`Share for ${accountName(m.account_id)}`}
                        value={shares[m.account_id] ?? 0}
                        onChange={(e) => setShares((s) => ({ ...s, [m.account_id]: Number(e.target.value) }))}
                        className="ml-auto h-10 w-20 text-right tabular"
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

      <Dialog open={csvRows.length > 0} onOpenChange={(o) => !o && setCsvRows([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import {csvRows.length} farmers</DialogTitle>
            <DialogDescription>Columns: name, phone, share. Each will get an invite link.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {csvRows.map((r, i) => (
              <li key={i} className="flex justify-between border-b border-border py-1"><span>{r.name}</span><span className="tabular text-muted-foreground">{r.phone} · {r.share}%</span></li>
            ))}
          </ul>
          <Button onClick={() => { toast.success(`${csvRows.length} invites queued`); setCsvRows([]); }}>Send invites</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
