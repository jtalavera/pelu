# Fichas de servicio — rediseño minimalista

Parte del rediseño general. Mismo sistema: una acción principal por estado, lo raro plegado, avisos pasajeros.

## Lista (`/app/service-records`)
- Título, **+ Nueva ficha**, buscador (cliente o servicio) y chips **Abiertas** (por defecto, lo
  pendiente de cobrar), **Hoy** y **Todas**. "Filtros" (desde, hasta, estado; máx. 6 meses) está plegado.
  Se eliminaron las pestañas Nueva ficha / Historial y los botones "Actualizar" y "Limpiar filtros".
- Cada fila: iniciales, cliente, `fecha/hora · servicios · profesionales` y total. Las **abiertas**
  tienen el botón **Cobrar**; las demás muestran "Cobrada" o "Anulada".
  El listado del backend (`GET /api/service-records`) suma `servicesSummary` y `professionalsSummary`.
- **Cobrar** desde la fila abre Facturación con la ficha lista (`lib/serviceRecordBilling.ts`).
- Tocar una fila abre la ficha en un diálogo. Guardar o anular cierra el diálogo y un `Toast` de 4 s lo
  confirma en la lista. El enlace "Ver historial" del Inicio abre la lista en **Todas**.

## Ficha (diálogo)
- Bloque **CLIENTE** (buscar o crear; al volver de "crear cliente" el cliente queda elegido) y bloque
  **SERVICIOS**, separados por una línea y títulos en color principal (sin fondos de color).
- Cada línea: servicio, profesional, **cantidad** (1 por defecto, editable), precio unitario y subtotal.
  "+ Agregar otro servicio", "Quitar" cuando hay más de una, y el **Total**.
- **Más opciones**: propinas por profesional (solo los que están en las líneas).
- Ficha **abierta**: **Cobrar** (guarda los cambios y abre Facturación), **Guardar** (secundario), **Cerrar**
  y un menú ⋯ con **Anular ficha** (motivo en el mismo lugar). Ficha nueva: Cancelar / Guardar.
- Ficha **cobrada** o **anulada**: solo lectura, con el comprobante vinculado o el motivo.

## Tests
Vitest: `ServiceRecordsPage.test.tsx`, `ServiceRecordEditor.test.tsx`; JUnit: `ServiceRecordServiceTest`.
Los specs de Playwright se adaptan en la pasada final tras el rediseño de Configuración.
