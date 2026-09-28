-- Postgres schema mirroring packages/shared types. Money in integer KES cents.
CREATE TABLE accounts (
  id text PRIMARY KEY, full_name text NOT NULL, phone_number text UNIQUE NOT NULL, id_number text NOT NULL,
  coop_id text, channel_capability text NOT NULL DEFAULT 'webapp',
  pin_hash text, pin_failed_attempts int NOT NULL DEFAULT 0, pin_locked_until timestamptz,
  balance_kes_cents bigint NOT NULL DEFAULT 0, incoming_kes_cents bigint NOT NULL DEFAULT 0
);
CREATE TABLE payout_destinations (
  id text PRIMARY KEY, account_id text REFERENCES accounts(id), type text NOT NULL, details text NOT NULL,
  account_name text NOT NULL, is_verified boolean NOT NULL DEFAULT false
);
CREATE TABLE coops (id text PRIMARY KEY, name text NOT NULL, treasurer_account_id text REFERENCES accounts(id));
CREATE TABLE coop_members (
  coop_id text REFERENCES coops(id), account_id text REFERENCES accounts(id),
  contribution_share numeric(6,3) NOT NULL, kilos numeric, PRIMARY KEY (coop_id, account_id)
);
CREATE TABLE invoices (
  id text PRIMARY KEY, type text NOT NULL, account_id text, coop_id text,
  buyer_name text, buyer_email text, buyer_phone text, amount numeric NOT NULL, currency char(3) NOT NULL,
  description text, reference text, status text NOT NULL DEFAULT 'pending', split_approved boolean NOT NULL DEFAULT false,
  fx_rate numeric, fee_kes_cents bigint, kes_total_cents bigint, payaza_checkout_reference text,
  created_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz
);
CREATE TABLE transactions (  -- append-only
  id text PRIMARY KEY, invoice_id text REFERENCES invoices(id), type text NOT NULL, status text NOT NULL,
  amount numeric NOT NULL, currency char(3) NOT NULL, payaza_reference text UNIQUE, fx_rate numeric, fee_kes_cents bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payouts (
  id text PRIMARY KEY, invoice_id text, transaction_id text, account_id text REFERENCES accounts(id),
  kind text NOT NULL, amount_kes_cents bigint NOT NULL, destination_id text, status text NOT NULL,
  idempotency_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
