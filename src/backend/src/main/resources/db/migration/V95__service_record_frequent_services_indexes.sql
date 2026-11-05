-- Servicios frecuentes de la ficha (ServiceRecordRepository.findFrequentServiceIds): fichas del salón
-- de los últimos 90 días (sin anuladas) agrupadas por servicio.
--
-- 1) Hasta ahora el único índice de service_records era por tenant_id: SQL Server recorría TODA la
--    historia del salón y recién después descartaba lo de más de 90 días. Con (tenant_id, created_at)
--    lee solo el rango (y el estado viaja en el índice). También ayuda al historial de fichas y a la
--    lista de hoy de Inicio, que filtran por fecha.
-- 2) El índice de las líneas era solo por service_record_id; la consulta necesita además service_id,
--    lo que obligaba a una lectura extra de la tabla por cada línea. INCLUDE (service_id) lo cubre.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'service_records') AND name = N'ix_service_records_tenant_created')
BEGIN
    CREATE NONCLUSTERED INDEX ix_service_records_tenant_created
        ON service_records (tenant_id, created_at DESC) INCLUDE (status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'service_record_lines') AND name = N'ix_service_record_lines_record_service')
BEGIN
    CREATE NONCLUSTERED INDEX ix_service_record_lines_record_service
        ON service_record_lines (service_record_id) INCLUDE (service_id);
END
