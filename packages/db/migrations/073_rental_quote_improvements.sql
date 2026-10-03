-- Additive rental upgrade. Existing presented amounts remain unchanged.
ALTER TABLE rental_quote_requests ADD COLUMN property_address TEXT;
ALTER TABLE rental_quote_requests ADD COLUMN condition_details TEXT;
ALTER TABLE rental_quote_requests ADD COLUMN submission_key TEXT;
ALTER TABLE rental_quote_requests ADD COLUMN submission_hash TEXT;
ALTER TABLE rental_quote_requests ADD COLUMN receipt_sent_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_submission ON rental_quote_requests(friend_id, submission_key);
ALTER TABLE rental_estimates ADD COLUMN monthly_other_cost INTEGER;
ALTER TABLE rental_estimates ADD COLUMN pricing_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rental_estimates ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rental_estimates ADD COLUMN published_snapshot TEXT;
ALTER TABLE rental_estimates ADD COLUMN published_floor_plan_key TEXT;
ALTER TABLE rental_estimates ADD COLUMN send_lock TEXT;
ALTER TABLE rental_estimates ADD COLUMN send_lock_at TEXT;
CREATE TABLE IF NOT EXISTS rental_estimate_versions (
  estimate_id TEXT NOT NULL REFERENCES rental_estimates(id),
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  floor_plan_key TEXT,
  published_at TEXT NOT NULL,
  PRIMARY KEY (estimate_id, revision)
);
CREATE TABLE IF NOT EXISTS rental_quote_deliveries (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES rental_quote_requests(id),
  revisions TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  sent_at TEXT,
  last_error TEXT,
  UNIQUE(request_id, revisions)
);
CREATE TABLE IF NOT EXISTS rental_customer_support (
  friend_id TEXT PRIMARY KEY REFERENCES friends(id),
  enabled_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rental_application_requests (
  estimate_id TEXT PRIMARY KEY REFERENCES rental_estimates(id),
  friend_id TEXT NOT NULL REFERENCES friends(id),
  snapshot TEXT NOT NULL,
  requested_at TEXT NOT NULL
);
-- Individual support remains available after the customer's first application.
INSERT OR IGNORE INTO rental_customer_support(friend_id, enabled_at)
 SELECT r.friend_id, MIN(e.updated_at) FROM rental_estimates e JOIN rental_quote_requests r ON r.id = e.request_id
 WHERE e.status IN ('application_requested','application_submitted','individual_followup','contracted') GROUP BY r.friend_id;
INSERT OR IGNORE INTO rental_customer_support(friend_id, enabled_at)
 SELECT friend_id, MIN(created_at) FROM rental_applications GROUP BY friend_id;
INSERT OR IGNORE INTO rental_customer_support(friend_id, enabled_at)
 SELECT friend_id, MIN(created_at) FROM messages_log WHERE source = 'rental_application_requested' GROUP BY friend_id;
-- Rental customers are not enrolled in the upstream engagement reward program.
UPDATE mileage_programs SET status = 'paused' WHERE id = 'default';
UPDATE mileage_rules SET is_active = 0 WHERE program_id = 'default';
UPDATE auto_replies SET is_active = 0 WHERE id = 'builtin-mileage-wallet-keyword';

-- Preserve every legacy quote exactly as it was presented. No amount recalculation.
UPDATE rental_estimates SET published_snapshot = json_object(
 'id', id,
 'requestId', request_id,
 'roomNumber', room_number,
 'sortOrder', sort_order,
 'rent', rent,
 'managementFee', management_fee,
 'deposit', deposit,
 'keyMoney', key_money,
 'advanceRent', advance_rent,
 'proratedRent', prorated_rent,
 'fireInsurance', fire_insurance,
 'guaranteeCompanyFee', guarantee_company_fee,
 'keyExchangeFee', key_exchange_fee,
 'cleaningFee', cleaning_fee,
 'otherInitialCost', other_initial_cost,
 'brokerageFee', brokerage_fee,
 'brokerageDiscount', brokerage_discount,
 'cashback', cashback,
 'paymentTotal', payment_total,
 'customerNotes', customer_notes,
 'floorPlanName', floor_plan_name,
 'floorPlanMime', floor_plan_mime,
 'sentAt', sent_at,
 'createdAt', created_at,
 'updatedAt', updated_at,
 'pricingVersion', pricing_version,
 'revision', revision,
 'hasFloorPlan', floor_plan_key IS NOT NULL
), published_floor_plan_key = floor_plan_key WHERE sent_at IS NOT NULL AND published_snapshot IS NULL;
INSERT OR IGNORE INTO rental_estimate_versions(estimate_id, revision, snapshot, floor_plan_key, published_at)
 SELECT id, revision, published_snapshot, floor_plan_key, sent_at FROM rental_estimates WHERE sent_at IS NOT NULL;
