import request from "supertest";
import { createApp } from "../src/app";
import { store } from "../src/store";

describe("Phone OTP sessions", () => {
  const app = createApp();

  beforeEach(async () => {
    await store.reset();
    process.env.AUTH_REQUIRED = "true";
    process.env.PAYAZA_MODE = "mock";
  });

  afterEach(() => {
    delete process.env.AUTH_REQUIRED;
    process.env.PAYAZA_MODE = "mock";
  });

  async function createFarmer() {
    const res = await request(app).post("/accounts").send({
      full_name: "Amina Yusuf",
      phone_number: "+254700111222",
      id_number: "ID900",
      pin: "1234",
      ussd: true,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("requires a session for account reads when auth is on", async () => {
    const id = await createFarmer();
    const denied = await request(app).get(`/accounts/${id}`);
    expect(denied.status).toBe(401);

    const otp = await request(app).post("/auth/otp").send({ phone_number: "0700111222" });
    expect(otp.status).toBe(200);
    expect(otp.body.dev_code).toMatch(/^\d{6}$/);

    const verified = await request(app)
      .post("/auth/verify")
      .send({ phone_number: "+254700111222", code: otp.body.dev_code });
    expect(verified.status).toBe(200);
    expect(verified.body.role).toBe("exporter");
    expect(verified.body.account.pin_hash).toBeUndefined();

    const allowed = await request(app)
      .get(`/accounts/${id}`)
      .set("Authorization", `Bearer ${verified.body.token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.id).toBe(id);
  });

  it("rejects a session used against someone else's account", async () => {
    const first = await createFarmer();
    const second = await request(app).post("/accounts").send({
      full_name: "Other Person",
      phone_number: "+254700333444",
      id_number: "ID901",
      pin: "1234",
    });
    const otp = await request(app).post("/auth/otp").send({ phone_number: "+254700111222" });
    const verified = await request(app)
      .post("/auth/verify")
      .send({ phone_number: "+254700111222", code: otp.body.dev_code });

    const denied = await request(app)
      .get(`/accounts/${second.body.id}`)
      .set("Authorization", `Bearer ${verified.body.token}`);
    expect(denied.status).toBe(403);
    expect(first).toBeTruthy();
  });
});
