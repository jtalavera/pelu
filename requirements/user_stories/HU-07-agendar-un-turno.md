# HU-07 · Agendar un turno

| Campo | Valor |
|--------|--------|
| **ID** | HU-07 |
| **Módulo** | Agendamiento |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** crear un turno nuevo desde el calendario,  
**para** registrar la cita de una cliente con la profesional y el servicio correspondiente.

---

## Criterios de aceptación

1. **Datos del turno** — Se puede crear un turno seleccionando: fecha, hora, profesional, servicio y cliente registrada, o **cliente ocasional** mediante el **identificador genérico** del sistema (PRD — Definiciones transversales).
2. **Sin solapamiento** — No puede existir otro turno en el mismo horario para la misma profesional; el sistema rechaza con mensaje claro.
3. **Refresco del calendario** — El turno creado aparece de inmediato en el calendario (misma sesión).
4. **Estado inicial** — El estado inicial del turno es “Pendiente”.
5. **Duración** — Si el servicio tiene duración (ej. 90 minutos), el turno bloquea ese intervalo en el calendario para esa profesional (no solapes en el rango completo).

---

## Implementación actual (código, 2026-04)

- **UI:** modal “New appointment” en `CalendarPage` (profesional, servicio, cliente, fecha/hora).
- **API:** `POST /api/appointments` con validación de solapes y reglas de horario.
- **E2E:** `e2e/tests/hu-07-agendar-un-turno.spec.ts`.

---

## Notas para estimación y pruebas

- **Pruebas:** solape mismo slot, servicio largo vs corto, cliente ocasional vs registrada, validación de horario fuera de agenda de la profesional si aplica reglas de HU-05.
