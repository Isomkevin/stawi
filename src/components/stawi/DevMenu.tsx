import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FlaskConical, X } from "lucide-react";
import { isMock } from "@/lib/api";
import { homeForRole, useSession } from "@/lib/session";
import type { Role } from "@/lib/types";

const views: Array<{ role: Role; label: string; to?: string }> = [
  { role: "farmer", label: "Farmer app" },
  { role: "treasurer", label: "Co-op treasurer" },
  { role: "exporter", label: "Direct exporter" },
  { role: "buyer", label: "Buyer payment page", to: "/pay/inv_2413" },
];

/** Reviewer shortcut, only in demo mode. */
export function DevMenu() {
  const [open, setOpen] = useState(false);
  const session = useSession();
  const navigate = useNavigate();
  if (!isMock) return null;

  return (
    <div className="fixed right-4 bottom-20 z-50 md:bottom-4">
      {open && (
        <div className="mb-2 w-60 rounded-2xl border border-border bg-card p-2 shadow-lift">
          <p className="px-3 py-2 text-xs tracking-wide text-muted-foreground uppercase">Demo: switch view</p>
          {views.map((v) => (
            <button
              key={v.role}
              type="button"
              onClick={() => {
                session.signIn(v.role);
                setOpen(false);
                void navigate({ to: v.to ?? homeForRole[v.role] });
              }}
              className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm hover:bg-secondary"
            >
              {v.label}
              {session.role === v.role && <span className="size-2 rounded-full bg-lime" />}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/demo/ussd" });
            }}
            className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm hover:bg-secondary"
          >
            Basic-phone simulator
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label={open ? "Close demo menu" : "Open demo menu"}
        onClick={() => setOpen((o) => !o)}
        className="ml-auto grid size-12 place-items-center rounded-full border border-border bg-card shadow-lift hover:border-lime"
      >
        {open ? <X className="size-5" /> : <FlaskConical className="size-5 text-lime" />}
      </button>
    </div>
  );
}
