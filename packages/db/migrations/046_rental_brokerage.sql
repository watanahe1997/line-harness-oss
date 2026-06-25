-- Rental brokerage MVP
-- Dedicated relational data is used instead of generic form_submissions so
-- request_id -> estimate_id (per room) -> application_id stays enforceable.

CREATE TABLE IF NOT EXISTS rental_quote_requests (
  id                    TEXT PRIMARY KEY,
  friend_id             TEXT NOT NULL REFERENCES friends(id),
  property_name         TEXT NOT NULL,
  property_url          TEXT,
  desired_move_in_date  TEXT NOT NULL,
  nickname              TEXT NOT NULL,
  has_pets              INTEGER NOT NULL CHECK (has_pets IN (0, 1)),
  needs_parking         INTEGER NOT NULL CHECK (needs_parking IN (0, 1)),
  has_motorbike         INTEGER NOT NULL CHECK (has_motorbike IN (0, 1)),
  needs_bicycle_parking INTEGER NOT NULL CHECK (needs_bicycle_parking IN (0, 1)),
  status                TEXT NOT NULL DEFAULT 'quote_pending' CHECK (status IN (
    'quote_pending', 'quote_in_progress', 'quote_presented', 'out_of_scope',
    'application_requested', 'application_submitted', 'individual_followup',
    'contracted', 'cancelled'
  )),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_rental_requests_friend ON rental_quote_requests(friend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rental_requests_status ON rental_quote_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS rental_estimates (
  id                       TEXT PRIMARY KEY,
  request_id               TEXT NOT NULL REFERENCES rental_quote_requests(id),
  room_number              TEXT NOT NULL,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  rent                     INTEGER,
  management_fee           INTEGER,
  deposit                  INTEGER,
  key_money                INTEGER,
  advance_rent             INTEGER,
  prorated_rent            INTEGER,
  fire_insurance           INTEGER,
  guarantee_company_fee    INTEGER,
  key_exchange_fee         INTEGER,
  cleaning_fee             INTEGER,
  other_initial_cost       INTEGER,
  brokerage_fee            INTEGER,
  brokerage_discount       INTEGER,
  cashback                 INTEGER,
  payment_total            INTEGER,
  manager_memo             TEXT,
  customer_notes           TEXT,
  floor_plan_key           TEXT,
  floor_plan_name          TEXT,
  floor_plan_mime          TEXT,
  floor_plan_size          INTEGER,
  status                   TEXT NOT NULL DEFAULT 'quote_pending' CHECK (status IN (
    'quote_pending', 'quote_in_progress', 'quote_presented', 'out_of_scope',
    'application_requested', 'application_submitted', 'individual_followup',
    'contracted', 'cancelled'
  )),
  sent_at                  TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  deleted_at               TEXT,
  UNIQUE(request_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_rental_estimates_request ON rental_estimates(request_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_rental_estimates_status ON rental_estimates(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS rental_applications (
  id                         TEXT PRIMARY KEY,
  request_id                 TEXT NOT NULL REFERENCES rental_quote_requests(id),
  estimate_id                TEXT NOT NULL REFERENCES rental_estimates(id),
  friend_id                  TEXT NOT NULL REFERENCES friends(id),
  status                     TEXT NOT NULL DEFAULT 'application_submitted' CHECK (status IN (
    'application_submitted', 'reviewing', 'additional_information',
    'preparing_submission', 'submitted_to_partner', 'screening',
    'approved', 'rejected', 'formal_estimate_presented',
    'contract_in_progress', 'contracted', 'cancelled'
  )),
  full_name                  TEXT,
  full_name_kana             TEXT,
  birth_date                 TEXT,
  gender                     TEXT,
  phone                      TEXT,
  email                      TEXT,
  current_postal_code        TEXT,
  current_address            TEXT,
  residence_type             TEXT,
  residence_years            INTEGER,
  employment_category        TEXT,
  employer_name              TEXT,
  employer_phone             TEXT,
  employer_address           TEXT,
  employment_type            TEXT,
  years_employed             INTEGER,
  annual_income              INTEGER,
  desired_move_in_date       TEXT,
  occupants_count            INTEGER,
  cohabitant_present         INTEGER CHECK (cohabitant_present IN (0, 1)),
  cohabitants_json           TEXT CHECK (cohabitants_json IS NULL OR json_valid(cohabitants_json)),
  emergency_name             TEXT,
  emergency_name_kana        TEXT,
  emergency_relationship     TEXT,
  emergency_phone            TEXT,
  emergency_address          TEXT,
  pet_info                   TEXT,
  vehicle_info               TEXT,
  motorbike_info             TEXT,
  bicycle_parking_info       TEXT,
  customer_note              TEXT,
  identity_file_key          TEXT,
  identity_file_name         TEXT,
  identity_file_mime         TEXT,
  identity_file_size         INTEGER,
  consent_privacy            INTEGER NOT NULL DEFAULT 0,
  consent_data_sharing       INTEGER NOT NULL DEFAULT 0,
  confirmed_accurate         INTEGER NOT NULL DEFAULT 0,
  consent_additional_info    INTEGER NOT NULL DEFAULT 0,
  consented_at               TEXT,
  manager_memo               TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  anonymized_at              TEXT,
  deleted_at                 TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_applications_active_estimate
  ON rental_applications(estimate_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rental_applications_friend ON rental_applications(friend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rental_applications_status ON rental_applications(status, created_at DESC);

CREATE TABLE IF NOT EXISTS rental_audit_logs (
  id          TEXT PRIMARY KEY,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('staff', 'line_user', 'system')),
  actor_id    TEXT,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  metadata    TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rental_audit_entity ON rental_audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rental_audit_created ON rental_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS rental_settings (
  id                       TEXT PRIMARY KEY CHECK (id = 'default'),
  privacy_policy_url       TEXT,
  identity_upload_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (identity_upload_enabled IN (0, 1)),
  data_retention_days      INTEGER NOT NULL DEFAULT 365 CHECK (data_retention_days BETWEEN 30 AND 3650),
  rich_menu_group_map      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rich_menu_group_map)),
  updated_at               TEXT NOT NULL
);

INSERT OR IGNORE INTO rental_settings (
  id, privacy_policy_url, identity_upload_enabled, data_retention_days,
  rich_menu_group_map, updated_at
) VALUES ('default', NULL, 0, 365, '{}', strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'));
