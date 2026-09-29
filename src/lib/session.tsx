import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COOP_ID, EXPORTER_ID, FARMER_ID, TREASURER_ID } from "./mock";
import { api, isMock, setSessionToken } from "./api";
import type { Role } from "./types";

type Session = {
  role: Role | null;
  roles: Array<Exclude<Role, "buyer">>;
  accountId: string | null;
  coopId: string | null;
};

type SignInOptions = {
  accountId?: string | undefined;
  coopId?: string | null | undefined;
  token?: string | undefined;
  roles?: Array<Exclude<Role, "buyer">> | undefined;
};

type SessionContextValue = Session & {
  ready: boolean;
  signIn: (role: Role, opts?: SignInOptions) => void;
  switchRole: (role: Exclude<Role, "buyer">) => void;
  signOut: () => void;
};

const roleDefaults: Record<Exclude<Role, "buyer">, Session> = {
  farmer: { role: "farmer", roles: ["farmer"], accountId: FARMER_ID, coopId: COOP_ID },
  treasurer: { role: "treasurer", roles: ["treasurer"], accountId: TREASURER_ID, coopId: COOP_ID },
  exporter: { role: "exporter", roles: ["exporter"], accountId: EXPORTER_ID, coopId: null },
};

const STORE_KEY = "stawi.session";
const empty: Session = { role: null, roles: [], accountId: null, coopId: null };

// Kept on globalThis so a hot reload of this file doesn't create a second, empty context.
const g = globalThis as { __stawiSessionCtx?: ReturnType<typeof createContext<SessionContextValue | null>> };
const SessionContext = (g.__stawiSessionCtx ??= createContext<SessionContextValue | null>(null));

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(empty);
  const [ready, setReady] = useState(isMock);

  // Live mode: keep the sign-in for this browser tab so a reload doesn't sign you out.
  useEffect(() => {
    if (isMock) return;
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Session & { token: string; roles?: Session["roles"] };
        setSessionToken(saved.token);
        const roles =
          saved.roles?.filter((role) => role === "farmer" || role === "exporter" || role === "treasurer") ??
          (saved.role && saved.role !== "buyer" ? [saved.role] : []);
        setSession({ role: saved.role, roles, accountId: saved.accountId, coopId: saved.coopId });
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...session,
      ready,
      signIn: (role, opts = {}) => {
        const base = role === "buyer" ? empty : roleDefaults[role];
        const roles =
          opts.roles ??
          (role === "buyer" ? [] : [role]);
        const next: Session = {
          role,
          roles,
          accountId: opts.accountId ?? base.accountId,
          coopId: opts.coopId !== undefined ? opts.coopId : base.coopId,
        };
        const token = opts.token ?? `demo-token-${role}`;
        setSessionToken(token);
        if (!isMock) sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...next, token }));
        setSession(next);
      },
      switchRole: (role) => {
        setSession((current) => {
          if (!current.roles.includes(role)) return current;
          const next = { ...current, role };
          if (!isMock) {
            try {
              const raw = sessionStorage.getItem(STORE_KEY);
              const saved = raw ? (JSON.parse(raw) as { token?: string }) : {};
              sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...next, token: saved.token }));
            } catch {
              /* ignore */
            }
          }
          return next;
        });
      },
      signOut: () => {
        void api.logout().catch(() => undefined);
        setSessionToken(null);
        if (!isMock) sessionStorage.removeItem(STORE_KEY);
        setSession(empty);
      },
    }),
    [session, ready],
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
