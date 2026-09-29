import request from "supertest";
import { createApp } from "../src/app";
import { store } from "../src/store";

describe("Phone account-type mappings", () => {
  const app = createApp();

  beforeEach(async () => {
    await store.reset();
    process.env.AUTH_REQUIRED = "true";
    process.env.PAYAZA_MODE = "mock";
    process.env.ADMIN_SECRET = "test-admin";
    delete process.env.MASTER_LOGIN_CODE;
  });

  afterEach(() => {
    delete process.env.AUTH_REQUIRED;
    delete process.env.ADMIN_SECRET;
    process.env.PAYAZA_MODE = "mock";
  });

  async function adminCookie(): Promise<string> {
    const login = await request(app).post("/admin/phones/login").send({ secret: "test-admin" });
    expect(login.status).toBe(303);
    const raw = login.headers["set-cookie"];
    const header = (Array.isArray(raw) ? raw : [String(raw)]).find((value) => value.startsWith("stawi_admin="));
    return String(header).split(";")[0];
  }

  async function createAccount(phone = "+254700111222") {
    const res = await request(app).post("/accounts").send({
      full_name: "Amina Yusuf",
      phone_number: phone,
      id_number: "ID900",
      pin: "1234",
    });
    expect(res.status).toBe(201);
    expect(res.body.roles).toEqual(["exporter"]);
    expect(res.body.account_types).toEqual(["exporter"]);
    return res.body as { id: string; token: string };
  }

  it("keeps a single derived role for an account that has not been remapped", async () => {
    const account = await createAccount();
    const otp = await request(app).post("/auth/otp").send({ phone_number: "0700111222" });
    const verified = await request(app)
      .post("/auth/verify")
      .send({ phone_number: "+254700111222", code: otp.body.dev_code });
    expect(verified.status).toBe(200);
    expect(verified.body.role).toBe("exporter");
    expect(verified.body.roles).toEqual(["exporter"]);
    expect(verified.body.account_types).toEqual(["exporter"]);
    expect(account.id).toBeTruthy();
  });

  it("maps one phone to farmer, exporter, and co-op without dropping the others", async () => {
    const account = await createAccount();
    const cookie = await adminCookie();

    const farmer = await request(app)
      .post("/admin/phones/grant")
      .set("Cookie", cookie)
      .send({ phone_number: "0700111222", account_type: "farmer" });
    expect(farmer.status).toBe(200);
    expect(farmer.body.account_types).toEqual(["farmer", "exporter"]);
    expect(farmer.body.multiple).toBe(true);

    const coop = await request(app)
      .post("/coops")
      .set("Authorization", `Bearer ${account.token}`)
      .send({ name: "Highlands", treasurer_account_id: account.id });
    expect(coop.status).toBe(201);

    const asCoop = await request(app)
      .post("/admin/phones/grant")
      .set("Cookie", cookie)
      .send({ phone_number: "+254700111222", account_type: "coop" });
    expect(asCoop.status).toBe(200);
    expect(asCoop.body.account_types).toEqual(["farmer", "exporter", "coop"]);

    const duplicate = await request(app)
      .post("/admin/phones/grant")
      .set("Cookie", cookie)
      .send({ phone_number: "254700111222", account_type: "farmer" });
    expect(duplicate.status).toBe(409);

    const removed = await request(app)
      .post("/admin/phones/revoke")
      .set("Cookie", cookie)
      .send({ phone_number: "+254 700 111 222", account_type: "exporter" });
    expect(removed.status).toBe(200);
    expect(removed.body.account_types).toEqual(["farmer", "coop"]);

    const otp = await request(app).post("/auth/otp").send({ phone_number: "+254700111222" });
    const verified = await request(app)
      .post("/auth/verify")
      .send({ phone_number: "0700111222", code: otp.body.dev_code });
    expect(verified.body.account_types).toEqual(["farmer", "coop"]);
    expect(verified.body.roles).toEqual(["farmer", "treasurer"]);
    expect(verified.body.role).toBe("treasurer");
  });

  it("rejects an invalid phone, blocks a duplicate add, and lists a normalized number", async () => {
    const cookie = await adminCookie();
    const bad = await request(app)
      .post("/admin/phones")
      .set("Cookie", cookie)
      .send({ phone_number: "+14155552671" });
    expect(bad.status).toBe(400);

    const added = await request(app)
      .post("/admin/phones")
      .set("Cookie", cookie)
      .send({ phone_number: "0712000111" });
    expect(added.status).toBe(200);
    expect(added.body.phone_number).toBe("+254712000111");
    expect(added.body.account_types).toEqual([]);

    const again = await request(app)
      .post("/admin/phones")
      .set("Cookie", cookie)
      .send({ phone_number: "+254712000111" });
    expect(again.status).toBe(409);

    const page = await request(app).get("/admin/phones?q=0712000111").set("Cookie", cookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain("+254712000111");
    expect(page.text).toContain("None");
  });

  it("requires the admin secret", async () => {
    const hidden = await request(app).get("/admin/phones");
    expect(hidden.status).toBe(200);
    expect(hidden.text).toContain("Admin secret");
    expect(hidden.text).not.toContain("Add Farmer");

    const denied = await request(app)
      .post("/admin/phones/grant")
      .send({ phone_number: "+254700111222", account_type: "farmer" });
    expect(denied.status).toBe(401);

    delete process.env.ADMIN_SECRET;
    const missing = await request(app).get("/admin/phones");
    expect(missing.status).toBe(404);
  });
});
