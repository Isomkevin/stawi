import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { COOP_ID, EXPORTER_ID, FARMER_ID, TREASURER_ID } from "./mock";
import { setSessionToken } from "./api";
import type { Role } from "./types";

type Session = {
  role: Role | null;
  accountId: string | null;
  coopId: string | null;
};

type SessionContextValue = Session & {
  signIn: (role: Role, accountId?: string) => void;
  signOut: () => void;
};

const roleDefaults: Record<Exclude<Role, "buyer">, Session> = {
  farmer: { role: "farmer", accountId: FARMER_ID, coopId: COOP_ID },
  treasurer: { role: "treasurer", accountId: TREASURER_ID, coopId: COOP_ID },
  exporter: { role: "exporter", accountId: EXPORTER_ID, coopId: null },
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  // Session lives in memory only; live mode expects an httpOnly cookie alongside it.
  const [session, setSession] = useState<Session>({ role: null, accountId: null, coopId: null });

  const value = useMemo<SessionContextValue>(
    () => ({
      ...session,
      signIn: (role, accountId) => {
        setSessionToken(`demo-token-${role}`);
        const base = role === "buyer" ? { role, accountId: null, coopId: null } : roleDefaults[role];
        setSession(accountId ? { ...base, accountId } : base);
      },
      signOut: () => {
        setSessionToken(null);
        setSession({ role: null, accountId: null, coopId: null });
      },
    }),
    [session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export const homeForRole: Record<Role, string> = {
  farmer: "/app/home",
  exporter: "/direct/overview",
  treasurer: "/coop/overview",
  buyer: "/",
};

/** Falls back to the demo farmer so every screen works without signing in first. */
export function useAccountId(fallback: string = FARMER_ID): string {
  const { accountId } = useSession();
  return accountId ?? fallback;
}

export function useCoopId(): string {
  const { coopId } = useSession();
  return coopId ?? COOP_ID;
}
