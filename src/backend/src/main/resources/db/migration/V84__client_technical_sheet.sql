-- HU-68: "Ficha técnica" de la cliente — notas y fórmula de color (texto libre, editable también
-- por las profesionales), con quién y cuándo se editó cada campo por última vez. The editor's name
-- is a snapshot taken at save time (it may be an admin user or a professional).
ALTER TABLE clients ADD notes NVARCHAR(2000) NULL;
ALTER TABLE clients ADD notes_updated_at DATETIME2 NULL;
ALTER TABLE clients ADD notes_updated_by NVARCHAR(200) NULL;
ALTER TABLE clients ADD color_formula NVARCHAR(2000) NULL;
ALTER TABLE clients ADD color_formula_updated_at DATETIME2 NULL;
ALTER TABLE clients ADD color_formula_updated_by NVARCHAR(200) NULL;
