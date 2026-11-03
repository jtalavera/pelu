-- Cliente genérico "ocasional" (uno por tenant, creado al primer uso): sostiene las fichas de servicio de
-- los turnos de clientas ocasionales. No aparece en listados ni en alertas de clientes.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'is_generic')
BEGIN
    ALTER TABLE clients ADD is_generic BIT NOT NULL CONSTRAINT DF_clients_is_generic DEFAULT 0;
END
