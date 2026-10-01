import { Request, Response } from "express";
import { isKenyanPhone, normalizePhone } from "../services/phone";
import { dispatchUssd } from "./session";

const UNAVAILABLE = "END Stawi is unavailable right now. Please dial again.";
const INVALID = "END Invalid request. Please dial again.";

export async function handleUssdCallback(req: Request, res: Response): Promise<void> {
  const expectedSecret = process.env.AT_CALLBACK_SECRET;
  if (expectedSecret) {
    const querySecret = typeof req.query.s === "string" ? req.query.s : undefined;
    const headerSecret = req.headers["x-ussd-secret"];
    const header = typeof headerSecret === "string" ? headerSecret : undefined;
    if (querySecret !== expectedSecret && header !== expectedSecret) {
      res.status(401).send("Unauthorized: Invalid callback secret");
      return;
    }
  }

  res.setHeader("Content-Type", "text/plain");

  try {
    const turn = readTurn(req);
    if (!turn) {
      reply(res, INVALID);
      return;
    }
    reply(res, await dispatchUssd(turn));
  } catch (err) {
    console.error("[USSD] Handler error:", err instanceof Error ? err.message : "unknown");
    reply(res, UNAVAILABLE);
  }
}

function readTurn(req: Request): { sessionId: string; phone: string; serviceCode: string; text: string } | null {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
  const sessionId = readField(body, req.query, "sessionId")?.trim() ?? "";
  const phoneRaw = readField(body, req.query, "phoneNumber")?.trim() ?? "";
  const serviceCode = readField(body, req.query, "serviceCode")?.trim() ?? "";
  const textField = readField(body, req.query, "text");
  if (!sessionId || sessionId.length > 128 || !phoneRaw || textField === null) return null;
  const phone = normalizePhone(phoneRaw);
  if (!isKenyanPhone(phone)) return null;
  return { sessionId, phone, serviceCode, text: textField };
}

/** A string field, or "" when it is missing. Null means the value was not text. */
function readField(body: Record<string, unknown>, query: Request["query"], key: string): string | null {
  const value = body[key] !== undefined ? body[key] : query[key];
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return null;
}

/** Africa's Talking drops a USSD reply longer than 182 characters. */
function reply(res: Response, body: string): void {
  const limit = 182;
  res.status(200).send(body.length <= limit ? body : `${body.slice(0, limit - 3)}...`);
}
