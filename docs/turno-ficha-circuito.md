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
- **Crear**: copia cliente, servicio y profesional del turno (precio del catálogo). Sin cliente, usa el cliente genérico ocasional.
- **Asignar**: solo fichas abiertas, de hoy, de la misma clienta y sin turno.
  Al asignar, el servicio del turno queda en la ficha: si ya tiene una línea con ese servicio, la primera pasa a la
  profesional del turno (sin duplicar ni tocar cantidades); si no, se agrega (cantidad 1, precio del catálogo, profesional
  del turno). Las demás líneas no se tocan. Una propina solo se conserva mientras su profesional siga en alguna línea.
- Crear o asignar pasa un turno Pendiente / Confirmado a **En curso**.
- **Cobrar la ficha** (emitir la factura con `serviceRecordId`) cierra la ficha y marca el turno **Completado**.
- **Cancelar / No vino**: la ficha abierta se suelta (queda abierta, sin turno). Una ficha cobrada conserva su turno.
- Anular una ficha cobrada no reabre el turno.
- Una profesional solo opera los turnos propios y nunca recibe montos.

## Turno cobrado y su comprobante
`invoices.appointment_id` (migración `V93`, con relleno de lo ya cobrado por ficha) enlaza el comprobante con el turno que
cobró: el de su ficha o, sin ficha, el turno desde el que se tocó «Cobrar» o el que se dejó tildado al facturar
(`InvoiceCreateRequest.appointmentId`). El servidor completa el turno junto con el comprobante (ya no lo hace el frontend).
`AppointmentResponse.invoiceId` trae el comprobante emitido (no anulado) del turno.
- Agenda: con comprobante, el botón principal es **«Ver comprobante»** (abre el detalle en Facturación) en lugar de
  «Cobrar». Un turno «Atendido» sin comprobante sigue ofreciendo «Cobrar». Anular el comprobante vuelve a ofrecer «Cobrar».
- Un turno cobrado no admite un segundo comprobante (`APPOINTMENT_ALREADY_INVOICED`); un turno cancelado o «No vino» no
  se reactiva al facturar.

## Turno de clienta ocasional (sin cliente)
Un turno sin cliente registrado sigue el mismo circuito que cualquier otro. «Crear ficha» (un solo clic, sin «Asignar»:
mezclaría fichas de personas distintas) crea la ficha bajo el **cliente genérico «CLIENTE OCASIONAL»**, uno por tenant,
creado al primer uso (`clients.is_generic`, migración `V94`). El turno pasa a En curso y la fila muestra «Ir a la ficha».
El Inicio ya no ofrece «Cobrar» directo para estos turnos: se cobra desde la ficha.
- El cliente genérico no aparece en el listado ni en la búsqueda de clientes, ni en el panel de clientes inactivos; no se
  puede desactivar ni reactivar (`CLIENT_GENERIC_READ_ONLY`).
- Al facturar la ficha, el cliente genérico **no** es el receptor: el comprobante sale como cliente ocasional («CONSUMIDOR
  FINAL», sin cliente vinculado), con los datos de receptor que se carguen en la factura.
- `candidates` devuelve vacío y `assign` responde `SERVICE_RECORD_CLIENT_MISMATCH` para un turno ocasional.
- Los turnos ocasionales anteriores sin ficha conservan el cobro directo (Agenda: «Cobrar»; Inicio: «Ver comprobante»
  cuando ya están cobrados).

## Facturar sin ficha (mostrador)
En «Nueva factura», al elegir una clienta que no tiene ficha abierta pero sí un turno de hoy sin ficha (Pendiente,
Confirmado o En curso; el más temprano), aparece un aviso con la casilla «Marcar como completado el turno de las HH:MM
al cobrar», tildada por defecto. Si sigue tildada, al emitir la factura el turno pasa a Completado (el frontend usa
`PATCH /api/appointments/{id}/status`). No se crea ficha.

## API
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/appointments/{id}/service-record` | crea la ficha del turno (201) |
| POST | `/api/appointments/{id}/service-record/assign` `{serviceRecordId}` | asigna una ficha abierta |
| GET | `/api/appointments/{id}/service-record/candidates` | fichas asignables |

Errores: `APPOINTMENT_ALREADY_HAS_SERVICE_RECORD`, `APPOINTMENT_NOT_ACTIVE`,
`SERVICE_RECORD_CLIENT_MISMATCH`, `SERVICE_RECORD_NOT_OPEN`, `SERVICE_RECORD_ALREADY_LINKED`.
`AppointmentResponse.serviceRecordId`, `ServiceRecordResponse/ListItem.appointmentId + appointmentStartAt`.

## Inicio de la profesional
Con clave o en el dispositivo compartido con PIN, su Inicio muestra primero «Mis turnos de hoy»: solo los propios y por
atender (Pendiente, Confirmado, En curso), por hora, con «Crear o asignar ficha» / «Ir a la ficha» (la ficha se abre sin
montos). Debajo siguen las tarjetas de fichas abiertas del día. Los turnos Completados ya no se listan (su ficha está
cobrada y ella no la ve).

## Tests
JUnit `AppointmentServiceRecordServiceTest`, `ProfessionalAccessPolicyTest`; Vitest `AppointmentFichaAction.test.tsx`;
Playwright `inicio-profesional-turnos.spec.ts`, `turno-ficha-circuito.spec.ts` (incluye facturar sin ficha) y `hu-03-dashboard-principal.spec.ts` (test 7).
Ya cobrado, la fila del Inicio (sin ficha a la que ir) muestra **«Ver comprobante»**, que abre la factura del turno.
