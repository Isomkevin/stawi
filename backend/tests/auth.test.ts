import request from "supertest";
import { createApp } from "../src/app";
import { store } from "../src/store";

describe("Phone OTP sessions", () => {
  const app = createApp();

  beforeEach(async () => {
    await store.reset();
    process.env.AUTH_REQUIRED = "true";
    process.env.PAYAZA_MODE = "mock";
    delete process.env.MASTER_LOGIN_CODE;
  });

  afterEach(() => {
    delete process.env.AUTH_REQUIRED;
    delete process.env.MASTER_LOGIN_CODE;
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
    expect(verified.body.roles).toEqual(["exporter"]);
    expect(verified.body.account_types).toEqual(["exporter"]);
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

  it("signs in any existing account with the master code and still accepts a texted code", async () => {
    process.env.MASTER_LOGIN_CODE = "123456";
    const id = await createFarmer();

    const master = await request(app)
      .post("/auth/verify")
      .send({ phone_number: "0700111222", code: "123456" });
    expect(master.status).toBe(200);
    expect(master.body.account_id).toBe(id);
    expect(master.body.role).toBe("exporter");

    const unknown = await request(app)
      .post("/auth/verify")
      .send({ phone_number: "+254799000111", code: "123456" });
    expect(unknown.status).toBe(404);

    const otp = await request(app).post("/auth/otp").send({ phone_number: "+254700111222" });
    const texted = await request(app)
      .post("/auth/verify")
      .send({ phone_number: "+254700111222", code: otp.body.dev_code });
    expect(texted.status).toBe(200);
    expect(texted.body.token).not.toBe(master.body.token);
  });

  it("returns the master login code when the text is not sent", async () => {
    const previousEnv = process.env.NODE_ENV;
    const previousKey = process.env.AT_API_KEY;
    process.env.NODE_ENV = "production";
    process.env.AT_API_KEY = "";
    process.env.MASTER_LOGIN_CODE = "654321";
    try {
      const id = await createFarmer();
      const otp = await request(app).post("/auth/otp").send({ phone_number: "+254700111222" });
      expect(otp.status).toBe(200);
      expect(otp.body).toEqual({ sent: false, master_code: "654321" });

      const verified = await request(app)
        .post("/auth/verify")
        .send({ phone_number: "+254700111222", code: "654321" });
      expect(verified.status).toBe(200);
      expect(verified.body.account_id).toBe(id);

      const unknown = await request(app).post("/auth/otp").send({ phone_number: "+254799000111" });
      expect(unknown.body).toEqual({ sent: true });
    } finally {
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
      if (previousKey === undefined) delete process.env.AT_API_KEY;
      else process.env.AT_API_KEY = previousKey;
    }
  });

  it("still reports a send failure when no master login code is set", async () => {
    const previousEnv = process.env.NODE_ENV;
    const previousKey = process.env.AT_API_KEY;
    process.env.NODE_ENV = "production";
    process.env.AT_API_KEY = "";
    try {
      await createFarmer();
      const otp = await request(app).post("/auth/otp").send({ phone_number: "+254700111222" });
      expect(otp.status).toBe(502);
      expect(otp.body.error).toMatch(/could not send/i);
    } finally {
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
      if (previousKey === undefined) delete process.env.AT_API_KEY;
      else process.env.AT_API_KEY = previousKey;
    }
  });

  it("accepts the master code in production when the env var is set", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.MASTER_LOGIN_CODE = "123456";
    try {
      const id = await createFarmer();
      const master = await request(app)
        .post("/auth/verify")
        .send({ phone_number: "+254700111222", code: "123456" });
      expect(master.status).toBe(200);
      expect(master.body.account_id).toBe(id);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("ignores 123456 when the master code is unset", async () => {
    await createFarmer();
    const denied = await request(app)
      .post("/auth/verify")
      .send({ phone_number: "+254700111222", code: "123456" });
    expect(denied.status).toBe(401);
  });

  it("lets signup check a payout name before a session exists", async () => {
    await createFarmer();

    const known = await request(app).post("/name-enquiry").send({ type: "mpesa", details: "+254700111222" });
    expect(known.status).toBe(200);
    expect(known.body.account_name).toBe("Amina Yusuf");

    const unknown = await request(app).post("/name-enquiry").send({ type: "mpesa", details: "+254799000111" });
    expect(unknown.status).toBe(200);
    expect(unknown.body.account_name).toBe("Pending name check");

    const created = await request(app).post("/accounts").send({
      full_name: "New Farmer",
      phone_number: "+254799000111",
      id_number: "ID902",
      pin: "1234",
      destination: {
        type: "mpesa",
        details: "+254799000111",
        account_name: "Pending name check",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.payout_destinations[0].account_name).toBe("New Farmer");
  });

  it("returns a session from signup so the home screen can load the account", async () => {
    const created = await request(app).post("/accounts").send({
      full_name: "New Farmer",
      phone_number: "+254799000222",
      id_number: "ID903",
      pin: "1234",
    });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created.body.pin_hash).toBeUndefined();

    const denied = await request(app).get(`/accounts/${created.body.id}`);
    expect(denied.status).toBe(401);

    const allowed = await request(app)
      .get(`/accounts/${created.body.id}/balance`)
      .set("Authorization", `Bearer ${created.body.token}`);
    expect(allowed.status).toBe(200);

    const setCookie = created.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).find((value) =>
      String(value).startsWith("stawi_session="),
    );
    const withPlaceholder = await request(app)
      .get(`/accounts/${created.body.id}`)
      .set("Authorization", "Bearer demo-token-farmer")
      .set("Cookie", String(cookie).split(";")[0]);
    expect(withPlaceholder.status).toBe(200);
    expect(withPlaceholder.body.id).toBe(created.body.id);
  });
});
