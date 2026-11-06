-- Turno <-> ficha de servicio: una ficha puede pertenecer a varios turnos, pero un turno tiene como
-- maximo una ficha. El vinculo pasa de service_records.appointment_id (unico) a
-- appointments.service_record_id.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('appointments') AND name = 'service_record_id')
BEGIN
    ALTER TABLE appointments ADD service_record_id BIGINT NULL;
    ALTER TABLE appointments ADD CONSTRAINT fk_appointments_service_record FOREIGN KEY (service_record_id) REFERENCES service_records (id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_appointments_service_record')
BEGIN
    EXEC('CREATE INDEX ix_appointments_service_record ON appointments (service_record_id) WHERE service_record_id IS NOT NULL');
END
GO
-- Las fichas ya asignadas a un turno (solo si la columna vieja todavia existe).
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('service_records') AND name = 'appointment_id')
BEGIN
    EXEC('UPDATE a SET a.service_record_id = sr.id FROM appointments a JOIN service_records sr ON sr.appointment_id = a.id WHERE a.service_record_id IS NULL');
END
GO
-- Se retira el vinculo viejo (indice unico, clave foranea y columna).
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_service_records_appointment' AND object_id = OBJECT_ID('service_records'))
BEGIN
    DROP INDEX ux_service_records_appointment ON service_records;
END
GO
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_service_records_appointment')
BEGIN
    ALTER TABLE service_records DROP CONSTRAINT fk_service_records_appointment;
END
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('service_records') AND name = 'appointment_id')
BEGIN
    ALTER TABLE service_records DROP COLUMN appointment_id;
END
