import { createApp } from "./app";
import { seedDatabase } from "./data/seed";

const PORT = parseInt(process.env.PORT || "4100", 10);
const shouldSeed = process.env.SEED !== "false";

async function main() {
  if (shouldSeed) {
    console.log("[Seed] Seeding demo data (10-farmer co-op + solo exporter, PIN: 1234)...");
    await seedDatabase();
    console.log("[Seed] Demo data seeded successfully.");
  }

  const app = createApp();

  app.listen(PORT, "0.0.0.0", () => {
    console.log("==================================================");
    console.log(` Stawi Backend API running on port ${PORT}`);
    console.log(` Environment:   ${process.env.NODE_ENV || "development"}`);
    console.log(` PAYAZA_MODE:   ${process.env.PAYAZA_MODE || "mock"}`);
    console.log(` AT_ENV:        ${process.env.AT_ENV || "sandbox"}`);
    console.log(` USSD Secret:   ${process.env.AT_CALLBACK_SECRET ? "configured" : "none"}`);
    console.log("==================================================");
  });
}

main().catch((err) => {
  console.error("Failed to start Stawi backend:", err);
  process.exit(1);
});
