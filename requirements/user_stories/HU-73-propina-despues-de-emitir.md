# HU-73 · Propina después de emitir el comprobante

| Campo      | Valor                          |
| ---------- | ------------------------------ |
| **ID**     | HU-73                          |
| **Módulo** | Facturación / Propinas / Caja  |
| **Estado** | `In Progress`                  |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** persona que cobra en la peluquería,  
**quiero** poder registrar la propina de las profesionales después de emitir el comprobante, si no lo hice antes,  
**para** que el dinero entre a la caja con la forma de pago real y llegue al acumulado de cada profesional.

---

## Contexto

Hasta ahora las propinas solo se cargaban al emitir el comprobante (se cobran junto con sus pagos). Si el cliente dejaba la propina después, no había cómo registrarla con su forma de pago ni que entrara a la caja. Una propina cargada después **no modifica la factura, sus pagos ni el envío a SIFEN**.

---

## Criterios de aceptación

1. **Solapa «Propinas» en «Comprobante emitido»** — La pantalla que aparece al emitir muestra una solapa «Propinas» plegada, debajo del resumen. Mientras no haya propinas registradas y alguna profesional haya atendido un ítem, la solapa se resalta (borde y fondo teal, etiqueta «Pendiente» y la pregunta «¿El cliente dejó propina?»). Con propinas registradas se ve normal con «N registradas». Si el comprobante está anulado no se muestra.

2. **Formulario por profesional** — Al desplegarla con propina pendiente aparece una fila por profesional que atendió, con monto y «¿Cómo se pagó?» (Efectivo, Tarjeta de débito, Tarjeta de crédito, Transferencia, Otro). Con tarjeta se pide la marca (y su descripción si es «Otro»). «+ Otra profesional» suma una fila para elegir a cualquier profesional activa. Las filas sin monto se ignoran; hay que cargar al menos una, con monto mayor a 0.

3. **La propina entra a la caja abierta** — «Registrar propinas» guarda todas juntas (o ninguna) en la caja que está abierta en ese momento. Lo cobrado en efectivo suma al efectivo esperado; todo suma en «Cobros por método»; y en «Movimientos» de la caja aparece como «Propina cobrada» (con la nota de cuánto de cada método son propinas).

4. **Sin caja abierta** — Si no hay caja abierta se avisa «No hay caja abierta», el formulario queda deshabilitado y hay un botón «Ir a Caja». Si la caja se cierra mientras tanto, el servidor lo rechaza con un mensaje traducido.

5. **Propinas registradas en solo lectura** — Las propinas registradas se listan con forma de pago, fecha, hora y usuario, y no se editan; se pueden agregar más con «+ Agregar otra propina». Las cobradas al emitir se listan sin acciones.

6. **Acumulado y pantalla de Propinas** — La propina suma al acumulado de la profesional y aparece en «Movimientos» de la pantalla de Propinas con su concepto (cobrada después de emitir, forma de pago, comprobante y quién la cargó).

7. **Detalle del comprobante** — El detalle de un comprobante emitido muestra la misma solapa, neutra: «Sin propinas» o «N registradas». Desde ahí también se pueden agregar propinas.

8. **Quién puede** — Cualquier usuario que puede emitir comprobantes puede registrar propinas. Solo el administrador de la peluquería ve y puede usar «Anular».

9. **Anulación** — El administrador anula una propina cargada después (desde el detalle del comprobante o desde la pantalla de Propinas) indicando un motivo obligatorio (hasta 200 caracteres). La propina queda en la lista como «Anulada» (con quién y por qué), tachada, y deja de contar en la caja y en el acumulado de la profesional. No se puede deshacer.

10. **Cuándo no se puede anular** — No se puede anular si la profesional ya retiró ese dinero, ni si la caja en la que se cobró ya está cerrada (una caja cerrada no cambia sus cifras).

---

## Notas

- Backend: tabla `invoice_late_tips` (V99); `GET/POST /api/invoices/{id}/tips` y `POST /api/propinas/late/{id}/void` (solo administrador).
- Las propinas cobradas al emitir forman parte de los pagos del comprobante: no se anulan desde acá.
