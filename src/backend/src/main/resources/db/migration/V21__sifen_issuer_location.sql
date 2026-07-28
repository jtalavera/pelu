-- SIFEN HU-04: mandatory issuer location codes (D111/cDepEmi, D112/dDesDepEmi, D115/cCiuEmi,
-- D116/dDesCiuEmi) needed to assemble the gEmis group of a signed document. Unlike the receiver's
-- department/city (HU-02, free text), these are always-mandatory numeric DNIT catalog codes for
-- the emisor, so they need their own fields rather than reusing free text. Nullable: only the
-- SIFEN pilot tenant needs these configured for now, same pattern as taxpayer_type/
-- economic_activity_code in V19.
ALTER TABLE business_profiles ADD sifen_department_code NVARCHAR(4) NULL;
ALTER TABLE business_profiles ADD sifen_department_name NVARCHAR(64) NULL;
ALTER TABLE business_profiles ADD sifen_city_code NVARCHAR(8) NULL;
ALTER TABLE business_profiles ADD sifen_city_name NVARCHAR(64) NULL;
