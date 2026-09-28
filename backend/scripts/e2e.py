#!/usr/bin/env python3
"""End-to-end check against a running API in mock mode (SEED on). Usage:
  PORT=4100 AT_CALLBACK_SECRET=s3cret npm run dev:api      # terminal 1
  python3 scripts/e2e.py http://localhost:4100 s3cret        # terminal 2
Exits non-zero on any failed assertion."""
import json, sys, time, urllib.request as u, urllib.error
B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4000"
SECRET = sys.argv[2] if len(sys.argv) > 2 else ""
def call(m, p, body=None):
    r = u.Request(B + p, method=m, data=json.dumps(body).encode() if body is not None else None, headers={"content-type": "application/json"})
    try: return 200, json.loads(u.urlopen(r).read() or b"null")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"null")
def ok(c, msg):
    print(("PASS " if c else "FAIL ") + msg)
    if not c: sys.exit(1)
ok(call("GET", "/health")[1]["payaza"] == "mock", "running in mock mode")
ids = call("GET", "/dev/seed-ids")[1]
coop, tre, exp = ids["coopId"], ids["treasurerId"], ids["exporterId"]
_, inv = call("POST", "/invoices", {"type": "coop", "coop_id": coop, "buyer_name": "Hamburg Roasters", "buyer_email": "b@x.com", "amount": 12400, "currency": "USD", "description": "Lot 14"})
_, r = call("POST", f"/dev/simulate-payment/{inv['id']}"); ok(r["status"] == "settling", "co-op invoice awaits split approval after payment")
_, d = call("GET", f"/invoices/{inv['id']}"); sp = d["split_preview"]
ok(len(sp) == 10 and sum(l["net_kes_cents"] for l in sp) == r["kes_total_cents"], "split lines sum exactly to net")
ok(call("POST", f"/invoices/{inv['id']}/approve-split", {"treasurer_id": tre, "pin": "0000"})[0] == 403, "wrong treasurer PIN rejected")
ok(call("POST", f"/invoices/{inv['id']}/approve-split", {"treasurer_id": tre, "pin": "1234"})[1]["status"] == "completed", "split approved -> completed")
code, body = call("POST", f"/invoices/{inv['id']}/approve-split", {"treasurer_id": tre, "pin": "1234"})
ok(code == 400 and "error" in body, "double approve rejected with clean JSON error")
f = sp[0]["account_id"]; bal = call("GET", f"/accounts/{f}/balance")[1]["balance_kes_cents"]
ok(bal == sp[0]["net_kes_cents"], "farmer balance equals their split line")
_, di = call("POST", "/invoices", {"type": "direct", "account_id": exp, "buyer_name": "Berlin Crafts", "buyer_email": "b@x.com", "amount": 500, "currency": "EUR", "description": "Baskets"})
call("POST", f"/dev/simulate-payment/{di['id']}"); b1 = call("GET", f"/accounts/{exp}/balance")[1]["balance_kes_cents"]
call("POST", "/webhooks/payaza", {"invoice_id": di["id"], "reference": "retry-with-new-ref"}); time.sleep(0.3)
ok(call("GET", f"/accounts/{exp}/balance")[1]["balance_kes_cents"] == b1, "webhook retry does NOT double-credit")
dest = call("GET", f"/accounts/{f}")[1]["payout_destinations"][0]["id"]
ok(call("POST", f"/accounts/{f}/withdraw", {"destination_id": dest, "amount_kes_cents": 100000, "pin": "9999", "idempotency_key": "a"})[0] == 403, "withdraw wrong PIN rejected")
_, w1 = call("POST", f"/accounts/{f}/withdraw", {"destination_id": dest, "amount_kes_cents": 100000, "pin": "1234", "idempotency_key": "b"})
_, w2 = call("POST", f"/accounts/{f}/withdraw", {"destination_id": dest, "amount_kes_cents": 100000, "pin": "1234", "idempotency_key": "b"})
ok(w1["id"] == w2["id"] and call("GET", f"/accounts/{f}/balance")[1]["balance_kes_cents"] == bal - 100000, "withdraw idempotent, debited once")
ok(call("POST", f"/accounts/{f}/withdraw", {"destination_id": dest, "amount_kes_cents": 10**12, "pin": "1234", "idempotency_key": "c"})[0] == 400, "overdraw rejected")
def ussd(text, phone="+254711000001", s=SECRET):
    req = u.Request(B + f"/ussd/callback?s={s}", data=f"sessionId=S1&phoneNumber={phone}&text={text}".encode(), method="POST")
    try: return u.urlopen(req).read().decode()
    except urllib.error.HTTPError as e: return f"HTTP {e.code}"
ok(ussd("").startswith("CON Welcome"), "USSD root menu")
ok(ussd("1").startswith("END") and "KES" in ussd("1"), "USSD balance")
ok(ussd("3*1*500*0000").startswith("END Wrong PIN"), "USSD wrong PIN")
ok("initiated" in ussd("3*1*500*1234"), "USSD withdraw with PIN")
if SECRET: ok(ussd("", s="nope") == "HTTP 401", "USSD rejects bad callback secret")
ok("not registered" in ussd("", "+254799999999"), "USSD unknown phone")
print("ALL PASSED")
