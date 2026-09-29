import { store } from "../store";
import { requireKenyanPhone } from "./phone";
import { Invoice, SHIPMENT_STATUSES, Shipment, ShipmentFarmer } from "../types";

/** A new co-op invoice opens an empty draft shipment. The treasurer adds the farmers who will be paid. */
export async function openShipmentForInvoice(invoice: Invoice): Promise<Shipment> {
  const match = invoice.description.match(/(\d+)\s*kg/i);
  const parsed = match ? Number(match[1]) : 1000;
  const shipment: Shipment = {
    id: `shp_${invoice.id}`,
    reference: invoice.reference,
    coop_id: invoice.type === "coop" ? invoice.coop_id || "" : "",
    account_id: invoice.type === "direct" ? invoice.account_id : null,
    buyer_name: invoice.buyer_name,
    product: invoice.description.slice(0, 255) || "Export lot",
    quantity_kg: parsed > 0 ? parsed : 1000,
    destination: "TBD",
    value: invoice.amount,
    currency: invoice.currency,
    ship_date: invoice.due_at || invoice.created_at,
    shipped_at: null,
    status: "draft",
    invoice_id: invoice.id,
    farmers: [],
    is_demo: invoice.is_demo === true,
    updated_at: invoice.created_at,
  };
  await store.saveShipment(shipment);
  return shipment;
}

export async function advanceShipment(
  id: string
): Promise<{ ok: true; shipment: Shipment } | { ok: false; status: number; error: string }> {
  const current = await store.getShipment(id);
  if (!current) return { ok: false, status: 404, error: "Shipment not found" };

  const index = SHIPMENT_STATUSES.indexOf(current.status);
  if (index < 0 || index >= SHIPMENT_STATUSES.length - 1) {
    return { ok: false, status: 400, error: "Shipment is already completed" };
  }

  if (current.status === "draft" && !current.account_id) {
    const kilos = current.farmers.reduce((sum, farmer) => sum + farmer.kilos, 0);
    if (current.farmers.length === 0 || kilos !== current.quantity_kg) {
      return { ok: false, status: 400, error: "Add farmers whose kilos add up to the shipment quantity" };
    }
  }

  if (current.status === "delivered") {
    const invoice = current.invoice_id ? await store.getInvoice(current.invoice_id) : undefined;
    if (!invoice || invoice.status !== "completed") {
      return { ok: false, status: 400, error: "Close the shipment once farmers are paid out" };
    }
  }

  const now = new Date().toISOString();
  const next = SHIPMENT_STATUSES[index + 1];
  const shipment: Shipment = {
    ...current,
    status: next,
    shipped_at: next === "in_transit" ? now : current.shipped_at,
    updated_at: now,
  };
  await store.saveShipment(shipment);
  return { ok: true, shipment };
}

export type ShipmentDetailPatch = {
  buyer_name?: unknown;
  product?: unknown;
  quantity_kg?: unknown;
  destination?: unknown;
  value?: unknown;
  currency?: unknown;
  ship_date?: unknown;
};

/** Buyer, crop, kilos, destination, value, and ship date stay editable until an invoice is linked. */
export async function updateShipmentDetails(
  id: string,
  patch: ShipmentDetailPatch
): Promise<{ ok: true; shipment: Shipment } | { ok: false; status: number; error: string }> {
  const current = await store.getShipment(id);
  if (!current) return { ok: false, status: 404, error: "Shipment not found" };
  if (current.invoice_id) {
    return { ok: false, status: 409, error: "Shipment details are locked once an invoice exists" };
  }

  const text = (value: unknown, fallback: string, max = 255) =>
    value === undefined ? fallback : typeof value === "string" ? value.trim().slice(0, max) : "";
  const buyer = text(patch.buyer_name, current.buyer_name);
  const product = text(patch.product, current.product);
  const destination =
    patch.destination === undefined ? current.destination : text(patch.destination, "", 255) || "TBD";
  const quantity = patch.quantity_kg === undefined ? current.quantity_kg : Number(patch.quantity_kg);
  const value = patch.value === undefined ? current.value : Number(patch.value);
  const currency =
    patch.currency === undefined
      ? current.currency
      : ["USD", "EUR", "GBP"].includes(String(patch.currency))
        ? String(patch.currency)
        : "";
  const shipDate =
    patch.ship_date === undefined
      ? current.ship_date
      : typeof patch.ship_date === "string" && !Number.isNaN(Date.parse(patch.ship_date))
        ? new Date(patch.ship_date).toISOString()
        : "";

  if (!buyer || !product) return { ok: false, status: 400, error: "Buyer and product are required" };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, status: 400, error: "Quantity must be a whole number of kilos greater than zero" };
  }
  const assigned = current.farmers.reduce((sum, farmer) => sum + farmer.kilos, 0);
  if (quantity < assigned) {
    return { ok: false, status: 400, error: "Quantity can't be less than the kilos already assigned to farmers" };
  }
  if (!Number.isFinite(value) || value < 0) return { ok: false, status: 400, error: "Value must be zero or more" };
  if (!currency) return { ok: false, status: 400, error: "Currency must be USD, EUR, or GBP" };
  if (!shipDate) return { ok: false, status: 400, error: "Ship date is not valid" };

  const shipment: Shipment = {
    ...current,
    buyer_name: buyer,
    product,
    quantity_kg: quantity,
    destination,
    value,
    currency,
    ship_date: shipDate,
    updated_at: new Date().toISOString(),
  };
  await store.saveShipment(shipment);
  return { ok: true, shipment };
}

