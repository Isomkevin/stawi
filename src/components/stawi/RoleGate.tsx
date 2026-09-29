import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { isMock } from "@/lib/api";
import { homeForRole, useSession } from "@/lib/session";
import type { Role } from "@/lib/types";

/** Protects an area. In demo mode a visitor is signed in as the matching demo role automatically. */
export function RoleGate({ role, children }: { role: Exclude<Role, "buyer">; children: ReactNode }) {
  const session = useSession();
  const navigate = useNavigate();
  const active = session.role === role;

  useEffect(() => {
    if (!session.ready || active) return;
    if (isMock) {
      session.signIn(role);
      return;
    }
    if (session.roles.includes(role)) {
      session.switchRole(role);
      return;
    }
    void navigate({ to: session.role ? homeForRole[session.role] : "/login" });
  }, [active, role, session, navigate]);

  if (!session.ready || !active) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-lime" />
      </div>
    );
  }
  return <>{children}</>;
}
