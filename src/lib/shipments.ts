import { mockDemoVisible } from "./mock";
import type { Shipment, ShipmentFarmer, ShipmentStatus } from "./types";

// Mock shipments for VITE_API_MODE=mock. Live mode reads GET /coops/{id}/shipments
// and advances with PATCH /shipments/{id} { action: "advance" }.

export type { Shipment, ShipmentFarmer, ShipmentStatus };

export const SHIPMENT_STATUSES = ["draft", "preparing", "ready", "in_transit", "delivered", "completed"] as const satisfies readonly ShipmentStatus[];

export const shipmentStatusMeta: Record<ShipmentStatus, { label: string; tone: string; next?: string }> = {
  draft: { label: "Draft", tone: "neutral", next: "Start preparing" },
  preparing: { label: "Preparing", tone: "pending", next: "Mark ready" },
  ready: { label: "Ready", tone: "invited", next: "Mark shipped" },
  in_transit: { label: "In transit", tone: "sent", next: "Mark delivered" },
  delivered: { label: "Delivered", tone: "verified", next: "Close shipment" },
  completed: { label: "Completed", tone: "active" },
};

const day = 86_400_000;
const now = Date.now();
const d = (n: number) => new Date(now + n * day).toISOString();
const f = (pairs: Array<[number, number]>): ShipmentFarmer[] => pairs.map(([n, kilos]) => ({ account_id: `acc_farmer_${n}`, kilos }));

const shipments: Shipment[] = [
  { id: "shp_101", reference: "KHC-S-101", coop_id: "coop_kiambu", buyer_name: "Hansen Kaffee GmbH", product: "Washed AA green coffee", quantity_kg: 3000, destination: "Hamburg, DE", value: 12400, currency: "USD", ship_date: d(-12), shipped_at: d(-12), status: "completed", invoice_id: "inv_2411", farmers: f([[1, 420], [2, 360], [3, 330], [4, 300], [5, 300], [6, 270], [7, 270], [8, 270], [9, 240], [10, 240]]), updated_at: d(-4) },
  { id: "shp_102", reference: "KHC-S-102", coop_id: "coop_kiambu", buyer_name: "Nordic Roasters AB", product: "AB grade green coffee", quantity_kg: 2100, destination: "Malmö, SE", value: 8600, currency: "EUR", ship_date: d(-6), shipped_at: d(-6), status: "delivered", invoice_id: "inv_2412", farmers: f([[1, 300], [2, 280], [3, 260], [5, 240], [6, 220], [7, 210], [9, 300], [10, 290]]), updated_at: d(-1) },
  { id: "shp_103", reference: "KHC-S-103", coop_id: "coop_kiambu", buyer_name: "Bristol Coffee Works", product: "Peaberry green coffee", quantity_kg: 900, destination: "Bristol, UK", value: 5200, currency: "USD", ship_date: d(-2), shipped_at: d(-2), status: "in_transit", invoice_id: "inv_2413", farmers: f([[2, 200], [4, 250], [8, 220], [9, 230]]), updated_at: d(-2) },
  { id: "shp_104", reference: "KHC-S-104", coop_id: "coop_kiambu", buyer_name: "Amsterdam Bean Traders", product: "Washed AA green coffee", quantity_kg: 1500, destination: "Rotterdam, NL", value: 7100, currency: "EUR", ship_date: d(-8), shipped_at: d(-8), status: "delivered", invoice_id: "inv_2414", farmers: f([[1, 250], [3, 250], [4, 250], [5, 250], [6, 250], [7, 250]]), updated_at: d(-1) },
  { id: "shp_105", reference: "KHC-S-105", coop_id: "coop_kiambu", buyer_name: "Kyoto Specialty Imports", product: "AA Top micro-lot", quantity_kg: 600, destination: "Osaka, JP", value: 6900, currency: "USD", ship_date: d(1), shipped_at: null, status: "ready", invoice_id: null, farmers: f([[1, 200], [3, 200], [9, 200]]), updated_at: d(-1) },
  { id: "shp_106", reference: "KHC-S-106", coop_id: "coop_kiambu", buyer_name: "Hansen Kaffee GmbH", product: "Washed AB green coffee", quantity_kg: 2400, destination: "Hamburg, DE", value: 9800, currency: "USD", ship_date: d(9), shipped_at: null, status: "preparing", invoice_id: null, farmers: f([[2, 400], [4, 400], [5, 400], [6, 400], [7, 400], [10, 400]]), updated_at: d(-3) },
  { id: "shp_107", reference: "KHC-S-107", coop_id: "coop_kiambu", buyer_name: "Toronto Roast Collective", product: "Natural process lot", quantity_kg: 800, destination: "Toronto, CA", value: 4300, currency: "USD", ship_date: d(21), shipped_at: null, status: "draft", invoice_id: null, farmers: [], updated_at: d(-5) },
  { id: "shp_108", reference: "KHC-S-108", coop_id: "coop_kiambu", buyer_name: "Nordic Roasters AB", product: "AB grade green coffee", quantity_kg: 1800, destination: "Gothenburg, SE", value: 7400, currency: "EUR", ship_date: d(-3), shipped_at: null, status: "ready", invoice_id: null, farmers: f([[3, 300], [5, 300], [6, 300], [8, 300], [9, 300], [10, 300]]), updated_at: d(-4) },
];

for (const shipment of shipments) shipment.is_demo = true;

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export const shipmentsApi = {
  list: async (coopId: string): Promise<Shipment[]> => {
    await wait();
    return shipments
      .filter((s) => s.coop_id === coopId && (mockDemoVisible() || s.is_demo !== true))
      .map((s) => ({ ...s, farmers: [...s.farmers] }));
  },
  advance: async (id: string): Promise<Shipment> => {
    await wait();
    const s = shipments.find((x) => x.id === id);
    if (!s) throw new Error("not_found");
    const i = SHIPMENT_STATUSES.indexOf(s.status);
    if (i < SHIPMENT_STATUSES.length - 1) s.status = SHIPMENT_STATUSES[i + 1]!;
    if (s.status === "in_transit") s.shipped_at = new Date().toISOString();
    s.updated_at = new Date().toISOString();
    return { ...s };
  },
  remove: async (id: string): Promise<void> => {
    await wait();
    const i = shipments.findIndex((x) => x.id === id);
    if (i >= 0) shipments.splice(i, 1);
  },
  setFarmer: async (id: string, accountId: string, kilos: number): Promise<Shipment> => {
    await wait();
    const s = shipments.find((x) => x.id === id);
    if (!s) throw new Error("Shipment not found");
    const others = s.farmers.filter((f) => f.account_id !== accountId);
    const used = others.reduce((a, f) => a + f.kilos, 0);
    if (used + kilos > s.quantity_kg) throw new Error("Farmer kilos would exceed the shipment quantity");
    s.farmers = [...others, { account_id: accountId, kilos }];
    s.updated_at = new Date().toISOString();
    return { ...s, farmers: [...s.farmers] };
  },
  removeFarmer: async (id: string, accountId: string): Promise<Shipment> => {
    await wait();
    const s = shipments.find((x) => x.id === id);
    if (!s) throw new Error("Shipment not found");
    s.farmers = s.farmers.filter((f) => f.account_id !== accountId);
    s.updated_at = new Date().toISOString();
    return { ...s, farmers: [...s.farmers] };
  },
};
