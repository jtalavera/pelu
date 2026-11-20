# HU-COM-28 · Liquidar más simple: una pestaña por etapa

| Campo      | Valor              |
| ---------- | ------------------ |
| **ID**     | HU-COM-28          |
| **Módulo** | Comisiones (front) |
| **Estado** | `In Progress`      |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Reemplaza el diseño de «Liquidar» de [HU-COM-15](HU-COM-15-experiencia-rediseno.md) y [HU-COM-17](HU-COM-17-resumen-profesionales-liquidaciones.md) (opción B del mockup aprobado).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que «Liquidar» muestre una sola lista por vez, con una pestaña por etapa (generar, aprobar, pagar) y sin carteles repetidos,  
**para** ver de un vistazo qué falta hacer y hacerlo con un solo botón, sin leer tres tarjetas, seis filtros, encabezados de grupo y avisos que dicen lo mismo.

---

## Contexto

La pantalla repetía el estado de cada profesional tres veces (tarjeta del paso, píldora de filtro y encabezado de grupo, además de la etiqueta de cada fila) y sumaba avisos («Se muestran las 12 profesionales activas…», la periodicidad, los textos de ayuda de cada paso). Solo cambia cómo se muestra: ningún cálculo, regla ni API, y las ventanas de generar / aprobar / pagar / anular son las mismas.

---

## Criterios de aceptación

1. **Pestañas por etapa** — Cuatro pestañas con su cantidad: «Por generar», «Por aprobar», «Por pagar» y «Pagadas». Abre en la etapa que toca hacer (la primera con pendientes; si no queda nada, «Pagadas») y solo se ven las filas de la pestaña abierta. `?state=` abre esa pestaña.
2. **Un botón principal por etapa** — Arriba de la lista: «N profesionales · Gs. X» y el botón «Generar N» / «Aprobar N» / «Pagar N», que actúa sobre las marcadas o, si no hay marcadas, sobre todas las de la pestaña. «Pagadas» no tiene botón.
3. **Sigue sola** — Después de una acción, si la pestaña abierta se queda sin filas pasa a la etapa que toca; si aún quedan, se queda.
4. **Sin carteles de más** — No hay aviso de «Se muestran las N profesionales activas», ni título «Profesionales del período», ni textos de ayuda de los pasos, ni tarjetas de paso. La periodicidad del período se abre con un «ⓘ» junto al período.
5. **Totales** — «Total» y «ya pagado» arriba a la derecha, como antes.
6. **Filas** — Nombre (lleva a su ficha), una línea corta debajo (movimientos / «Liquidación #N», que lleva al detalle / «Pagada el …»), comisión, retenido y un solo botón de acción (Generar, Aprobar, Pagar, Ver). Las filas en Borrador agregan «⋯» con «Anular». No hay etiqueta de estado en la fila ni enlace «Detalle» aparte.
7. **Sin movimientos** — Quienes no tienen nada para liquidar no son filas: una línea al pie dice «N sin movimientos ⌄» y, al abrirla, muestra sus nombres. El enlace de «Tu equipo» en Inicio la abre directamente.
8. **Selección y CSV** — Una casilla en el encabezado marca a todas las de la pestaña; la barra de selección (con «Anular borradores») y «Descargar CSV» siguen igual.
9. **Pestaña vacía** — Dice «Nada por generar/aprobar/pagar en este período ✓» (o «Todavía no hay liquidaciones pagadas…» en Pagadas) y su botón principal queda deshabilitado.
10. **Celular** — Las pestañas se desplazan a los lados, la tabla vive en un contenedor con scroll horizontal y la página no se desborda.
11. **Textos y estilo** — Español e inglés, tema claro y oscuro, botones de al menos 44 px.

---

## Fuera de alcance

- Cambios en los cálculos, en las ventanas de confirmación o en los permisos.
