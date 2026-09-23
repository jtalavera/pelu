-- HU-38 (Editar tenant) AC-1/AC-3: "cambio de tier" is only observable/testable once at least two
-- tiers exist. HU-45 (full tier CRUD) hasn't landed yet, so — same rationale as V41's single
-- default tier seed — this adds one more minimal tier now, purely so a Platform Admin (and the
-- HU-38 automated tests) can actually pick a *different* tier when editing a tenant. HU-45 extends
-- tier management properly; this is not a product decision about the final tier catalog.
INSERT INTO tiers (name, description) VALUES (N'Premium', N'Tier con funcionalidades ampliadas.');
