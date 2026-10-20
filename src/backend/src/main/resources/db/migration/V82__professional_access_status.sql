-- Issue #38: "Acceso al sistema para profesionales".

-- (4)/(5) When each invitation was sent — drives the access status line and the 2-minute resend
-- cooldown. Existing rows were always issued with a 48 h lifetime, so backfill from expires_at.
ALTER TABLE professional_activation_tokens ADD created_at DATETIME2 NULL;
GO
UPDATE professional_activation_tokens SET created_at = DATEADD(HOUR, -48, expires_at) WHERE created_at IS NULL;
GO

-- (2) A professional whose email was changed after activating kept the old-email user linked and
-- enabled. Detach every user whose email no longer matches its professional's current email...
UPDATE p SET p.user_id = NULL
FROM professionals p
JOIN app_users u ON u.id = p.user_id
WHERE p.email IS NULL OR LOWER(LTRIM(RTRIM(p.email))) <> LOWER(u.email);
GO

-- (3) ...and keep at most one professional per user (the oldest link wins).
UPDATE p SET p.user_id = NULL
FROM professionals p
WHERE p.user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM professionals o WHERE o.user_id = p.user_id AND o.id < p.id);
GO

-- (2) A PROFESSIONAL user no longer linked to any professional can't keep logging in.
UPDATE u SET u.enabled = 0
FROM app_users u
WHERE u.role = 'PROFESSIONAL'
  AND NOT EXISTS (SELECT 1 FROM professionals p WHERE p.user_id = u.id);
GO

-- (3) One user ↔ one professional at a time.
CREATE UNIQUE INDEX ux_professionals_user_id ON professionals(user_id) WHERE user_id IS NOT NULL;
GO
