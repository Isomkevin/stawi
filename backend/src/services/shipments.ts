import { store } from "../store";
import { SHIPMENT_STATUSES, Shipment } from "../types";

export async function advanceShipment(
  id: string
): Promise<{ ok: true; shipment: Shipment } | { ok: false; status: number; error: string }> {
  const current = await store.getShipment(id);
  if (!current) return { ok: false, status: 404, error: "Shipment not found" };

  const index = SHIPMENT_STATUSES.indexOf(current.status);
  if (index < 0 || index >= SHIPMENT_STATUSES.length - 1) {
    return { ok: false, status: 400, error: "Shipment is already completed" };
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
