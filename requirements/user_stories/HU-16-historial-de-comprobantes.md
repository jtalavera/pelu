# HU-16 · Ver el historial de comprobantes

| Campo | Valor |
|--------|--------|
| **ID** | HU-16 |
| **Módulo** | Facturación |
| **Estado** | `Backlog` |

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

## Notas para estimación y pruebas

- **Pruebas:** lista vacía, paginación si aplica, filtros combinados, coherencia con HU-14 y HU-17 (anulados visibles).
