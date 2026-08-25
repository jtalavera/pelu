-- Issue #170: SIFEN rejects invoices paid with Tarjeta de crédito/débito because the mandatory
-- E7.1.1/gPagTarCD group (card brand + description) was never captured or emitted. Nullable: only
-- ever set for CREDIT_CARD/DEBIT_CARD allocations, existing rows (cash/transfer) stay NULL.
ALTER TABLE invoice_payment_allocations ADD card_brand NVARCHAR(20) NULL;
ALTER TABLE invoice_payment_allocations ADD card_brand_other_description NVARCHAR(60) NULL;
GO
