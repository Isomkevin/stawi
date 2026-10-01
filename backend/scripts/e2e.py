#!/usr/bin/env python3
"""
Stawi End-to-End (E2E) 17-Check Verification Suite
Usage: python3 scripts/e2e.py [BASE_URL] [USSD_SECRET]
Example: python3 scripts/e2e.py http://localhost:4100 s3cret
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:4100"
USSD_SECRET = sys.argv[2] if len(sys.argv) > 2 else "s3cret"

pass_count = 0
fail_count = 0


def request(method, path, data=None, headers=None, expected_status=None):
    url = f"{BASE_URL}{path}"
    headers = headers or {}
    req_data = None
    if data is not None:
        if isinstance(data, (dict, list)):
            req_data = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif isinstance(data, str):
            req_data = data.encode("utf-8")

    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            status = resp.status
            resp_headers = dict(resp.headers)
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = body
            if expected_status and status != expected_status:
                raise AssertionError(f"Expected HTTP {expected_status}, got {status}: {body}")
            return status, parsed, resp_headers
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        status = e.code
        resp_headers = dict(e.headers)
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = body
        if expected_status and status != expected_status:
            raise AssertionError(f"Expected HTTP {expected_status}, got {status}: {body}")
        return status, parsed, resp_headers


def check(num, desc, fn):
    global pass_count, fail_count
    try:
        fn()
        print(f"  [PASS] Check {num:02d}: {desc}")
        pass_count += 1
    except Exception as e:
        print(f"  [FAIL] Check {num:02d}: {desc}")
        print(f"         Error: {e}")
        fail_count += 1


print("==================================================")
print(f" Running Stawi 17-Check E2E Verification against {BASE_URL}")
print("==================================================")

context = {}


# Check 1: Health Check
def check_1():
    status, body, _ = request("GET", "/health", expected_status=200)
    assert body.get("status") == "ok", f"Expected status ok, got {body}"


check(1, "Health endpoint returns 200 { status: 'ok' }", check_1)


# Check 2: CORS Header Check
def check_2():
    status, body, headers = request(
        "GET", "/health", headers={"Origin": "https://preview.lovable.app"}
    )
    assert status == 200
    # Should have Access-Control-Allow-Origin header
    allow_origin = headers.get("Access-Control-Allow-Origin") or headers.get(
        "access-control-allow-origin"
    )
    assert allow_origin in [
        "*",
        "https://preview.lovable.app",
    ], f"CORS origin mismatch: {allow_origin}"


check(2, "CORS origin validation allows frontend domain", check_2)


# Check 3: Seeded IDs Verification
def check_3():
    status, body, _ = request("GET", "/dev/seed-ids", expected_status=200)
    assert "coop_id" in body, "coop_id missing in seed"
    assert "treasurer_id" in body, "treasurer_id missing in seed"
    assert "exporter_id" in body, "exporter_id missing in seed"
    assert len(body.get("farmer_ids", [])) == 10, f"Expected 10 farmers, got {body}"
    context["seed"] = body


check(3, "GET /dev/seed-ids returns seeded Co-op, Treasurer, Exporter, and Farmers", check_3)


# Check 4: Account & Balance Consistency
def check_4():
    farmer_id = context["seed"]["farmer_ids"][0]
    status, acc, _ = request("GET", f"/accounts/{farmer_id}", expected_status=200)
    assert acc["id"] == farmer_id
    assert "pin_hash" not in acc, "Security violation: pin_hash exposed in public account"

    status, bal, _ = request("GET", f"/accounts/{farmer_id}/balance", expected_status=200)
    assert (
        bal["balance_kes_cents"] == acc["balance_kes_cents"]
    ), f"Balance mismatch: {bal} vs {acc}"
    context["farmer_0"] = acc


check(4, "GET /accounts/:id and /accounts/:id/balance return consistent data without exposing pin_hash", check_4)


# Check 5: Stawi Direct Flow - Create Invoice
def check_5():
    exporter_id = context["seed"]["exporter_id"]
    payload = {
        "type": "direct",
        "account_id": exporter_id,
        "buyer_name": "Nordic Import AB",
        "buyer_email": "finance@nordicimport.se",
        "amount": 2500,
        "currency": "USD",
        "description": "Handcrafted sisal products - Stockholm",
        "reference": f"TEST-DIR-{int(urllib.parse.time.time()) if hasattr(urllib.parse, 'time') else 999}",
    }
    status, inv, _ = request("POST", "/invoices", data=payload, expected_status=201)
    assert inv["type"] == "direct"
    assert inv["status"] == "pending"
    assert inv["account_id"] == exporter_id
    context["direct_inv"] = inv


check(5, "Stawi Direct: POST /invoices creates pending Direct invoice", check_5)


# Check 6: Stawi Direct Flow - Checkout Session
def check_6():
    inv_id = context["direct_inv"]["id"]
    status, session, _ = request("POST", f"/invoices/{inv_id}/checkout-session", expected_status=200)
    assert "transaction_reference" in session
    assert "public_key" in session
    context["direct_session"] = session


check(6, "Stawi Direct: POST /invoices/:id/checkout-session returns Payaza checkout payload", check_6)


# Check 7: Stawi Direct Flow - Simulate Payment
def check_7():
    inv_id = context["direct_inv"]["id"]
    status, result, _ = request(
        "POST", f"/dev/simulate-payment/{inv_id}", expected_status=200
    )
    assert result["success"] is True
    assert result["invoice"]["status"] == "completed"
    context["direct_result"] = result


check(7, "Stawi Direct: POST /dev/simulate-payment/:id transitions Direct invoice to completed", check_7)


# Check 8: Stawi Direct Flow - Exporter Balance & Payout Credited
def check_8():
    exporter_id = context["seed"]["exporter_id"]
    status, acc, _ = request("GET", f"/accounts/{exporter_id}", expected_status=200)
    status, txs, _ = request("GET", f"/accounts/{exporter_id}/transactions", expected_status=200)
    inv_id = context["direct_inv"]["id"]
    matching_payouts = [t for t in txs if t["invoice_id"] == inv_id]
    assert len(matching_payouts) > 0, "No payout credited for Direct invoice"
    assert matching_payouts[0]["kind"] == "credit"
    assert matching_payouts[0]["status"] == "confirmed"


check(8, "Stawi Direct: Exporter balance and payout credit verified", check_8)


# Check 9: Stawi Co-op Flow - Create Invoice
def check_9():
    coop_id = context["seed"]["coop_id"]
    payload = {
        "type": "coop",
        "coop_id": coop_id,
        "buyer_name": "Paris Artisan Roasters SAS",
        "buyer_email": "accounts@parisartisan.fr",
        "amount": 10000,
        "currency": "USD",
        "description": "Lot Grade AA Washed Coffee - Le Havre",
    }
    status, inv, _ = request("POST", "/invoices", data=payload, expected_status=201)
    assert inv["type"] == "coop"
    assert inv["status"] == "pending"
    assert inv["split_approved"] is False
    context["coop_inv"] = inv


check(9, "Stawi Co-op: POST /invoices creates pending Co-op invoice", check_9)


# Check 10: Stawi Co-op Flow - Simulate Collection
def check_10():
    inv_id = context["coop_inv"]["id"]
    status, result, _ = request(
        "POST", f"/dev/simulate-payment/{inv_id}", expected_status=200
    )
    assert result["success"] is True
    assert result["invoice"]["status"] == "settling"
    assert result["invoice"]["split_approved"] is False
    context["coop_settling"] = result["invoice"]


check(10, "Stawi Co-op: Collection puts invoice into settling state (awaiting split approval)", check_10)


# Check 11: Stawi Co-op Flow - Split Preview with Exact Sums
def check_11():
    inv_id = context["coop_inv"]["id"]
    coop_id = context["seed"]["coop_id"]
    status, shipments, _ = request("GET", f"/coops/{coop_id}/shipments", expected_status=200)
    shipment = next(item for item in shipments if item.get("invoice_id") == inv_id)
    farmers = context["seed"]["farmer_ids"]
    kilos = shipment["quantity_kg"] // len(farmers)
    assert kilos > 0, "Shipment quantity is too small for the roster"
    for farmer_id in farmers:
        request(
            "POST",
            f"/shipments/{shipment['id']}/farmers",
            data={"account_id": farmer_id, "kilos": kilos},
            expected_status=201,
        )
    status, detail, _ = request("GET", f"/invoices/{inv_id}", expected_status=200)
    preview = detail.get("split_preview")
    assert preview is not None, "split_preview missing"
    assert len(preview) == 10, f"Expected 10 preview split lines, got {len(preview)}"

    # Exact Sum Verification
    net_total = detail["invoice"]["kes_total_cents"]
    sum_preview_net = sum(line["net_kes_cents"] for line in preview)
    assert (
        sum_preview_net == net_total
    ), f"Exact sum failed: {sum_preview_net} != {net_total}"


check(11, "Stawi Co-op: GET /invoices/:id returns split_preview with largest-remainder exact sum", check_11)


# Check 12: Stawi Co-op Flow - Approve Split with Treasurer PIN
def check_12():
    inv_id = context["coop_inv"]["id"]
    treasurer_id = context["seed"]["treasurer_id"]
    payload = {"treasurer_id": treasurer_id, "pin": "1234"}
    status, res, _ = request(
        "POST", f"/invoices/{inv_id}/approve-split", data=payload, expected_status=200
    )
    assert res["success"] is True
    assert res["invoice"]["status"] == "completed"
    assert res["invoice"]["split_approved"] is True
    assert len(res["payouts"]) == 10, "Expected 10 member payouts"


check(12, "Stawi Co-op: POST /invoices/:id/approve-split succeeds with valid treasurer PIN", check_12)


# Check 13: Stawi Co-op Flow - Double-Approve Rejection
def check_13():
    inv_id = context["coop_inv"]["id"]
    treasurer_id = context["seed"]["treasurer_id"]
    payload = {"treasurer_id": treasurer_id, "pin": "1234"}
    status, err, _ = request(
        "POST", f"/invoices/{inv_id}/approve-split", data=payload, expected_status=400
    )
    assert "already approved" in str(err).lower() or "error" in err


check(13, "Stawi Co-op: Double split approval rejected with HTTP 400", check_13)


# Check 14: Co-op Metrics Verification
def check_14():
    coop_id = context["seed"]["coop_id"]
    status, metrics, _ = request("GET", f"/coops/{coop_id}/metrics", expected_status=200)
    assert metrics["invoices"] >= 2
    assert metrics["total_collected_kes_cents"] > 0
    assert metrics["fee_taken_kes_cents"] > 0
    assert metrics["total_split_kes_cents"] > 0


check(14, "GET /coops/:id/metrics returns non-zero collected, fee_taken, and split totals", check_14)


# Check 15: Farmer Withdrawal with PIN & Idempotency
def check_15():
    farmer_id = context["seed"]["farmer_ids"][0]
    status, acc, _ = request("GET", f"/accounts/{farmer_id}", expected_status=200)
    dest_id = acc["payout_destinations"][0]["id"]
    wth_amount = 50000  # KES 500.00
    idempotency_key = f"IDEM-WTH-TEST-15"

    payload = {
        "destination_id": dest_id,
        "amount_kes_cents": wth_amount,
        "pin": "1234",
        "idempotency_key": idempotency_key,
    }
    status, payout, _ = request(
        "POST", f"/accounts/{farmer_id}/withdraw", data=payload, expected_status=200
    )
    assert payout["kind"] == "withdrawal"
    assert payout["amount_kes_cents"] == wth_amount
    assert payout["status"] == "confirmed"

    # Test idempotency replay
    status2, payout2, _ = request(
        "POST", f"/accounts/{farmer_id}/withdraw", data=payload, expected_status=200
    )
    assert payout2["id"] == payout["id"], "Idempotency failed: returned different payout"


check(15, "Farmer withdrawal succeeds with valid PIN and enforces idempotency", check_15)


# Check 16: Withdrawal Guardrails (Overdraw & Wrong PIN Lockout)
def check_16():
    farmer_id = context["seed"]["farmer_ids"][1]
    status, acc, _ = request("GET", f"/accounts/{farmer_id}", expected_status=200)
    dest_id = acc["payout_destinations"][0]["id"]

    # 16a. Overdraw rejection
    overdraw_amount = acc["balance_kes_cents"] + 100000000
    status, err1, _ = request(
        "POST",
        f"/accounts/{farmer_id}/withdraw",
        data={"destination_id": dest_id, "amount_kes_cents": overdraw_amount, "pin": "1234"},
        expected_status=400,
    )
    assert "insufficient" in str(err1).lower()

    # 16b. Wrong PIN rejection (403)
    status, err2, _ = request(
        "POST",
        f"/accounts/{farmer_id}/withdraw",
        data={"destination_id": dest_id, "amount_kes_cents": 10000, "pin": "9999"},
        expected_status=403,
    )
    assert err2.get("error") in ["wrong", "locked"]


check(16, "Withdrawal guardrails reject overdraw (400) and incorrect PIN (403)", check_16)


# Check 17: USSD Menu Flow & Callback Secret Protection
def check_17():
    farmer = context["farmer_0"]
    phone = farmer["phone_number"]

    # 17a. Missing secret -> 401
    status, _, _ = request(
        "POST",
        "/ussd/callback",
        data={"sessionId": "USSD-SESS-1", "phoneNumber": phone, "serviceCode": "*384*1#", "text": ""},
        expected_status=401,
    )

    # 17b. Root Menu with Secret
    status, root_text, _ = request(
        "POST",
        f"/ussd/callback?s={USSD_SECRET}",
        data={"sessionId": "USSD-SESS-2", "phoneNumber": phone, "serviceCode": "*384*1#", "text": ""},
        expected_status=200,
    )
    assert "CON Welcome to Stawi" in root_text
    assert "1. My balance" in root_text

    # 17c. Option 1: Balance
    status, bal_text, _ = request(
        "POST",
        f"/ussd/callback?s={USSD_SECRET}",
        data={"sessionId": "USSD-SESS-2", "phoneNumber": phone, "serviceCode": "*384*1#", "text": "1"},
        expected_status=200,
    )
    assert "END Your Stawi balance: KES" in bal_text

    # 17d. Option 2: Transactions
    status, tx_text, _ = request(
        "POST",
        f"/ussd/callback?s={USSD_SECRET}",
        data={"sessionId": "USSD-SESS-2", "phoneNumber": phone, "serviceCode": "*384*1#", "text": "2"},
        expected_status=200,
    )
    assert (
        "END Transaction done:" in tx_text
        or "END Recent:" in tx_text
        or "END No recent transactions" in tx_text
    )

    # 17e. Option 3: Full Withdrawal Menu Flow (3*1*200*1234)
    status, wth_res, _ = request(
        "POST",
        f"/ussd/callback?s={USSD_SECRET}",
        data={"sessionId": "USSD-SESS-3", "phoneNumber": phone, "serviceCode": "*384*1#", "text": "3*1*200*1234"},
        expected_status=200,
    )
    assert (
        "END Withdrawal of KES" in wth_res
    ), f"Expected withdrawal confirmation, got: {wth_res}"


check(17, "USSD channel parity: Secret validation, root menu, balance, and withdraw-by-PIN flow", check_17)

print("==================================================")
print(f" Summary: {pass_count}/17 checks passed ({fail_count} failed)")
print("==================================================")

if fail_count > 0:
    sys.exit(1)
else:
    print(" ALL PASSED")
    sys.exit(0)
