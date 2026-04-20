-- Prevent two professionals in the same tenant from sharing an email address.
-- NULL emails are excluded from the constraint (a professional without email is always allowed).
CREATE UNIQUE INDEX UQ_professional_tenant_email
    ON professionals (tenant_id, email)
    WHERE email IS NOT NULL;
