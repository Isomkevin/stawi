import { createApp } from "./app";
import { connectPostgres } from "./db/postgres";
import { seedDatabase } from "./data/seed";
import { authRequired } from "./services/auth";
import { setStore, store } from "./store";

const PORT = parseInt(process.env.PORT || "4100", 10);

async function main() {
  const mode = process.env.PAYAZA_MODE || "mock";
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production so balances survive restarts");
  }
  if (process.env.NODE_ENV === "production" && !process.env.AT_CALLBACK_SECRET) {
    throw new Error("AT_CALLBACK_SECRET is required in production");
  }
  if (process.env.NODE_ENV === "production" && mode !== "sandbox" && mode !== "live") {
    throw new Error("Set PAYAZA_MODE to sandbox or live in production. Mock mode does not move real money.");
  }
  if ((mode === "sandbox" || mode === "live") && (!process.env.PAYAZA_PUBLIC_KEY || !process.env.PAYAZA_SECRET_KEY)) {
    throw new Error("PAYAZA_PUBLIC_KEY and PAYAZA_SECRET_KEY are required when PAYAZA_MODE is sandbox or live");
  }

  if (process.env.DATABASE_URL) {
    console.log("[DB] Connecting to Postgres...");
    setStore(await connectPostgres(process.env.DATABASE_URL));
    console.log("[DB] Postgres ready.");
  } else {
    console.log("[DB] No DATABASE_URL set. Using in-memory store.");
  }

  const production = process.env.NODE_ENV === "production";
  const shouldSeed = process.env.SEED === "true" || (!production && process.env.SEED !== "false");
  if (shouldSeed) {
    const existing = await store.getAccount("acc_treasurer");
    if (!existing) {
      console.log("[Seed] Seeding demo ledger (4 co-ops, 76 farmers, 6 exporters, PIN 1234)...");
      await seedDatabase();
      console.log("[Seed] Demo data seeded successfully.");
    }
  }

  const app = createApp();

  app.listen(PORT, "0.0.0.0", () => {
    console.log("==================================================");
    console.log(` Stawi Backend API running on port ${PORT}`);
    console.log(` Environment:   ${process.env.NODE_ENV || "development"}`);
    console.log(` PAYAZA_MODE:   ${mode}`);
    console.log(` AT_ENV:        ${process.env.AT_ENV || "sandbox"}`);
    console.log(` Database:      ${process.env.DATABASE_URL ? "postgres" : "memory"}`);
    console.log(` Auth:          ${authRequired() ? "required" : "open (mock/dev only)"}`);
    console.log(` USSD Secret:   ${process.env.AT_CALLBACK_SECRET ? "configured" : "none"}`);
    console.log("==================================================");
  });
}

main().catch((err) => {
  console.error("Failed to start Stawi backend:", err);
  process.exit(1);
});
