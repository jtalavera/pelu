-- SIFEN HU-08: the QR code URL (gCamFuFD/dCarQR) actually embedded in the signed document this
-- system transmitted, plus the environment's public consultation site — both persisted once at
-- submission time so the KuDE PDF and the future revalidation button (HU-09) never need to re-sign
-- the document just to recover them.
ALTER TABLE invoices ADD sifen_qr_url NVARCHAR(1000) NULL;
ALTER TABLE invoices ADD sifen_public_consultation_url NVARCHAR(200) NULL;
