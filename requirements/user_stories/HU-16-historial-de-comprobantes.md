# HU-16 · Ver el historial de comprobantes

| Campo | Valor |
|--------|--------|
| **ID** | HU-16 |
| **Módulo** | Facturación |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ver todos los comprobantes emitidos con filtros por fecha y cliente,  
**para** consultar el historial de ventas rápidamente.

---

## Criterios de aceptación

1. **Listado** — Existe una pantalla de historial con todos los comprobantes ordenados por fecha descendente por defecto.
2. **Filtros** — Se puede filtrar por rango de fechas, cliente y estado (estados definidos en el modelo: ej. emitido, anulado).
3. **Columnas** — Cada fila muestra: número, fecha, cliente, total y estado.
4. **Detalle y PDF** — Desde el detalle de un comprobante se puede descargar el PDF (mismo contenido que al emitir).

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/billing` — pestaña “History” (`Invoice history`).
- **API:** listado de facturas con filtros de fecha/estado/cliente.
- **E2E:** `e2e/tests/hu-16-historial-de-comprobantes.spec.ts`.

### Actualizaciones (2026-04, rango e índice)

- **Filtro por defecto (UI):** al abrir el historial, el rango es **ayer–hoy** (dos días calendario locales, según el navegador). “Limpiar filtros” vuelve a ese rango.
- **Límite de rango:** el intervalo **desde–hasta** (incluido) no puede superar **31 días**; no hay tope de antigüedad, solo límite de amplitud del rango. Validación en front y en `GET /api/invoices` (`InvoiceService.resolveInvoiceListRange`). Si `from` y `to` faltan en la API, el backend aplica el mismo criterio por defecto (ayer–hoy, zona del servidor).
- **Índice en BD (SQL Server):** migración `V8__invoices_tenant_issued_at_index.sql` — índice compuesto `invoices(tenant_id, issued_at DESC)` para consultas por negocio y fecha de emisión.

---

## Notas para estimación y pruebas

- **Pruebas:** lista vacía, paginación si aplica, filtros combinados, coherencia con HU-14 y HU-17 (anulados visibles).
