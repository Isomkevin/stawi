import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { LifeBuoy, LogOut } from "lucide-react";
import { PinPad } from "@/components/stawi/PinPad";
import { DestinationManager } from "@/features/farmer/DestinationManager";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { accountOptions } from "@/lib/queries";
import { useAccountId, useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { initials } from "@/lib/format";
import { DEMO_PIN } from "@/lib/mock";

export const Route = createFileRoute("/app/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Stawi" },
      { name: "description", content: "Your details, payout destinations, PIN and language." },
      { property: "og:title", content: "Profile — Stawi" },
      { property: "og:description", content: "Your details, payout destinations, PIN and language." },
    ],
  }),
  component: ProfileTab,
});

function ProfileTab() {
  const { t, lang, setLang } = useI18n();
  const accountId = useAccountId();
  const { signOut } = useSession();
  const navigate = useNavigate();
  const account = useQuery(accountOptions(accountId));
  const [ussd, setUssd] = useState<boolean | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinStage, setPinStage] = useState<"old" | "new">("old");
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);

  const a = account.data;
  const ussdOn = ussd ?? a?.channel_capability === "webapp+ussd";

  const onPin = (v: string) => {
    setPinErr(null);
    setPin(v);
    if (v.length < 4) return;
    if (pinStage === "old") {
      if (v !== DEMO_PIN) {
        setPinErr("That PIN isn't right.");
        setPin("");
      } else {
        setPinStage("new");
        setPin("");
      }
    } else {
      // TODO(backend): add to contract — PIN change endpoint
      toast.success("PIN changed");
      setPinOpen(false);
      setPin("");
      setPinStage("old");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-secondary text-lg font-medium">
          {a ? initials(a.full_name) : ""}
        </span>
        <div>
          <h1 className="text-display text-2xl">{a?.full_name ?? "…"}</h1>
          <p className="text-sm text-muted-foreground tabular">{a?.phone_number}</p>
        </div>
      </div>

      <Card title={t("profile.details")}>
        <p className="text-sm"><span className="text-muted-foreground">ID number: </span><span className="tabular">{a?.id_number}</span></p>
        <p className="text-sm"><span className="text-muted-foreground">Co-op: </span>{a?.coop_id ? "Kiambu Highlands Coffee Co-op" : "Independent"}</p>
      </Card>

      <Card title={t("profile.destinations")}>
        <DestinationManager account={a} />
      </Card>

      <Card title={t("profile.pin")}>
        <Button variant="outline" className="h-11 w-full" onClick={() => setPinOpen(true)}>
          {t("profile.pin")}
        </Button>
      </Card>

      <Card title={t("profile.language")}>
        <div className="grid grid-cols-2 gap-2">
          {(["en", "sw"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`min-h-11 rounded-xl border text-sm ${lang === l ? "border-lime bg-lime/15 text-lime" : "border-border"}`}
            >
              {l === "en" ? "English" : "Kiswahili"}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t("profile.channels")}>
        <label className="flex min-h-11 items-center justify-between text-sm">
          <span>
            Basic phone access (USSD)
            <span className="block text-xs text-muted-foreground">Dial *384*72# from any phone</span>
          </span>
          <Switch checked={ussdOn} onCheckedChange={(v) => setUssd(v)} />
        </label>
      </Card>

      <Card title={t("profile.support")}>
        <a href="tel:+254700000000" className="flex min-h-11 items-center gap-2 text-sm">
          <LifeBuoy className="size-4 text-sage" /> Call support: 0700 000 000
        </a>
      </Card>

      <Button
        variant="ghost"
        className="h-12 w-full text-terracotta"
        onClick={() => {
          signOut();
          void navigate({ to: "/" });
        }}
      >
        <LogOut className="size-4" /> {t("common.signOut")}
      </Button>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pinStage === "old" ? "Enter your current PIN" : "Choose a new PIN"}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <PinPad value={pin} onChange={onPin} error={pinErr} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
