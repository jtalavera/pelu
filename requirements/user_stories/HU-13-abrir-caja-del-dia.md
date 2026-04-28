# HU-13 · Abrir la caja del día


| Campo      | Valor       |
| ---------- | ----------- |
| **ID**     | HU-13       |
| **Módulo** | Facturación |
| **Estado** | `Done`   |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** registrar la apertura de caja con el monto inicial en efectivo,  
**para** tener un control del flujo de dinero del día.

---

## Criterios de aceptación

1. **Solicitud de apertura** — Al iniciar el día (o al operar cobros cuando no hay sesión), el sistema solicita abrir la caja con monto inicial en efectivo.
2. **Una caja abierta por tenant** — No puede haber más de una caja **abierta** a la vez por negocio; **no se puede abrir** otra si ya existe una abierta.
3. **Registro de auditoría** — La apertura queda registrada con fecha, hora y usuario (identificador del admin que abre).

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/billing` — pestaña “Cash Register”; apertura con monto inicial.
- **API:** `POST /api/cash-sessions/open`.
- **E2E:** `e2e/tests/hu-13-abrir-caja-del-dia.spec.ts` y fixture `e2e/fixtures/billing.ts`.

---

## Notas para estimación y pruebas

- **Pruebas:** segundo intento de apertura con caja ya abierta bloqueado; intento **de emisión sin caja** cubierto en **HU-14**.