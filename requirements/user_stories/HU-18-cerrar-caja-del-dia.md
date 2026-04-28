# HU-18 · Cerrar la caja del día

| Campo | Valor |
|--------|--------|
| **ID** | HU-18 |
| **Módulo** | Facturación |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** cerrar la caja al finalizar el día con un resumen de ingresos por método de pago,  
**para** controlar si los montos reales coinciden con lo registrado en el sistema.

---

## Criterios de aceptación

1. **Resumen** — Al cerrar, el sistema muestra: total facturado, subtotales por método de pago y cantidad de comprobantes.
2. **Arqueo de efectivo** — Se puede ingresar el monto real contado en efectivo para comparar con el esperado por el sistema.
3. **Diferencia** — El sistema calcula y muestra la diferencia (sobrante o faltante) entre contado y esperado.
4. **Registro de cierre** — El cierre queda registrado con fecha, hora, usuario y el resumen completo (auditoría).
5. **Post-cierre** — Con la caja cerrada no se pueden emitir nuevos comprobantes hasta abrir nuevamente la caja desde el flujo de caja registradora. El cierre del día es **opcional** para el negocio; si no se cierra, no aplica esta restricción hasta que efectivamente exista un cierre sin reapertura.

---

## Implementación actual (código, 2026-04)

- **UI:** flujo “Close cash register” en pestaña de caja (conteo físico vs esperado).
- **API:** cierre de sesión de caja (`POST` de cierre según `CashSessionService`).
- **E2E:** `e2e/tests/hu-18-cerrar-caja-del-dia.spec.ts`.

---

## Notas para estimación y pruebas

- Enlaza con HU-13, HU-14, HU-15, HU-17.
- **Pruebas:** cierre con y sin diferencia en efectivo, intento de facturar con caja cerrada, negocio que opera sin cerrar caja (solo apertura inicial), nueva apertura tras cierre.
