# Rediseño minimalista de la Agenda (Calendario)

Cuarta pantalla del rediseño web (rama `refactor/redesign-agenda`). Maqueta aprobada:
https://claude.ai/artifact/Mn9xkyUNEwjyzz8ognp7Ur

## Qué ve el usuario (`src/frontend/src/pages/CalendarPage.tsx`)

- **Vista Día por defecto**: lista de los turnos del día en orden de hora (hora, cliente,
  `Estado · servicio · profesional`; "· ahora" en el turno en curso, 🎂 si la cliente cumple años,
  ✓ si está confirmado y 🔔 si ya se envió el recordatorio). Arriba, una **tira de los 7 días** de la
  semana con cuántos turnos tiene cada uno ("3 turnos", "libre") para saltar de un día a otro.
- **Semana a un toque**: el interruptor *Día | Semana* abre la grilla de siempre (`?view=week` también
  la abre directo). En el celular solo existe la vista Día.
- **Encabezado**: *Turnos* y **+ Nuevo turno**; flechas (un día en Día, una semana en Semana) con
  **Hoy** y la fecha.
- **Profesionales como chips** (*Todas las profesionales* + uno por profesional) en lugar del
  desplegable. La profesional logueada arranca en su propia agenda y puede mirar las demás.
- **Detalle del turno** con **un solo botón principal según el estado**: Pendiente → *Confirmar*,
  Confirmado → *Iniciar*, En curso o Atendido → **Cobrar** (abre Facturación con el cliente y el
  servicio cargados, igual que en el Inicio; no aparece para el rol profesional). El resto vive en **⋯**:
  *Editar turno*, *Ficha técnica*, *Marcar como atendido*, *No asistió* y *Cancelar turno* (pide el
  motivo en un diálogo). Ya no hay un diálogo con la lista de estados.
- **Formulario de turno** en el orden Cliente, Servicio, Profesional, Fecha y Hora, con horas rápidas
  (09:00, 10:00, 11:00, 14:00, 15:00, 16:00). La fecha viene con el día que se está mirando y, al
  guardar, la Agenda salta al día del turno. El aviso de disponibilidad sigue sin bloquear.

## Qué se conserva

- La grilla semanal (colores por profesional, borde punteado en pendientes, clic en un hueco para
  crear, bloques superpuestos) y sus `data-testid` (`calendar-appt-<id>`, `calendar-day-col-<día>`, …).
- Los turnos cancelados y los "No asistió" no se listan (igual que en la grilla).
- Reglas por rol: una profesional solo modifica sus turnos.

## Tests

- Vitest: `CalendarPage.test.tsx`.
- Playwright: los specs del calendario abren `?view=week`; helpers nuevos en `e2e/fixtures/ui.ts`
  (`filterAgendaByProfessional`, `completeAppointmentFromDetail`, `cancelAppointmentFromDetail`).
