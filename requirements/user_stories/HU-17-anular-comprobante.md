# HU-17 · Anular un comprobante

| Campo | Valor |
|--------|--------|
| **ID** | HU-17 |
| **Módulo** | Facturación |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** anular un comprobante emitido por error,  
**para** corregir el registro sin eliminar el historial.

---

## Criterios de aceptación

1. **Acción desde detalle** — Se puede anular un comprobante desde su vista de detalle (con permisos de admin).
2. **Razón obligatoria** — El sistema solicita una razón de anulación en texto obligatorio antes de confirmar.
3. **Estado y visibilidad** — Tras anular, el comprobante pasa a estado “Anulado” y sigue visible en el historial con ese estado.

---

## Implementación actual (código, 2026-04)

- **UI:** detalle de factura en historial con acción de anulación y motivo.
- **API:** anulación con códigos de error tipados (ver `femme.apiErrors` en i18n).
- **E2E:** `e2e/tests/hu-17-anular-comprobante.spec.ts`.

---

## Notas para estimación y pruebas

- Alinear con reglas de cierre de caja y numeración fiscal.
- **Pruebas:** anular con motivo válido en UI, historial con estado visible; cualquier política temporal detallada (días cerrados, etc.) se valida donde esté definida regla observable (principalmente HU-18 + API).
