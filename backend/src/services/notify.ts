import AfricasTalking from "africastalking";
import { config } from "../config.js";

let sms: { send: (o: Record<string, unknown>) => Promise<any> } | null = null;
function client() {
  if (!sms && config.at.apiKey) {
    sms = (AfricasTalking as any)({ apiKey: config.at.apiKey, username: config.at.username }).SMS;
  }
  return sms;
}

/** Best-effort SMS. Never throws — a failed notification must not affect money movement. */
export async function sendSms(to: string, message: string): Promise<void> {
  const c = client();
  if (!c) { console.log(`[sms:dry-run] to=${to} :: ${message}`); return; }
  try {
    const res = await c.send({
      to: [to], message,
      ...(config.at.env === "live" && config.at.senderId ? { from: config.at.senderId } : {}),
    });
    const bad = res?.SMSMessageData?.Recipients?.filter((r: any) => r.statusCode !== 101);
    if (bad?.length) console.warn("[sms] delivery issue", JSON.stringify(bad));
  } catch (e) {
    console.warn("[sms] send failed", (e as Error).message);
  }
}
