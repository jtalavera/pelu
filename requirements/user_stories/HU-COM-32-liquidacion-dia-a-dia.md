# HU-COM-32 · Liquidación: el detalle día a día

| Campo      | Valor                |
| ---------- | -------------------- |
| **ID**     | HU-COM-32            |
| **Módulo** | Comisiones (front)   |
| **Estado** | `In Progress`        |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Lleva a la liquidación el criterio de [HU-COM-29](HU-COM-29-movimientos-lineas-revertidas.md) (una fila por venta) y reemplaza el «Detalle por línea» y los «Subtotales por tipo e ítem» de HU-COM-06 (ver el [PRD del módulo](../prds/femme_modulo_comisiones_v1.md)) (opción G del mockup aprobado).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** abrir una liquidación y ver de dónde sale el total (servicios, productos y ajustes), y recorrer el detalle día por día con las ventas recalculadas en una sola fila,  
**para** entender el monto sin sumar a mano, sin que los importes aparezcan corridos y sin confundirme con las reversiones.

---

## Contexto

La pantalla de la liquidación tenía: los montos del detalle corridos (el ⋮ solo aparece en las líneas que se pueden reasignar), las ventas recalculadas como tres filas sueltas (original, reversión y nueva), y unos «Subtotales por tipo e ítem» plegados cuyos números no cerraban con el total (no incluían los ajustes). Solo cambia cómo se muestra: **los importes, el total, la retención y el costo de producto son los mismos**, y la API no cambia.

---

## Criterios de aceptación

1. **Composición del total** — Debajo del total, una barra y su leyenda: «Servicios», «Productos» y «Ajustes», cada uno con su cantidad («N líneas» / «N ajustes») y su monto. Solo aparecen los que tienen movimientos; los tres suman el total de la liquidación. Un ajuste negativo se ve rojo.
2. **Día a día** — El detalle se agrupa por día (hora de Paraguay), del más antiguo al más nuevo. Cada día es una tarjeta con «Total del día» (ventas netas + ajustes) y, a la izquierda, el día y el mes sobre una línea de tiempo.
3. **Una fila por venta** — Las filas de una misma línea de factura (original, reversión y comisión nueva) se muestran como UNA: la comisión vigente, con la etiqueta de por qué cambió («Recalculada», «Reasignada», «Anulada»…) y «antes 40 %». «Ver cambios · N filas» abre el recorrido (comisión inicial → reversión «anula el paso N» → comisión actual) con el neto de la venta, igual que en Movimientos. Una venta sin comisión vigente (comprobante anulado) dice «Anulada» y vale Gs. 0.
4. **Montos alineados** — Base, %, comisión y el lugar del ⋮ van en columnas fijas: los montos quedan alineados haya o no ⋮ en la fila.
5. **Ajustes en su día** — Cada ajuste aparece en el día en que se cargó, con la etiqueta «Ajuste» y su monto con signo, y suma al total del día. «Agregar ajuste» es un botón junto a «Aprobar» y «Descargar PDF» (solo en borrador).
6. **Se van los subtotales** — Desaparece «Subtotales por tipo e ítem»: la composición del criterio 1 lo reemplaza.
7. **Cambiar profesional** — Solo en la comisión vigente de una liquidación en borrador; no en el original ni en la reversión, ni en liquidaciones aprobadas o pagadas.
8. **Lo demás no cambia** — Estado, período, total, retención y costo de producto (en el encabezado y en cada fila), datos de pago, anulación, «Aprobar», «Marcar como pagada», «Descargar PDF», «Más acciones» y el «Historial de estados» plegable.
9. **Celular** — La tarjeta del día lleva su fecha como título; el cálculo («Gs. 100.000 × 40 % · sin IVA») va debajo del ítem; «Ver cambios» mide al menos 44 px y nada desborda la pantalla.
10. **Textos y estilo** — Español e inglés, tema claro y oscuro.
11. **API** — Sin cambios: `GET /api/commissions/settlements/{id}` devuelve lo mismo.

---

## Fuera de alcance

- Cambiar el PDF de la liquidación.
- Reordenar o filtrar el detalle.
