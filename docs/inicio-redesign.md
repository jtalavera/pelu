# Rediseño minimalista del Inicio

Segunda pantalla del rediseño web (rama `refactor/redesign-inicio`), a continuación de Facturación.
Maqueta aprobada: una columna, los turnos de hoy como protagonista y todo lo demás plegado.

## Qué ve el usuario (`src/frontend/src/pages/DashboardPage.tsx`)

1. Saludo, fecha y **+ Nuevo turno**.
2. Aviso fiscal en una sola línea, con ✕ para cerrarlo.
3. **Resumen en una línea**: `N turnos hoy | Gs. X cobrados` (`dashboard-summary-*`).
4. **Turnos de hoy**: por fila hora, cliente, `Estado · servicio · profesional` y el botón **Cobrar**
   (columna fija para que todas las filas queden alineadas). El turno en curso lleva "· ahora".
   Los turnos cancelados o con inasistencia no tienen botón (no hay nada que cobrar).
5. **Más del día**, plegado y de a una sección por vez, en este orden: Fichas de hoy, Ocupación por
   profesional, Cumpleaños, Clientes inactivos. Cada una muestra un contador (`dashboard-more-<sección>`).

## Cobrar un turno

`Cobrar` abre Facturación en "Nueva factura" con el cliente y el servicio del turno ya cargados
(mismo canal de precarga que las fichas: `prefillServiceRecord`, con `serviceRecordId: null`).
Un turno sin cliente registrado abre la factura sin cliente ("Sin nombre").

Limitación conocida: no existe vínculo turno ↔ factura en el backend, por lo que el Inicio no puede
marcar un turno como "Cobrado" ni mostrar "Ver factura"; muestra el estado del turno. Queda como
siguiente paso (columna `invoice_id` en el turno).

## Qué se movió

- Ingresos de la semana y clientes del mes: pantalla **Dashboards** (`dashboards-revenue-week`,
  `dashboards-clients-month`).
- El calendario mensual se quitó (ya existe la pantalla Calendario).
- Tour guiado: se quitaron los pasos del mini calendario y de la ocupación.

## Tests

- Vitest: `DashboardPage.test.tsx`.
- Playwright: `hu-03-dashboard-principal.spec.ts` (resumen, orden de "Más del día", Cobrar, Dashboards);
  `fixtures/dashboard.ts` (`openDashboardMore`) para los specs de fichas, cumpleaños e inactivos.
  `loginAsDemo` ahora espera `dashboard-summary-appointments`.
