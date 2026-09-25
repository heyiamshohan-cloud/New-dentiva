/** Initial Dentiva Pro schema. All money columns are INTEGER paisa. */
export const MIGRATION_001_INITIAL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE clinic (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  legal_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  registration_no TEXT NOT NULL DEFAULT '',
  professional_info TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  currency_code TEXT NOT NULL DEFAULT 'BDT',
  currency_symbol TEXT NOT NULL DEFAULT '৳',
  date_format TEXT NOT NULL DEFAULT 'DD MMM YYYY',
  document_header_note TEXT NOT NULL DEFAULT '',
  document_footer_note TEXT NOT NULL DEFAULT '',
  logo_path TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('administrator','dentist','assistant','receptionist','accountant')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE dentists (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  credentials TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  registration_no TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role_label TEXT NOT NULL DEFAULT '',
  professional_info TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE payment_methods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  built_in INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  preferred_name TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL DEFAULT 'other' CHECK (sex IN ('male','female','other')),
  dob TEXT,
  phone TEXT NOT NULL DEFAULT '',
  alternate_phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  occupation TEXT NOT NULL DEFAULT '',
  emergency_contact_name TEXT NOT NULL DEFAULT '',
  emergency_contact_phone TEXT NOT NULL DEFAULT '',
  referral_source TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  medical_history TEXT NOT NULL DEFAULT '',
  dental_history TEXT NOT NULL DEFAULT '',
  allergies TEXT NOT NULL DEFAULT '',
  current_medications TEXT NOT NULL DEFAULT '',
  chronic_conditions TEXT NOT NULL DEFAULT '',
  risk_info TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_patients_name ON patients (full_name COLLATE NOCASE);
CREATE INDEX idx_patients_phone ON patients (phone);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  chair TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show')),
  notes TEXT NOT NULL DEFAULT '',
  converted_visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX idx_appointments_start ON appointments (start_at);
CREATE INDEX idx_appointments_patient ON appointments (patient_id);
CREATE INDEX idx_appointments_dentist_start ON appointments (dentist_id, start_at);

CREATE TABLE queue_entries (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  serial INTEGER NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  room TEXT NOT NULL DEFAULT '',
  chair TEXT NOT NULL DEFAULT '',
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','called','in_progress','completed','skipped','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (day, serial)
);
CREATE INDEX idx_queue_day ON queue_entries (day, status);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  visit_at TEXT NOT NULL,
  chief_complaint TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  symptoms TEXT NOT NULL DEFAULT '',
  examination TEXT NOT NULL DEFAULT '',
  diagnosis TEXT NOT NULL DEFAULT '',
  treatment_plan_text TEXT NOT NULL DEFAULT '',
  treatment_performed TEXT NOT NULL DEFAULT '',
  tooth_numbers TEXT NOT NULL DEFAULT '[]',
  procedures TEXT NOT NULL DEFAULT '',
  anesthesia TEXT NOT NULL DEFAULT '',
  medications_text TEXT NOT NULL DEFAULT '',
  advice TEXT NOT NULL DEFAULT '',
  referral TEXT NOT NULL DEFAULT '',
  follow_up_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_visits_patient ON visits (patient_id, visit_at);
CREATE INDEX idx_visits_followup ON visits (follow_up_date);

CREATE TABLE tooth_records (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  tooth_fdi TEXT NOT NULL,
  dentition TEXT NOT NULL DEFAULT 'adult' CHECK (dentition IN ('adult','primary')),
  state TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (patient_id, tooth_fdi)
);

CREATE TABLE treatments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL DEFAULT 30,
  standard_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (standard_price_paisa >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE treatment_plans (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '',
  diagnosis TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','proposed','accepted','in_progress','completed','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_plans_patient ON treatment_plans (patient_id);

CREATE TABLE treatment_plan_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  treatment_id INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  custom_name TEXT NOT NULL DEFAULT '',
  tooth_fdi TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_paisa >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  completed_at TEXT
);
CREATE INDEX idx_plan_items_plan ON treatment_plan_items (plan_id);

CREATE TABLE prescriptions (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  prescribed_at TEXT NOT NULL,
  cc_json TEXT NOT NULL DEFAULT '[]',
  oe_json TEXT NOT NULL DEFAULT '[]',
  re_text TEXT NOT NULL DEFAULT '',
  advice TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_prescriptions_patient ON prescriptions (patient_id, prescribed_at);

CREATE TABLE prescription_items (
  id INTEGER PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,
  form TEXT NOT NULL DEFAULT 'tablet',
  dose TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  timing TEXT NOT NULL DEFAULT '',
  custom_instructions TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_rx_items ON prescription_items (prescription_id, sort_order);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  treatment_plan_id INTEGER REFERENCES treatment_plans(id) ON DELETE SET NULL,
  issued_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','void')),
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  tax_paisa INTEGER NOT NULL DEFAULT 0 CHECK (tax_paisa >= 0),
  total_paisa INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (total_paisa >= 0)
);
CREATE INDEX idx_invoices_patient ON invoices (patient_id, issued_at);
CREATE INDEX idx_invoices_issued ON invoices (issued_at);

CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  treatment_id INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  tooth_fdi TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_paisa >= 0),
  discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  tax_paisa INTEGER NOT NULL DEFAULT 0 CHECK (tax_paisa >= 0),
  line_total_paisa INTEGER NOT NULL DEFAULT 0 CHECK (line_total_paisa >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_invoice_items ON invoice_items (invoice_id, sort_order);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL,
  client_ref TEXT UNIQUE,
  void INTEGER NOT NULL DEFAULT 0,
  voided_by TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_patient ON payments (patient_id, paid_at);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);
CREATE INDEX idx_payments_paid_at ON payments (paid_at);

CREATE TABLE adjustments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('refund','write_off','discount_correction','rounding','manual_credit','manual_debit')),
  reason TEXT NOT NULL DEFAULT '',
  effective_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_adjustments_patient ON adjustments (patient_id, effective_at);

CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'pcs',
  cost_paisa INTEGER NOT NULL DEFAULT 0 CHECK (cost_paisa >= 0),
  price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (price_paisa >= 0),
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  batch TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (quantity >= 0)
);
CREATE INDEX idx_inventory_name ON inventory_items (name COLLATE NOCASE);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('purchase','stock_in','stock_out','adjustment','return','correction')),
  qty INTEGER NOT NULL CHECK (qty <> 0),
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_paisa >= 0),
  balance_after INTEGER NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_movements_item ON inventory_movements (item_id, id);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL DEFAULT 'Cash',
  reference TEXT NOT NULL DEFAULT '',
  spent_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_expenses_spent ON expenses (spent_at);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_attachments_patient ON attachments (patient_id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  entity TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_read ON notifications (read, id);

CREATE TABLE backups (
  id INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  db_counts TEXT NOT NULL DEFAULT '{}',
  app_version TEXT NOT NULL DEFAULT '',
  db_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_at ON audit_log (id);
CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id);
`;
