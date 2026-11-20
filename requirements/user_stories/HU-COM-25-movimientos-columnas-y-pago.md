# HU-COM-25 · Movimientos en columnas, orden desde la columna Fecha y filtro de pago

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-25                 |
| **Módulo** | Comisiones (front)        |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Continúa [HU-COM-23](HU-COM-23-movimientos-orden-y-retencion.md) y [HU-COM-24](HU-COM-24-retencion-en-la-ficha.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** leer los movimientos de comisiones en columnas, ordenarlos desde la columna Fecha y filtrarlos por pagados o sin pagar,  
**para** encontrar lo que me falta pagar y entender cada línea de un vistazo.

---

## Contexto

Mockup aprobado: «Comisiones: Movimientos en columnas y filtro de pago», opción A (siete columnas, sin lista «Ordenar» porque se ordena desde la columna Fecha). El pedido decía «propina pagada o sin pagar»; se interpretó, y la administradora lo confirmó, como **comisión** pagada o sin pagar. No cambia ningún cálculo ni ninguna API: la lista ya llega completa y se ordena, filtra y pagina en pantalla.

---

## Criterios de aceptación

1. **Siete columnas** — Fecha (día y hora) · Ítem (con el comprobante debajo) · Profesional · Tipo (Comisión, Reversión…, Ajuste manual) · Cálculo · Estado · Monto. En el monto sigue el menú «⋯» de «Cambiar profesional» donde corresponde.
2. **El cálculo explica la retención** — Con retención dice «Servicio 50 % → 45 %» y debajo «Retención 5 % · Gs. 5.000» (la reversión, en negativo); sin retención, solo el % y, si lo hay, el costo de producto.
3. **Se ordena desde la columna Fecha** — Ya no hay lista «Ordenar». El encabezado «FECHA» es un botón (subrayado, con la flecha siempre visible, de al menos 44 px): ↓ de lo más reciente a lo más antiguo (por defecto) y ↑ al revés. El estado también está dicho para lectores de pantalla. Al cambiarlo vuelve a la primera página y vale para toda la lista.
4. **Filtro «Pago»** — Tres botones siempre visibles entre la búsqueda y la lista: **Todas · Sin pagar · Pagadas**, cada uno con su cantidad. «Pagadas» es lo ya pagado en una liquidación; «Sin pagar» junta Sin liquidar, Borrador y Aprobada (cada fila sigue diciendo cuál es). Por defecto: Todas.
5. **Se combina** — El filtro de pago se combina con la búsqueda, el rango de fechas, las profesionales y el orden; las cantidades de cada botón cuentan sobre lo ya buscado; al cambiarlo vuelve a la primera página.
6. **Pie con totales** — Debajo de la lista, «Total» (suma de los montos de todo lo que se ve, de todas las páginas) y «Retenido» (solo si hay retención), que se recalculan con el filtro.
7. **Celular** — Sin columnas: cada movimiento es una tarjeta (ítem y monto arriba, y debajo la profesional, la fecha, el tipo, el estado y el cálculo), sin encabezado. El orden es un botón «Fecha · más recientes primero ↓»; el filtro de pago son tres botones de al menos 44 px. Sin desbordes.
8. **Textos y estilo** — Español e inglés, tema claro y oscuro. También rige en la solapa «Movimientos» de cada profesional (usa la misma lista).
