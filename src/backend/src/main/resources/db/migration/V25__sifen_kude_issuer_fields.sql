-- SIFEN HU-08: KuDE (PDF representation) header fields for the emisor.
-- sifen_fantasy_name: D106/dNomFanEmi (optional, 0-1 in the DE schema) — shown in the KuDE header
-- next to the business name (AC-03) when the tenant has one configured; also emitted in the signed
-- DE itself so it's real document data, not an HU-08-only extra (unlike kude_footer_message below).
-- kude_footer_message: AC-11's one deliberate exception (besides the logo, already covered by
-- logo_data_url) — a free-text message printed on the KuDE but never sent to SIFEN.
ALTER TABLE business_profiles ADD sifen_fantasy_name NVARCHAR(255) NULL;
ALTER TABLE business_profiles ADD kude_footer_message NVARCHAR(500) NULL;
