import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { isMock } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/types";

/** Protects an area. In demo mode a visitor is signed in as the matching demo role automatically. */
export function RoleGate({ role, children }: { role: Exclude<Role, "buyer">; children: ReactNode }) {
  const session = useSession();
  const navigate = useNavigate();
  const ok = session.role === role;

  useEffect(() => {
    if (ok) return;
    if (isMock) session.signIn(role);
    else void navigate({ to: "/login" });
  }, [ok, role, session, navigate]);

  if (!ok) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-lime" />
      </div>
    );
  }
  return <>{children}</>;
}
