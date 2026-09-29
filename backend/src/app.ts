import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import { apiRouter } from "./routes";

dotenv.config();

export function createApp() {
  const app = express();

  // CORS configuration supporting wildcards (e.g. *.lovable.app)
  const allowedOriginsEnv = process.env.CORS_ORIGIN || "*";
  const originPatterns = allowedOriginsEnv.split(",").map((s) => s.trim());

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, Python e2e)
        if (!origin) return callback(null, true);

        if (originPatterns.includes("*")) {
          return callback(null, true);
        }

        const isAllowed = originPatterns.some((pattern) => {
          if (pattern === origin) return true;
          if (pattern.includes("*")) {
            const regex = new RegExp(
              "^" + pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\\\*/g, ".*") + "$"
            );
            return regex.test(origin);
          }
          return false;
        });

        if (isAllowed) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    })
  );

  // Parse JSON with rawBody capture for webhook signature verification
  app.use(
    express.json({
      // Buyer transfer receipts are sent as data URLs (max ~2 MB image/PDF).
      limit: "4mb",
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf;
      },
    })
  );

  // Parse URL-encoded bodies for Africa's Talking USSD callbacks
  app.use(express.urlencoded({ extended: true }));

  // Mount API router
  app.use("/", apiRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Route not found" });
  });

  // Global Error Handler (Clean JSON errors)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server Error]", err);
    const status = err.status || 500;
    const message = err.message || "Internal server error";
    res.status(status).json({ error: message });
  });

  return app;
}
