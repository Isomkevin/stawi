import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Leaf, LogOut } from "lucide-react";
import { AccountSwitcher } from "@/components/stawi/AccountSwitcher";
import { useSession } from "@/lib/session";

export type NavItem = { to: string; label: string; icon: LucideIcon };

export function DashboardShell({
  title,
  subtitle,
  nav,
  children,
}: {
  title: string;
  subtitle: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  const { signOut } = useSession();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar p-4 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="grid size-9 place-items-center rounded-lg bg-lime">
            <Leaf className="size-4 text-primary-foreground" />
          </span>
          <span className="text-display text-xl">Stawi</span>
        </Link>
        <div className="mb-6 rounded-xl border border-border p-3">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          <AccountSwitcher className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" />
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "bg-secondary text-foreground" }}
            >
              <n.icon className="size-4" strokeWidth={1.75} />
              {n.label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => {
            signOut();
            void navigate({ to: "/" });
          }}
          className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </aside>
      <div className="min-w-0 flex-1">
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-2 md:hidden">
          <AccountSwitcher className="mr-2 flex shrink-0 items-center gap-2 text-xs text-muted-foreground" />
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground"
              activeProps={{ className: "bg-secondary text-foreground" }}
            >
              <n.icon className="size-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-display text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
