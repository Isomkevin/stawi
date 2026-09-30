import request from "supertest";
import { createApp } from "../src/app";
import { resetRosterImportCache } from "../src/services/rosterImport";
import { store } from "../src/store";
import { Account } from "../src/types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc_amina",
    full_name: "Amina Wanjiku",
    phone_number: "+254711222333",
    id_number: "ID9",
    payout_destinations: [],
    coop_id: null,
    channel_capability: "webapp",
    balance_kes_cents: 0,
    incoming_kes_cents: 0,
    ...overrides,
  };
}

describe("Roster import and invite SMS", () => {
  const app = createApp();

  beforeEach(async () => {
    await store.reset();
    resetRosterImportCache();
    delete process.env.AUTH_REQUIRED;
    delete process.env.AT_API_KEY;
    await store.saveCoop({ id: "coop_test", name: "Kiambu Highlands Coffee Co-op", treasurer_account_id: "acc_treasurer" });
    await store.saveCoop({ id: "coop_other", name: "Other Co-op", treasurer_account_id: "acc_treasurer" });
  });

  it("reads Swahili headers, semicolon files, and keeps 0.125", async () => {
    const csv = "jina;simu;hisa;kilo\nAmina Wanjiku;0711222333;0,125;40";
    const res = await request(app).post("/coops/coop_test/members/import/preview").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.needs_mapping).toBe(false);
    expect(res.body.delimiter).toBe(";");
    expect(res.body.rows[0]).toMatchObject({ name: "Amina Wanjiku", phone: "+254711222333", share: 0.125, kilos: 40, status: "invite" });
  });

  it("asks for a column map when headers are unknown, then accepts the map", async () => {
    const csv = "code,msisdn,allocation\nAmina Wanjiku,0711222333,12";
    const first = await request(app).post("/coops/coop_test/members/import/preview").send({ csv });
    expect(first.status).toBe(200);
    expect(first.body.needs_mapping).toBe(true);
    expect(first.body.headers).toEqual(["code", "msisdn", "allocation"]);

    const mapped = await request(app)
      .post("/coops/coop_test/members/import/preview")
      .send({ csv, columns: { name: 0, phone: 1, share: 2 } });
    expect(mapped.status).toBe(200);
    expect(mapped.body.needs_mapping).toBe(false);
    expect(mapped.body.rows[0].share).toBe(12);
    expect(mapped.body.rows[0].status).toBe("invite");
  });

  it("flags duplicate phones, scientific notation, and quoted names", async () => {
    const csv = 'name,phone,share\n"Bett, Mary",0711222333,10\nAmina,7.17E+8,5\nSecond,0711222333,4\n"Line\nBreak",0711333444,1';
    const res = await request(app).post("/coops/coop_test/members/import/preview").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.rows[0]).toMatchObject({ name: "Bett, Mary", status: "invite" });
    expect(res.body.rows[1].error).toMatch(/Excel/);
    expect(res.body.rows[2].error).toMatch(/Duplicate/);
    expect(res.body.rows[3].name).toBe("Line\nBreak");
  });

  it("decodes UTF-16 and Windows-1252", async () => {
    const utf16 = Buffer.alloc(2 + "name,phone,share\nAmina,0711222333,10".length * 2);
    utf16.writeUInt16LE(0xfeff, 0);
    const text = "name,phone,share\nAmina,0711222333,10";
    for (let i = 0; i < text.length; i++) utf16.writeUInt16LE(text.charCodeAt(i), 2 + i * 2);
    const wide = await request(app)
      .post("/coops/coop_test/members/import/preview")
      .send({ csv_base64: utf16.toString("base64") });
    expect(wide.status).toBe(200);
    expect(wide.body.rows[0].name).toBe("Amina");

    const latin = Buffer.from("name,phone,share\nJos\xe9,0711222333,10", "latin1");
    const decoded = await request(app)
      .post("/coops/coop_test/members/import/preview")
      .send({ csv_base64: latin.toString("base64") });
    expect(decoded.status).toBe(200);
    expect(decoded.body.rows[0].name).toBe("José");
  });

  it("refuses another co-op and does not move the account", async () => {
    await store.saveAccount(account({ coop_id: "coop_other" }));
    await store.addCoopMember({ coop_id: "coop_other", account_id: "acc_amina", contribution_share: 10, full_name: "Amina Wanjiku" });
    const preview = await request(app)
      .post("/coops/coop_test/members/import/preview")
      .send({ csv: "name,phone,share\nAmina Wanjiku,0711222333,20" });
    expect(preview.body.rows[0].status).toBe("other_coop");

    const applied = await request(app)
      .post("/coops/coop_test/members/import")
      .set("Idempotency-Key", "once")
      .send({
        origin: "https://stawi.test",
        rows: [{ name: "Amina Wanjiku", phone: "0711222333", share: 20 }],
      });
    expect(applied.status).toBe(200);
    expect(applied.body.failed[0].reason).toMatch(/another co-op/);
    expect((await store.getAccount("acc_amina"))?.coop_id).toBe("coop_other");

    const stolen = await request(app).post("/coops/coop_test/members").send({ account_id: "acc_amina", contribution_share: 20 });
    expect(stolen.status).toBe(409);
  });

  it("updates kilos on re-import and accepts a roster total over 100", async () => {
    await store.saveAccount(account());
    await store.addCoopMember({ coop_id: "coop_test", account_id: "acc_amina", contribution_share: 10, kilos: 10, full_name: "Amina Wanjiku" });
    await store.saveAccount(account({ id: "acc_juma", full_name: "Juma Otieno", phone_number: "+254711222444", coop_id: "coop_test" }));
    await store.addCoopMember({ coop_id: "coop_test", account_id: "acc_juma", contribution_share: 60, full_name: "Juma Otieno" });

    const applied = await request(app)
      .post("/coops/coop_test/members/import")
      .set("Idempotency-Key", "kilos")
      .send({
        origin: "https://stawi.test",
        rows: [
          { name: "Amina Wanjiku", phone: "0711222333", share: 80, kilos: 50 },
          { name: "Juma Otieno", phone: "0711222444", share: 60, kilos: 20 },
        ],
      });
    expect(applied.status).toBe(200);
    expect(applied.body.updated).toEqual(["Amina Wanjiku", "Juma Otieno"]);
    const members = await store.getCoopMembers("coop_test");
    const amina = members.find((member) => member.account_id === "acc_amina");
    expect(amina?.contribution_share).toBe(80);
    expect(amina?.kilos).toBe(50);
    expect(members.reduce((sum, member) => sum + member.contribution_share, 0)).toBe(140);

    const again = await request(app)
      .post("/coops/coop_test/members/import")
      .set("Idempotency-Key", "kilos")
      .send({ origin: "https://stawi.test", rows: [{ name: "Nope", phone: "0711000000", share: 1 }] });
    expect(again.body).toEqual(applied.body);
    expect(await store.getAccountByPhone("+254711000000")).toBeUndefined();
  });

  it("builds invite links with the co-op name", async () => {
    const applied = await request(app)
      .post("/coops/coop_test/members/import")
      .send({
        origin: "https://stawi.test",
        rows: [{ name: "New Farmer", phone: "0711555666", share: 5, kilos: 12 }],
      });
    expect(applied.status).toBe(200);
    expect(applied.body.invites).toHaveLength(1);
    const url = new URL(applied.body.invites[0].url);
    expect(url.origin).toBe("https://stawi.test");
    expect(url.pathname).toBe("/onboarding");
    expect(url.searchParams.get("coop")).toBe("Kiambu Highlands Coffee Co-op");
    expect(url.searchParams.get("phone")).toBe("+254711555666");
  });

  it("rejects a file over 5000 farmers", async () => {
    const lines = ["name,phone,share"];
    for (let i = 0; i < 5001; i++) lines.push(`Farmer ${i},0711${String(i).padStart(6, "0")},1`);
    const res = await request(app).post("/coops/coop_test/members/import/preview").send({ csv: lines.join("\n") });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5000/);
  });

  it("texts more than 500 invites and sends one operator summary", async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const recipients = Array.from({ length: 501 }, (_, i) => ({
      phone_number: `+2547${String(i).padStart(8, "0")}`,
      full_name: `Farmer ${i}`,
      link: `https://stawi.test/onboarding?phone=${i}`,
    }));
    const res = await request(app).post("/coops/coop_test/invites/sms").send({ recipients });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(501);
    expect(res.body.sent).toBe(501);
    expect(res.body.failed).toBe(0);
    const sms = logs.filter((line) => line.includes("[SMS"));
    expect(sms).toHaveLength(502);
    expect(sms.filter((line) => line.includes("texted 501 invite")).length).toBe(1);
    spy.mockRestore();
  }, 20000);
});
