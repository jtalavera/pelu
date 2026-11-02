# Circuito turno ↔ ficha de servicio

Un turno tiene **como máximo una ficha** y una ficha pertenece **a un solo turno** (`service_records.appointment_id`,
nullable, índice único filtrado; migración `V91`). Las fichas sin turno (clientas sin reserva) siguen igual.

## Qué ve cada pantalla
- **Inicio · Turnos de hoy**: sin ficha → «Crear o asignar ficha»; con ficha → «Ir a la ficha». Ya no hay «Cobrar» en la
  fila del turno: se cobra desde la tarjeta de la ficha.
- **Inicio · Fichas de hoy**: cada tarjeta lleva el chip «Turno 11:15» o «Sin turno».
- **Agenda · detalle del turno**: el mismo botón de ficha; «Cobrar» pasa siempre por la ficha (la del turno o una creada en
  ese momento). Un turno Atendido viejo sin ficha conserva el cobro anterior (el servicio agendado como única línea).
- **Ficha**: «Turno de las 10:30» + «Ver turno» (abre el detalle en la Agenda). En el historial de fichas el turno aparece
  como un dato más.

## Reglas
- **Crear**: copia cliente, servicio y profesional del turno (precio del catálogo). Requiere cliente.
- **Asignar**: solo fichas abiertas, de hoy, de la misma clienta y sin turno.
- Crear o asignar pasa un turno Pendiente / Confirmado a **En curso**.
- **Cobrar la ficha** (emitir la factura con `serviceRecordId`) cierra la ficha y marca el turno **Completado**.
- **Cancelar / No vino**: la ficha abierta se suelta (queda abierta, sin turno). Una ficha cobrada conserva su turno.
- Anular una ficha cobrada no reabre el turno.
- Una profesional solo opera los turnos propios y nunca recibe montos.

## API
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/appointments/{id}/service-record` | crea la ficha del turno (201) |
| POST | `/api/appointments/{id}/service-record/assign` `{serviceRecordId}` | asigna una ficha abierta |
| GET | `/api/appointments/{id}/service-record/candidates` | fichas asignables |

Errores: `APPOINTMENT_ALREADY_HAS_SERVICE_RECORD`, `APPOINTMENT_NOT_ACTIVE`, `APPOINTMENT_WITHOUT_CLIENT`,
`SERVICE_RECORD_CLIENT_MISMATCH`, `SERVICE_RECORD_NOT_OPEN`, `SERVICE_RECORD_ALREADY_LINKED`.
`AppointmentResponse.serviceRecordId`, `ServiceRecordResponse/ListItem.appointmentId + appointmentStartAt`.

## Pendiente
El Inicio de la profesional (login normal y dispositivo con PIN) no lista turnos: sus turnos se operan desde la Agenda.

## Tests
JUnit `AppointmentServiceRecordServiceTest`, `ProfessionalAccessPolicyTest`; Vitest `AppointmentFichaAction.test.tsx`;
Playwright `turno-ficha-circuito.spec.ts` y `hu-03-dashboard-principal.spec.ts` (test 7).