async function farmerListLocked(shipment: Shipment): Promise<string | null> {
  if (!shipment.invoice_id) return null;
  const invoice = await store.getInvoice(shipment.invoice_id);
  if (!invoice) return null;
  if (invoice.split_approved || invoice.status === "completed") {
    return "Farmers are locked once the split is approved";
  }
  return null;
}

function withFarmer(shipment: Shipment, accountId: string, kilos: number): ShipmentFarmer[] {
  const others = shipment.farmers.filter((farmer) => farmer.account_id !== accountId);
  return [...others, { account_id: accountId, kilos }].sort((a, b) => a.account_id.localeCompare(b.account_id));
}

/** Saves a verified M-Pesa number when the farmer does not already have one. Payaza pays this number on split approval. */
async function attachMpesa(accountId: string, raw: string | undefined): Promise<{ ok: false; error: string } | { ok: true }> {
  if (!raw || !raw.trim()) return { ok: true };
  let phone: string;
  try {
    phone = requireKenyanPhone(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Enter a Kenyan M-Pesa number" };
  }
  const account = await store.getAccount(accountId);
  if (!account) return { ok: false, error: "Farmer account not found" };
  const hasMobile = account.payout_destinations.some(
    (dest) => dest.is_verified && (dest.type === "mpesa" || dest.type === "momo")
  );
  if (hasMobile) return { ok: true };
  if (account.payout_destinations.some((dest) => dest.type === "mpesa" && dest.details === phone)) {
    const existing = account.payout_destinations.find((dest) => dest.type === "mpesa" && dest.details === phone);
    if (existing && !existing.is_verified) existing.is_verified = true;
    await store.saveAccount(account);
    return { ok: true };
  }
  account.payout_destinations.push({
    id: `dest_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
    type: "mpesa",
    details: phone,
    account_name: account.full_name,
    is_verified: true,
  });
  await store.saveAccount(account);
  return { ok: true };
}

export async function addShipmentFarmer(
  shipmentId: string,
  accountId: string,
  kilos: number,
  mpesa?: string
): Promise<{ ok: true; shipment: Shipment; created: boolean } | { ok: false; status: number; error: string }> {
  const current = await store.getShipment(shipmentId);
  if (!current) return { ok: false, status: 404, error: "Shipment not found" };
  if (!Number.isInteger(kilos) || kilos <= 0) {
    return { ok: false, status: 400, error: "Kilos must be a whole number greater than zero" };
  }

  const locked = await farmerListLocked(current);
  if (locked) return { ok: false, status: 409, error: locked };

  const members = await store.getCoopMembers(current.coop_id);
  if (!members.some((member) => member.account_id === accountId)) {
    return { ok: false, status: 400, error: "Add this person to the co-op before putting them on a shipment" };
  }

  const already = current.farmers.find((farmer) => farmer.account_id === accountId);
  const used = current.farmers.reduce((sum, farmer) => sum + farmer.kilos, 0) - (already?.kilos ?? 0);
  if (used + kilos > current.quantity_kg) {
    return { ok: false, status: 400, error: "Farmer kilos would exceed the shipment quantity" };
  }

  const mobile = await attachMpesa(accountId, mpesa);
  if (!mobile.ok) return { ok: false, status: 400, error: mobile.error };

  const shipment: Shipment = {
    ...current,
    farmers: withFarmer(current, accountId, kilos),
    updated_at: new Date().toISOString(),
  };
  await store.saveShipment(shipment);
  return { ok: true, shipment, created: !already };
}

export async function removeShipmentFarmer(
  shipmentId: string,
  accountId: string
): Promise<{ ok: true; shipment: Shipment } | { ok: false; status: number; error: string }> {
  const current = await store.getShipment(shipmentId);
  if (!current) return { ok: false, status: 404, error: "Shipment not found" };

  const locked = await farmerListLocked(current);
  if (locked) return { ok: false, status: 409, error: locked };

  if (!current.farmers.some((farmer) => farmer.account_id === accountId)) {
    return { ok: false, status: 404, error: "Farmer is not on this shipment" };
  }

  const shipment: Shipment = {
    ...current,
    farmers: current.farmers.filter((farmer) => farmer.account_id !== accountId),
    updated_at: new Date().toISOString(),
  };
  await store.saveShipment(shipment);
  return { ok: true, shipment };
}
