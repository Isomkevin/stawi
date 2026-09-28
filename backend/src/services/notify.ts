export type AtEnv = "sandbox" | "live";

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  dryRun?: boolean;
  error?: string;
}

export class NotificationService {
  private env: AtEnv;
  private username: string;
  private apiKey: string;
  private senderId: string;
  private baseUrl: string;

  constructor() {
    this.env = (process.env.AT_ENV as AtEnv) || "sandbox";
    this.username = process.env.AT_USERNAME || "sandbox";
    this.apiKey = process.env.AT_API_KEY || "";
    this.senderId = process.env.AT_SENDER_ID || "STAWI";

    this.baseUrl =
      this.env === "live"
        ? "https://api.africastalking.com/version1/messaging"
        : "https://api.sandbox.africastalking.com/version1/messaging";
  }

  public getEnv(): AtEnv {
    return this.env;
  }

  /**
   * Sends an SMS alert via Africa's Talking.
   * Best-effort: failures are logged and never throw/block financial operations.
   */
  public async sendSms(to: string, message: string): Promise<SmsSendResult> {
    // If no API key or in placeholder/test mode, perform a safe dry-run
    if (!this.apiKey || this.apiKey.includes("placeholder") || this.apiKey === "test") {
      console.log(`[SMS Dry-Run] To: ${to} | Message: "${message}"`);
      return { success: true, dryRun: true };
    }

    try {
      const formattedTo = to.startsWith("+") ? to : `+${to}`;
      const params = new URLSearchParams();
      params.append("username", this.username);
      params.append("to", formattedTo);
      params.append("message", message);

      if (this.env === "live" && this.senderId) {
        params.append("from", this.senderId);
      }

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          apiKey: this.apiKey,
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
