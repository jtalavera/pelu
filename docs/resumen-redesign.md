# Rediseño minimalista de "Resumen" (antes "Dashboards")

Quinta pantalla del rediseño web (rama `refactor/redesign-resumen`). Maqueta aprobada:
https://claude.ai/artifact/9pgMAvbZ7QcbiNbSbGjQoN

## Qué ve el usuario (`src/frontend/src/pages/DashboardsPage.tsx`)

- El menú y el título pasan a **Resumen** (el **Inicio** sigue siendo la pantalla operativa del día).
- **Período 7 / 30 / 90 días** con un selector arriba a la derecha. Vale para el gráfico principal y para
  el detalle. "Esta semana" y "Clientes este mes" no dependen del período.
- **Un solo gráfico principal, "Facturación"** (`components/charts/SummaryCharts.tsx`): el total del período
  en grande, barras por día (SVG), el día más alto resaltado, línea del promedio y una línea con el
  día/monto al tocar una barra. Sin facturación, una sola línea corta.
- **Ver más detalle** (plegado): *Servicios más vendidos* (top 5), *Medios de pago* (con el porcentaje de cada
  uno) y *Turnos por día de la semana*. Sin datos, una sola línea.
- Se quitaron las tarjetas plegables, los subtítulos largos y el gráfico de **propinas por profesional**
  (vive en la pantalla Propinas). Los gráficos de recharts anteriores se eliminaron.

## Backend

`GET /api/dashboard?days=7|30|90` (por defecto 30). Cualquier otro valor responde `400
INVALID_DASHBOARD_PERIOD`. La ventana (`DashboardService.build(tenantId, days)`) alimenta la tendencia, los
servicios más vendidos, los medios de pago y los turnos por día; `revenueTrendDays` devuelve el período usado.

## Tests

- JUnit: `DashboardServiceRevenueTrendTest` (la ventana sigue al período), `DashboardServicePeriodTest`.
- Vitest: `DashboardsPage.test.tsx`.
- Playwright: pendiente de la pasada final del rediseño (`dashboards-screen` e `issue-219…223`).

## Cambio relacionado: guardar una edición (Catálogo)

Al guardar la **edición** de un servicio, producto o profesional, el formulario se **cierra** y el mensaje de
éxito ("Cambios guardados correctamente") se muestra en la pantalla de la lista, igual que al crear
(`data-testid="catalog-update-success"`). Las categorías siguen mostrando el mensaje dentro de su formulario.


## Ajustes: indicadores que siguen el período y gráficos más claros
- **Indicadores** (bajo el título): "Facturado en 7 / 30 / 90 días" (suma de la facturación del período) y "Clientes
  atendidos en 7 / 30 / 90 días". Reemplazan a "Esta semana" y "Clientes este mes", que no cambiaban con el período. El
  servidor suma el campo `clientsInPeriod` a `GET /api/dashboard?days=` (clientes distintos con turnos reales en la misma
  ventana; `clientsThisMonth` sigue existiendo para Inicio). La cifra grande ya no se repite dentro de la tarjeta.
- **Facturación**: barras anchas y suaves con tres líneas de referencia (0, mitad, máximo), la mejor barra resaltada y una
  línea con el dato de la barra tocada ("Mejor día: …"). Con **90 días** se agrupa por **semana** (13 barras, la más
  reciente última) y el título pasa a "Facturación por semana". El promedio va en el subtítulo y se quita la línea punteada.
- **Ver más detalle**: botón propio y tres tarjetas separadas — **Servicios más vendidos** (nombre y monto + barra fina),
  **Medios de pago** (una barra apilada + leyenda con el porcentaje) y **Turnos por día de la semana** (siete columnas con
  el número arriba y el día abajo).
