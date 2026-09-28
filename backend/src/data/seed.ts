import { db, uid, now } from "../store.js";
import { hashPin } from "../services/pin.js";
import type { Account } from "../types.js";

const farmers: [string, string, number][] = [
  ["Wanjiku Kamau", "+254711000001", 18], ["Joseph Mwangi", "+254711000002", 15],
  ["Grace Njeri", "+254711000003", 12], ["Peter Kariuki", "+254711000004", 11],
  ["Mary Wambui", "+254711000005", 10], ["Samuel Gathogo", "+254711000006", 9],
  ["Esther Nyambura", "+254711000007", 8], ["David Maina", "+254711000008", 7],
  ["Lucy Wangari", "+254711000009", 6], ["John Karanja", "+254711000010", 4],
]; // shares sum to 100

export function seed() {
  const mk = (name: string, phone: string, coop: string | null, ussd: boolean): Account => {
    const id = uid("acc");
    const a: Account = {
      id, full_name: name, phone_number: phone, id_number: "12345678",
      payout_destinations: [{ id: uid("dst"), type: "mpesa", details: phone, account_name: name.toUpperCase(), is_verified: true }],
      coop_id: coop, channel_capability: ussd ? "webapp+ussd" : "webapp",
      pin_hash: hashPin("1234"), pin_failed_attempts: 0, pin_locked_until: null,
      balance_kes_cents: 0, incoming_kes_cents: 0,
    };
    db.accounts.set(id, a); return a;
  };

  const treasurer = mk("Achieng Otieno (Treasurer)", "+254711000000", null, false);
  const coopId = uid("coop");
  db.coops.set(coopId, { id: coopId, name: "Kiambu Highlands Coffee Co-op", treasurer_account_id: treasurer.id });
  treasurer.coop_id = coopId;
  for (const [name, phone, share] of farmers) {
    const a = mk(name, phone, coopId, true);
    db.members.push({ coop_id: coopId, account_id: a.id, contribution_share: share });
  }
  const exporter = mk("Wanjiru Crafts", "+254722000001", null, true);

  console.log(`[seed] coop=${coopId} treasurer=${treasurer.id} exporter=${exporter.id} farmers=${farmers.length} (PIN 1234)`);
  return { coopId, treasurerId: treasurer.id, exporterId: exporter.id, createdAt: now() };
}
