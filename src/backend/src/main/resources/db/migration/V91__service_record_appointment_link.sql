-- Turno <-> ficha de servicio: una ficha pertenece como maximo a un turno y un turno tiene como maximo
-- una ficha. Las fichas existentes (sin turno) quedan con appointment_id NULL.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('service_records') AND name = 'appointment_id')
BEGIN
    ALTER TABLE service_records ADD appointment_id BIGINT NULL;
    ALTER TABLE service_records ADD CONSTRAINT fk_service_records_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_service_records_appointment')
BEGIN
    EXEC('CREATE UNIQUE INDEX ux_service_records_appointment ON service_records (appointment_id) WHERE appointment_id IS NOT NULL');
END
