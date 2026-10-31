# Propinas — rediseño minimalista

Parte del rediseño general. Una sola pantalla (`/app/propinas`) en lugar de las pestañas "Reporte de propinas" y "Retiro de propina".

- **Encabezado**: título y menú ⋯ con **Exportar PDF** (usa el período y el profesional elegidos).
- **Período**: chips **7 / 30 / 90 días** (30 por defecto). "Filtros" (plegado) tiene desde, hasta y profesional; al
  editar las fechas se apaga el chip y el resumen pasa a decir "en el rango".
- **Tarjetas por profesional** (solo activas): **propina acumulada** (saldo total retirable, `GET /api/propinas/balance`)
  y botón **Retirar** (apagado si el saldo es 0). Con el filtro de profesional solo queda su tarjeta.
- **Resumen del período**: "Propinas en N días" y "Retirado en N días" (`grandTotal` y `withdrawalsTotal` del reporte).
  No es lo mismo que el saldo acumulado.
- **Movimientos**: una lista compacta de una fila (~48 px) con fecha, `cliente · profesional` y monto; los retiros
  van en la misma lista con la etiqueta "Retiro" y signo menos, sin colores de alerta. "Ver más" muestra 15 más.
  Las propinas vienen del reporte y los retiros de `GET /api/propinas/withdrawals` (últimos 3 meses), filtrados al rango.
- **Retirar** (diálogo): saldo, monto, atajo **Retirar todo (Gs. …)**, validaciones ("mayor a cero", "no supera el
  saldo") y un solo botón. Al confirmar se cierra, se refrescan saldos y movimientos y un `Toast` de 4 s lo confirma.
- Sin cambios de backend.

## Tests
Vitest: `PropinasPage.test.tsx`. Los specs de Playwright de propinas se adaptan en la pasada final tras Configuración.
