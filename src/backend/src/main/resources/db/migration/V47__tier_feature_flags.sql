-- HU-46 (Épica D — Tiers y Feature Flags): tier-level default feature-flag package (PRD "Tier":
-- "usada para dar de alta un paquete por defecto de feature flags a los tenants que la tienen
-- asignada"). tier_feature_flags is a third table alongside the HU-49 override chain
-- (feature_flags = global default, tenant_feature_flags = per-tenant override): a row here means
-- the flag is included ("habilitada") in the tier's default package; its absence means the tier has
-- no opinion for that flag and the global default applies. Actually consuming this in the 3-level
-- resolution (default global -> tier default -> tenant override) is HU-47, not this migration.
--
-- tier_feature_flag_changes is the parallel audit table (AC-5), one row per (tier, flag) overwritten
-- on each change, same "single last result" convention as tenant_feature_flag_changes (V8/V18).
CREATE TABLE tier_feature_flags (
  id       BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tier_id  BIGINT       NOT NULL,
  flag_key VARCHAR(100) NOT NULL,
  enabled  BIT          NOT NULL,
  CONSTRAINT uq_tier_feature_flags_tier_flag UNIQUE (tier_id, flag_key),
  CONSTRAINT fk_tier_feature_flags_tier FOREIGN KEY (tier_id) REFERENCES tiers(id),
  CONSTRAINT fk_tier_feature_flags_flag FOREIGN KEY (flag_key) REFERENCES feature_flags(flag_key)
);

CREATE TABLE tier_feature_flag_changes (
  id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tier_id            BIGINT        NOT NULL,
  flag_key           VARCHAR(100)  NOT NULL,
  previous_included  BIT           NOT NULL,
  new_included       BIT           NOT NULL,
  changed_at         DATETIME2     NOT NULL,
  changed_by_user_id BIGINT        NOT NULL,
  changed_by_email   NVARCHAR(320) NOT NULL,
  CONSTRAINT uq_tier_feature_flag_changes_tier_flag UNIQUE (tier_id, flag_key)
);
