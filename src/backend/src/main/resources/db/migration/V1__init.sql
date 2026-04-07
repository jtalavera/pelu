CREATE TABLE tenants (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  name NVARCHAR(255) NOT NULL
);

CREATE TABLE app_users (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  email NVARCHAR(320) NOT NULL,
  password_hash NVARCHAR(255) NOT NULL,
  role NVARCHAR(32) NOT NULL,
  CONSTRAINT fk_app_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT uq_app_users_email UNIQUE (email)
);

CREATE TABLE business_profiles (
  tenant_id BIGINT NOT NULL PRIMARY KEY,
  business_name NVARCHAR(255) NOT NULL,
  ruc NVARCHAR(32) NULL,
  address NVARCHAR(500) NULL,
  phone NVARCHAR(64) NULL,
  contact_email NVARCHAR(320) NULL,
  logo_data_url NVARCHAR(MAX) NULL,
  CONSTRAINT fk_business_profiles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE fiscal_stamps (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  stamp_number NVARCHAR(64) NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  range_from INT NOT NULL,
  range_to INT NOT NULL,
  next_emission_number INT NOT NULL,
  active BIT NOT NULL CONSTRAINT df_fiscal_stamps_active DEFAULT 0,
  locked_after_invoice BIT NOT NULL CONSTRAINT df_fiscal_stamps_locked DEFAULT 0,
  CONSTRAINT fk_fiscal_stamps_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE service_categories (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name NVARCHAR(255) NOT NULL,
  active BIT NOT NULL CONSTRAINT df_service_categories_active DEFAULT 1,
  CONSTRAINT fk_service_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE services (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  category_id BIGINT NOT NULL,
  name NVARCHAR(255) NOT NULL,
  price_minor DECIMAL(19,2) NOT NULL,
  duration_minutes INT NOT NULL,
  active BIT NOT NULL CONSTRAINT df_services_active DEFAULT 1,
  CONSTRAINT fk_services_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_services_category FOREIGN KEY (category_id) REFERENCES service_categories(id)
);

CREATE TABLE professionals (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  full_name NVARCHAR(255) NOT NULL,
  phone NVARCHAR(64) NULL,
  email NVARCHAR(320) NULL,
  photo_data_url NVARCHAR(MAX) NULL,
  active BIT NOT NULL CONSTRAINT df_professionals_active DEFAULT 1,
  CONSTRAINT fk_professionals_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE professional_schedules (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  professional_id BIGINT NOT NULL,
  day_of_week SMALLINT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CONSTRAINT fk_prof_sched_prof FOREIGN KEY (professional_id) REFERENCES professionals(id)
);

CREATE TABLE clients (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  full_name NVARCHAR(255) NOT NULL,
  phone NVARCHAR(64) NULL,
  email NVARCHAR(320) NULL,
  ruc NVARCHAR(32) NULL,
  active BIT NOT NULL CONSTRAINT df_clients_active DEFAULT 1,
  visit_count INT NOT NULL CONSTRAINT df_clients_visits DEFAULT 0,
  CONSTRAINT fk_clients_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE cash_sessions (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  opened_by_user_id BIGINT NOT NULL,
  opened_at DATETIME2 NOT NULL,
  opening_cash_amount DECIMAL(19,2) NOT NULL,
  closed_at DATETIME2 NULL,
  closed_by_user_id BIGINT NULL,
  counted_cash_amount DECIMAL(19,2) NULL,
  CONSTRAINT fk_cash_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_cash_opened FOREIGN KEY (opened_by_user_id) REFERENCES app_users(id),
  CONSTRAINT fk_cash_closed FOREIGN KEY (closed_by_user_id) REFERENCES app_users(id)
);

CREATE TABLE appointments (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  client_id BIGINT NULL,
  professional_id BIGINT NOT NULL,
  service_id BIGINT NOT NULL,
  start_at DATETIME2 NOT NULL,
  end_at DATETIME2 NOT NULL,
  status NVARCHAR(32) NOT NULL,
  cancel_reason NVARCHAR(500) NULL,
  CONSTRAINT fk_appt_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_appt_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_appt_prof FOREIGN KEY (professional_id) REFERENCES professionals(id),
  CONSTRAINT fk_appt_service FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE invoices (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  fiscal_stamp_id BIGINT NOT NULL,
  invoice_number INT NOT NULL,
  client_id BIGINT NULL,
  client_display_name NVARCHAR(255) NULL,
  client_ruc_override NVARCHAR(32) NULL,
  status NVARCHAR(32) NOT NULL,
  subtotal DECIMAL(19,2) NOT NULL,
  discount_type NVARCHAR(16) NULL,
  discount_value DECIMAL(19,2) NULL,
  total DECIMAL(19,2) NOT NULL,
  issued_at DATETIME2 NOT NULL,
  cash_session_id BIGINT NOT NULL,
  void_reason NVARCHAR(500) NULL,
  CONSTRAINT fk_inv_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_inv_stamp FOREIGN KEY (fiscal_stamp_id) REFERENCES fiscal_stamps(id),
  CONSTRAINT fk_inv_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_inv_cash FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id)
);

CREATE TABLE invoice_lines (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  invoice_id BIGINT NOT NULL,
  service_id BIGINT NULL,
  description NVARCHAR(500) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(19,2) NOT NULL,
  line_total DECIMAL(19,2) NOT NULL,
  CONSTRAINT fk_inv_line_inv FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE invoice_payment_allocations (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  invoice_id BIGINT NOT NULL,
  method NVARCHAR(32) NOT NULL,
  amount DECIMAL(19,2) NOT NULL,
  CONSTRAINT fk_pay_inv FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE password_reset_tokens (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash NVARCHAR(128) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  used BIT NOT NULL CONSTRAINT df_prt_used DEFAULT 0,
  CONSTRAINT fk_prt_user FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX ix_app_users_tenant ON app_users(tenant_id);
CREATE INDEX ix_fiscal_stamps_tenant ON fiscal_stamps(tenant_id);
CREATE INDEX ix_service_categories_tenant ON service_categories(tenant_id);
CREATE INDEX ix_services_tenant ON services(tenant_id);
CREATE INDEX ix_professionals_tenant ON professionals(tenant_id);
CREATE INDEX ix_clients_tenant ON clients(tenant_id);
CREATE INDEX ix_appointments_tenant_time ON appointments(tenant_id, professional_id, start_at);
CREATE INDEX ix_cash_sessions_tenant ON cash_sessions(tenant_id);
CREATE INDEX ix_invoices_tenant ON invoices(tenant_id);
