-- Comprobante <-> turno: el turno cobrado guarda el comprobante con el que se cobro, para que la Agenda
-- no vuelva a ofrecer "Cobrar". Los comprobantes emitidos desde la ficha de un turno se enlazan aqui.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('invoices') AND name = 'appointment_id')
BEGIN
    ALTER TABLE invoices ADD appointment_id BIGINT NULL;
    ALTER TABLE invoices ADD CONSTRAINT fk_invoices_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoices_appointment')
BEGIN
    EXEC('CREATE INDEX ix_invoices_appointment ON invoices (appointment_id) WHERE appointment_id IS NOT NULL');
END
GO
-- Los turnos cobrados a traves de su ficha antes de este cambio.
UPDATE i
SET i.appointment_id = sr.appointment_id
FROM invoices i
JOIN service_records sr ON sr.id = i.service_record_id
WHERE sr.appointment_id IS NOT NULL AND i.appointment_id IS NULL;
