import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { api } from "./routes/index.js";
import { ussd } from "./ussd/handler.js";
import { seed } from "./data/seed.js";

const app = express();
const allowed = (origin: string) => config.corsOrigins.some((o) => o.startsWith("*.") ? new URL(origin).hostname.endsWith(o.slice(1)) : o === origin);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed(origin)) }));
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Africa's Talking posts form-encoded

app.get("/health", (_req, res) => res.json({ ok: true, payaza: config.payaza.mode, at: config.at.env }));
app.use("/", api);
app.use("/ussd", ussd);

let seeded: ReturnType<typeof seed> | null = null;
if (process.env.SEED !== "false") seeded = seed();
if (config.payaza.mode === "mock") app.get("/dev/seed-ids", (_req, res) => res.json(seeded ?? {})); // dev only
app.listen(config.port, () => console.log(`[stawi] api on :${config.port}`));
