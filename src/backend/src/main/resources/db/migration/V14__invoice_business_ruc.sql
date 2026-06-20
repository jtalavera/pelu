-- Add business_ruc column to invoices table to snapshot the salon RUC at invoice issue time.
-- NULL allowed for backwards compatibility with existing rows (pre-migration invoices).
ALTER TABLE invoices
  ADD business_ruc NVARCHAR(32) NULL;
