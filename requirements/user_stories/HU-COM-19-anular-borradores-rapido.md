# HU-COM-19 · Anular borradores rápido desde Liquidar

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-19                 |
| **Módulo** | Comisiones (front y back) |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Continúa HU-COM-06 (liquidaciones, en el módulo base) y [HU-COM-17](HU-COM-17-resumen-profesionales-liquidaciones.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** anular uno o varios borradores directamente desde Liquidar, sin entrar al detalle ni escribir un motivo,  
**para** corregir una liquidación generada por error en dos toques.

---

## Contexto

Mockup aprobado: «Comisiones: anular borradores rápido». Hasta ahora había que entrar al detalle de la liquidación, abrir «⋯ › Anular» y escribir un motivo obligatorio; no se podía hacer a varias a la vez.

Decisiones de la administradora: **también en lote** y **motivo opcional**.

---

## Criterios de aceptación

1. **«Anular» en cada borrador** — La fila de una profesional en **Borrador** muestra «Anular» (borde rojo suave) junto a «Aprobar». Las filas Sin liquidar, Aprobada, Pagada y Sin movimientos no lo tienen: las aprobadas se corrigen desde el detalle.
2. **Confirmación corta** — «Anular» abre una confirmación con el nombre, la liquidación y el monto, y dice que sus comisiones vuelven a «Sin liquidar». Confirmar anula el borrador.
3. **Motivo opcional** — El motivo se puede dejar vacío. Se puede escribir o elegir con un toque entre «Se generó por equivocación», «Cambió una regla» y «Falta una venta»; si se carga, queda guardado en la liquidación anulada.
4. **Después de anular** — La profesional pasa sola a «Sin liquidar» (sus comisiones quedan libres), los tramos, subtotales y contadores se actualizan sin recargar y un aviso dice «Borrador anulado…» con **«Generar de nuevo»**, que abre la confirmación habitual de generar para esas profesionales. El total del período no cambia.
5. **En lote** — La casilla de la cabecera de cada tramo (Sin liquidar, Borrador, Aprobada) marca o desmarca a todas sus filas. Al marcar filas aparece una **barra de selección** («N seleccionadas · Gs. X») con «Anular borradores» y «Limpiar». «Anular borradores» actúa solo sobre las marcadas en Borrador, pide un único motivo opcional para todas y lista a quiénes anula; si había filas marcadas que no son borradores, la confirmación avisa que no cambian. Sin ningún borrador marcado el botón no aparece.
6. **Reglas del servidor** — `POST /api/commissions/settlements/{id}/void` acepta un motivo vacío cuando la liquidación está en **Borrador**; en una **Aprobada** el motivo sigue siendo obligatorio (`SETTLEMENT_VOID_REASON_REQUIRED`). Una liquidación pagada no se puede anular. La pantalla de detalle sigue la misma regla (motivo opcional en el borrador, obligatorio en la aprobada).
7. **Textos y estilo** — Todo en español e inglés, tema claro y oscuro, objetivos táctiles de al menos 44 px; la tabla de Liquidar sigue desplazándose dentro de su caja en el celular.

---

## Notas

- El botón «Anular» de la barra de selección convive con la barra de abajo («Con las seleccionadas: Generar · Aprobar · Pagar»), que no cambia.
- Anular no es reversible, pero las comisiones vuelven a «Sin liquidar» y se puede generar otra liquidación.
