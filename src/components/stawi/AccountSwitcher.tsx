import { useNavigate } from "@tanstack/react-router";
import { homeForRole, useSession } from "@/lib/session";
import type { Role } from "@/lib/types";

const labels: Record<Exclude<Role, "buyer">, string> = {
  farmer: "Farmer",
  treasurer: "Co-op",
  exporter: "Exporter",
};

/** Shown when this phone is mapped to more than one account type. */
export function AccountSwitcher({ className }: { className?: string }) {
  const session = useSession();
  const navigate = useNavigate();
  if (session.roles.length < 2) return null;

  return (
    <label className={className ?? "flex items-center gap-2 text-xs text-muted-foreground"}>
      Account
      <select
        aria-label="Account type"
        className="min-h-11 rounded-full border border-border bg-card px-3 text-sm text-foreground"
        value={session.role ?? ""}
        onChange={(event) => {
          const role = event.target.value as Exclude<Role, "buyer">;
          if (!session.roles.includes(role)) return;
          session.switchRole(role);
          void navigate({ to: homeForRole[role] });
        }}
      >
        {session.roles.map((role) => (
          <option key={role} value={role}>
            {labels[role]}
          </option>
        ))}
      </select>
    </label>
  );
}
