import type { CheckoutSession } from "./types";

const SDK_SRC = "https://checkout-v2.payaza.africa/js/v1/bundle.js";

export type PayazaOutcome = "success" | "declined" | "closed" | "redirect";

type PayazaCallback = {
  type?: string;
  status?: number;
  data?: { message?: string };
};

type PayazaHandle = {
  setCallback: (cb: (res: PayazaCallback) => void) => void;
  setOnClose: (cb: () => void) => void;
  showPopup: () => void;
};

type PayazaSdk = {
  setup: (config: Record<string, unknown>) => PayazaHandle;
};

type PayazaWindow = Window & { PayazaCheckout?: PayazaSdk };

function splitBuyerName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "Buyer", last_name: "Buyer" };
  if (parts.length === 1) return { first_name: parts[0]!, last_name: parts[0]! };
  return { first_name: parts[0]!, last_name: parts.slice(1).join(" ") };
}

function connectionMode(session: CheckoutSession): "Test" | "Live" {
  if (session.connection_mode === "Live" || session.connection_mode === "Test") return session.connection_mode;
  return session.public_key.includes("PKLIVE") ? "Live" : "Test";
}

function loadSdk(): Promise<PayazaSdk> {
  const current = (window as PayazaWindow).PayazaCheckout;
  if (current?.setup) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Payaza checkout did not load"));
    const ready = () => {
      const sdk = (window as PayazaWindow).PayazaCheckout;
      if (sdk?.setup) resolve(sdk);
      else fail();
    };
    const timer = window.setTimeout(fail, 10000);
    const finish = (run: () => void) => {
      window.clearTimeout(timer);
      run();
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => finish(ready), { once: true });
      existing.addEventListener("error", () => finish(fail), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => finish(ready);
    script.onerror = () => finish(fail);
    document.head.appendChild(script);
  });
}

/**
 * Opens Payaza's hosted checkout. The widget callback is not proof of payment;
 * the caller polls the invoice until the webhook moves it off pending.
 * Falls back to the payment link when the script cannot load.
 */
export async function openPayazaCheckout(input: {
  session: CheckoutSession;
  amount: number;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone?: string | undefined;
  invoiceId: string;
}): Promise<PayazaOutcome> {
  let sdk: PayazaSdk;
  try {
    sdk = await loadSdk();
  } catch (err) {
    if (input.session.checkoutUrl) {
      window.location.assign(input.session.checkoutUrl);
      return "redirect";
    }
    throw err;
  }

  const names = splitBuyerName(input.buyerName);
  const config: Record<string, unknown> = {
    merchant_key: input.session.public_key,
    connection_mode: connectionMode(input.session),
    checkout_amount: Number(input.amount),
    currency_code: input.currency,
    email_address: input.buyerEmail,
    first_name: names.first_name,
    last_name: names.last_name,
    transaction_reference: input.session.transaction_reference,
    additional_details: { invoice_id: input.invoiceId },
  };
  if (input.buyerPhone) config["phone_number"] = input.buyerPhone;

  const checkout = sdk.setup(config);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: PayazaOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    checkout.setCallback((res) => {
      finish(res.type === "success" ? "success" : "declined");
    });
    checkout.setOnClose(() => finish("closed"));
    checkout.showPopup();
  });
}
