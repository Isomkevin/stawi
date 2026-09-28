import "dotenv/config";

const env = process.env;
export const config = {
  port: Number(env.PORT ?? 4000),
  // comma-separated; entries like "*.lovable.app" match any subdomain
  corsOrigins: (env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:8080").split(",").map((o) => o.trim()).filter(Boolean),
  feeRate: Number(env.STAWI_FEE_RATE ?? 0.008),
  payaza: {
    mode: (env.PAYAZA_MODE ?? "mock") as "mock" | "sandbox" | "live",
    publicKey: env.PAYAZA_PUBLIC_KEY ?? "",
    secretKey: env.PAYAZA_SECRET_KEY ?? "",
    pin: env.PAYAZA_PIN ?? "",
    baseUrl: env.PAYAZA_BASE_URL ?? "",
    webhookSecret: env.PAYAZA_WEBHOOK_SECRET ?? "",
  },
  at: {
    env: (env.AT_ENV ?? "sandbox") as "sandbox" | "live",
    username: env.AT_USERNAME ?? "sandbox",
    apiKey: env.AT_API_KEY ?? "",
    senderId: env.AT_SENDER_ID ?? "",
    callbackSecret: env.AT_CALLBACK_SECRET ?? "",
  },
};

console.log(`[stawi] PAYAZA_MODE=${config.payaza.mode} AT_ENV=${config.at.env}`);
