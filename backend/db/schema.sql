-- Stawi Database Schema (PostgreSQL)
-- Single source of truth for accounts, co-ops, invoices, transactions, and payouts.

CREATE TABLE IF NOT EXISTS coops (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  treasurer_account_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(64) PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(32) NOT NULL UNIQUE,
  phone_normalized VARCHAR(32),
  id_number VARCHAR(64) NOT NULL,
  coop_id VARCHAR(64) REFERENCES coops(id) ON DELETE SET NULL,
  channel_capability VARCHAR(32) NOT NULL DEFAULT 'webapp',
  balance_kes_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_kes_cents >= 0),
  incoming_kes_cents BIGINT NOT NULL DEFAULT 0 CHECK (incoming_kes_cents >= 0),
  pin_hash VARCHAR(255),
  pin_failed_attempts INT NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payout_destinations (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL CHECK (type IN ('mpesa', 'bank')),
  details VARCHAR(255) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  bank_code VARCHAR(32),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coop_members (
  coop_id VARCHAR(64) NOT NULL REFERENCES coops(id) ON DELETE CASCADE,
  account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contribution_share NUMERIC(5, 2) NOT NULL CHECK (contribution_share >= 0 AND contribution_share <= 100),
  kilos NUMERIC(10, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (coop_id, account_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(32) NOT NULL CHECK (type IN ('direct', 'coop')),
  account_id VARCHAR(64) REFERENCES accounts(id) ON DELETE SET NULL,
  coop_id VARCHAR(64) REFERENCES coops(id) ON DELETE SET NULL,
  buyer_name VARCHAR(255) NOT NULL,
  buyer_email VARCHAR(255) NOT NULL,
  buyer_phone VARCHAR(32),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(8) NOT NULL,
  description TEXT,
  reference VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'converting', 'settling', 'completed', 'failed')),
  split_approved BOOLEAN NOT NULL DEFAULT FALSE,
  fx_rate NUMERIC(10, 4),
  fee_kes_cents BIGINT,
  kes_total_cents BIGINT,
  payaza_checkout_reference VARCHAR(128),
  payaza_link_id VARCHAR(128),
  due_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(64) PRIMARY KEY,
  invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL CHECK (type IN ('collection', 'conversion', 'settlement', 'payout')),
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  amount NUMERIC(14, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  payaza_reference VARCHAR(128),
  fx_rate NUMERIC(10, 4),
  fee_kes_cents BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payouts (
  id VARCHAR(64) PRIMARY KEY,
  invoice_id VARCHAR(64) NOT NULL,
  transaction_id VARCHAR(64),
  account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('credit', 'withdrawal')),
  amount_kes_cents BIGINT NOT NULL CHECK (amount_kes_cents > 0),
  destination_id VARCHAR(64) REFERENCES payout_destinations(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'sent', 'confirmed', 'failed')),
  idempotency_key VARCHAR(128) UNIQUE,
  payaza_reference VARCHAR(128),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash VARCHAR(128) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone_number VARCHAR(32) PRIMARY KEY,
  code_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_events (
  reference VARCHAR(128) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shipments (
  id VARCHAR(64) PRIMARY KEY,
  reference VARCHAR(64) NOT NULL UNIQUE,
  coop_id VARCHAR(64) NOT NULL REFERENCES coops(id) ON DELETE CASCADE,
  buyer_name VARCHAR(255) NOT NULL,
  product VARCHAR(255) NOT NULL,
  quantity_kg INTEGER NOT NULL CHECK (quantity_kg >= 0),
  destination VARCHAR(255) NOT NULL,
  value NUMERIC(14, 2) NOT NULL CHECK (value >= 0),
  currency VARCHAR(8) NOT NULL,
  ship_date TIMESTAMP WITH TIME ZONE NOT NULL,
  shipped_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(32) NOT NULL CHECK (status IN ('draft', 'preparing', 'ready', 'in_transit', 'delivered', 'completed')),
  invoice_id VARCHAR(64) REFERENCES invoices(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shipment_farmers (
  shipment_id VARCHAR(64) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kilos INTEGER NOT NULL CHECK (kilos > 0),
  PRIMARY KEY (shipment_id, account_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone_number);
CREATE INDEX IF NOT EXISTS idx_invoices_coop ON invoices(coop_id);
CREATE INDEX IF NOT EXISTS idx_invoices_account ON invoices(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_invoice ON transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payouts_account ON payouts(account_id);
CREATE INDEX IF NOT EXISTS idx_payouts_idempotency ON payouts(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payouts_payaza_ref ON payouts(payaza_reference);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_shipments_coop ON shipments(coop_id);
CREATE INDEX IF NOT EXISTS idx_shipment_farmers_account ON shipment_farmers(account_id);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS phone_normalized VARCHAR(32);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_phone_norm ON accounts(phone_normalized);
