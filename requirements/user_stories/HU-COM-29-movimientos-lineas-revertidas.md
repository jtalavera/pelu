# HU-COM-29 · Movimientos: las líneas revertidas se entienden

| Campo      | Valor                      |
| ---------- | -------------------------- |
| **ID**     | HU-COM-29                  |
| **Módulo** | Comisiones (front + datos) |
| **Estado** | `In Progress`              |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Reemplaza el orden «la reversión sobre su línea» de [HU-COM-23](HU-COM-23-movimientos-orden-y-retencion.md) (opción A del mockup aprobado).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que una venta cuya comisión cambió se vea como una sola fila con la comisión que vale, y poder abrir qué pasó,  
**para** no ver tres filas casi iguales («Sin liquidar», mismo ítem, mismo día) y no saber cuál vale ni cuál anula a cuál.

---

## Contexto

Una venta recalculada (por ejemplo de 40 % a 50 %) deja tres filas guardadas: la comisión original, su reversión y la comisión nueva. Lo mismo pasa al cambiar de profesional, al corregir o al anular el comprobante. La lista las mostraba sueltas, con la misma fecha y el mismo ítem, sin decir cuál vale. Solo cambia cómo se muestra: **los importes, el saldo y los totales son los mismos** (la reversión sigue existiendo y resta lo anulado). El único dato nuevo es que cada fila expone la línea de factura a la que pertenece (`invoiceLineId`).

---

## Criterios de aceptación

1. **Una fila por venta** — Las filas de una misma línea de factura (original, reversión/es y comisión nueva) se muestran como una sola: la comisión vigente, con una etiqueta que dice por qué cambió («Recalculada», «Reasignada», «Anulada», «Corregida») y debajo del cálculo lo que había antes («antes 40 %», «antes Ana»).
2. **Ver cambios** — «Ver cambios · N filas» abre el recorrido, de la más antigua a la vigente: comisión inicial (Revertida, tachada) → reversión (con su motivo y «anula el paso N») → comisión actual (Vigente), con el neto de la venta. Se cierra con «Ocultar cambios».
3. **Venta anulada** — Si no queda comisión vigente (comprobante anulado) la fila dice «Anulada», «comprobante anulado», Gs. 0 y el recorrido aclara «No hay comisión vigente».
4. **Interruptor** — «Mostrar también las líneas revertidas» abre el recorrido de todas las ventas a la vez.
5. **Lo demás no cambia** — Las ventas sin cambios, los ajustes manuales y los traslados de saldo siguen como filas sueltas, sin etiqueta ni «Ver cambios».
6. **Totales y filtros por venta** — El pago (Todas / Sin pagar / Pagadas) y su cantidad, el orden por fecha, la paginación y el pie cuentan ventas; el pie suma el neto y dice cuántas tuvieron cambios.
7. **Cambiar profesional** — Solo en la comisión vigente; el original y la reversión no se pueden reasignar.
8. **Celular** — La tarjeta muestra la etiqueta y «Ver cambios», y el recorrido se lee sin desbordar la pantalla.
9. **Textos y estilo** — Español e inglés, tema claro y oscuro, botones de al menos 44 px.
10. **API** — Cada fila de `GET /api/commissions/entries` incluye `invoiceLineId`; ningún importe cambia.

---

## Fuera de alcance

- El detalle de una liquidación y los reportes, que ya muestran las filas revertidas marcadas.
