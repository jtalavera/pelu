# HU-06 · Ver el calendario de turnos

| Campo | Valor |
|--------|--------|
| **ID** | HU-06 |
| **Módulo** | Agendamiento |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ver un calendario semanal con todos los turnos agendados,  
**para** tener una visión clara de la ocupación del salón.

---

## Criterios de aceptación

1. **Vista semanal** — El calendario muestra la semana actual con columnas por día y franjas horarias (comportamiento responsive según reglas del producto).
2. **Contenido del turno** — Cada turno visible muestra: nombre del cliente, servicio y profesional asignada.
3. **Navegación** — Se puede navegar a semanas anteriores y siguientes.
4. **Filtro por profesional** — Se puede filtrar el calendario por profesional.
5. **Detalle** — Al hacer clic en un turno, se accede a su vista de detalle completo.

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/calendar` — `CalendarPage` (vista semanal, filtros por profesional).
- **API:** citas bajo `/api/appointments` (listados y conflictos de solape).
- **E2E:** `e2e/tests/hu-06-calendario-de-turnos.spec.ts`.

---

## Notas para estimación y pruebas

- Depende de HU-04, HU-05 y datos de turnos (HU-07).
- **Pruebas:** semana sin turnos, con varios turnos, filtro que oculta otros profesionales, navegación de bordes de mes.
