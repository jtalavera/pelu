-- Apodo opcional de la profesional: si lo tiene, las listas muestran el apodo en lugar del nombre completo.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('professionals') AND name = 'nickname')
BEGIN
    ALTER TABLE professionals ADD nickname NVARCHAR(60) NULL;
END
