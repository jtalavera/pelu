# Propinas — rediseño minimalista

Parte del rediseño general. Una sola pantalla (`/app/propinas`) en lugar de las pestañas "Reporte de propinas" y "Retiro de propina".

- **Encabezado**: título y menú ⋯ con **Exportar PDF** (usa el período y el profesional elegidos).
- **Período**: chips **7 / 30 / 90 días** (30 por defecto). "Filtros" (plegado) tiene desde, hasta y profesional; al
  editar las fechas se apaga el chip y el resumen pasa a decir "en el rango".
- **Saldos compactos** (solo profesionales activas): una sola tarjeta con una fila por profesional (inicial, nombre,
  **propina acumulada** y **Retirar**, apagado si el saldo es 0), ordenadas de mayor a menor saldo y **paginadas de a 5**
  (pie `1–5 de 12 profesionales` con ‹ ›). Con el filtro de profesional solo queda su fila. El saldo acumulado
  (`GET /api/propinas/balance`) no es lo mismo que las propinas del período.
- **Movimientos**: una **tabla** (Fecha · Concepto · Profesional · Monto) con filas de 44 px y **paginación** estándar
  (filas por página 5/10/20, "1–10 de N", Anterior/Siguiente); ya no hay "Ver más". Los retiros van en la misma tabla con
  la etiqueta "Retiro" y signo menos. Los totales del período ("Gs. X propinas · Gs. Y retirado · en N días") van en una
  línea junto al título (las propinas del período son las brutas: el `grandTotal` del reporte es neto —propinas menos retiros del período— así que se calcula `grandTotal + withdrawalsTotal`). Las propinas vienen del reporte y los retiros de `GET /api/propinas/withdrawals` (últimos
  3 meses), filtrados al rango. En celular la tabla se desliza horizontalmente.
- **Retirar** (diálogo): saldo, monto, atajo **Retirar todo (Gs. …)**, validaciones ("mayor a cero", "no supera el
  saldo") y un solo botón. Al confirmar se cierra, se refrescan saldos y movimientos y un `Toast` de 4 s lo confirma.
- Sin cambios de backend.

## Tests
Vitest: `PropinasPage.test.tsx`. Los specs de Playwright de propinas se adaptan en la pasada final tras Configuración.

## Ajuste: período y filtros dentro de Movimientos
- Los chips 7 / 30 / 90 días y "Filtros" (desde, hasta, profesional) pasan a la tarjeta **Movimientos**, encima de la lista, porque solo filtran esa lista.
- **Saldos** tiene título y la leyenda "Propina acumulada a hoy · no cambia con el período"; ya no lo afecta ningún filtro (tampoco el de profesional) y sigue paginado de a 5.
- Movimientos muestra una etiqueta con lo aplicado (`Últimos 30 días · Todas las profesionales`, o el rango y la profesional elegidos). Los `data-testid` se mantienen; se agregan `propinas-balances-caption` y `propinas-active-filter`.
