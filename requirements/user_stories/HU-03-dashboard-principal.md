# HU-03 · Ver el dashboard principal


| Campo      | Valor                                 |
| ---------- | ------------------------------------- |
| **ID**     | HU-03                                 |
| **Módulo** | Autenticación & configuración inicial |
| **Estado** | `Done`                             |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ver un resumen del día al ingresar al sistema,  
**para** tener una visión rápida del estado del negocio sin necesidad de navegar.

---

## Criterios de aceptación

1. **Métricas del día** — El dashboard muestra turnos del día (total, confirmados, pendientes) e **ingresos facturados** e **ingresos cobrados** del día y de la semana (definiciones alineadas al PRD — Definiciones transversales).
2. **Accesos rápidos** — Incluye al menos un acceso directo al calendario de turnos y un acceso para registrar una nueva cita (enlaces o botones que navegan correctamente).
3. **Refresco automático** — Los datos del dashboard se actualizan mediante **polling cada 1 minuto** (sin depender de recarga manual de página para ese ciclo).
4. **Estado vacío** — Si no hay datos (ej. día sin turnos), se muestra un estado vacío con mensaje amigable, sin errores ni tablas rotas.

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app` — `DashboardPage`.
- **API:** `GET /api/dashboard` (métricas del día, alertas fiscales, ingresos).
- **UX:** saludo según hora, tarjetas de resumen y acceso rápido a nuevo turno.
- **E2E:** `e2e/tests/hu-03-dashboard-principal.spec.ts`.

---

## Notas para estimación y pruebas

- Depende de datos de agendamiento y facturación para métricas reales.
- **Pruebas:** día sin datos, día con turnos en distintos estados, consistencia numérica con fuentes de verdad (API/consultas).