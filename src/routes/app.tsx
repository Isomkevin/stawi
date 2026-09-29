import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ArrowUpRight, Home, ListOrdered, Leaf, UserRound } from "lucide-react";
import { RoleGate } from "@/components/stawi/RoleGate";
import { AccountSwitcher } from "@/components/stawi/AccountSwitcher";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Your money — Stawi" },
      { name: "description", content: "See your balance, payments on the way and withdraw to M-Pesa." },
      { property: "og:title", content: "Your money — Stawi" },
      { property: "og:description", content: "See your balance, payments on the way and withdraw to M-Pesa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppLayout,
});

function AppLayout() {
  const { t, lang, setLang } = useI18n();
  const tabs = [
    { to: "/app/home", label: t("nav.home"), icon: Home },
    { to: "/app/activity", label: t("nav.activity"), icon: ListOrdered },
    { to: "/app/withdraw", label: t("nav.withdraw"), icon: ArrowUpRight },
    { to: "/app/profile", label: t("nav.profile"), icon: UserRound },
  ] as const;

  return (
    <RoleGate role="farmer">
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
            <Link to="/" className="flex items-center gap-2 font-medium">
              <span className="grid size-8 place-items-center rounded-lg bg-lime">
                <Leaf className="size-4 text-primary-foreground" />
              </span>
              <span className="text-display text-lg">Stawi</span>
            </Link>
            <div className="flex items-center gap-2">
              <AccountSwitcher />
              <button
                type="button"
                onClick={() => setLang(lang === "en" ? "sw" : "en")}
                className="min-h-11 rounded-full border border-border px-3 text-xs font-medium hover:border-sage"
                aria-label="Switch language"
              >
                {lang === "en" ? "Kiswahili" : "English"}
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-lg px-4 pt-5 pb-28">
          <Outlet />
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
          <div className="mx-auto grid max-w-lg grid-cols-4">
            {tabs.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
                activeProps={{ className: "text-lime" }}
              >
                {({ isActive }) => (
                  <>
                    <tab.icon className={cn("size-5", isActive && "text-lime")} strokeWidth={1.75} />
                    <span className={cn(isActive && "text-lime")}>{tab.label}</span>
                  </>
                )}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </RoleGate>
  );
}
