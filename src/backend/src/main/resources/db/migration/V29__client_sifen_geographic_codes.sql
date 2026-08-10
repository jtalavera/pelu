-- SIFEN HU-02 AC-07: "si se informa la dirección del cliente, el documento también incluye su
-- departamento y ciudad" (D219/cCiuRec, D223/... ) — cDepRec/cCiuRec are numeric DNIT catalog
-- codes, not free text. clients.department/clients.city (V19) only ever held free text, so
-- SifenDocumentXmlService could never actually emit these fields even when an address was
-- present. Same pattern as business_profiles' sifen_department_code/sifen_city_code (V21): a
-- code+name pair, populated together from the official DNIT geographic catalog picker, not typed
-- freely. The existing department/city columns keep their names (no rename, no data migration
-- needed) and become the "name" half of that pair.
ALTER TABLE clients ADD department_code NVARCHAR(4) NULL;
ALTER TABLE clients ADD city_code NVARCHAR(8) NULL;
