# HU-COM-17 · Resumen claro de profesionales y liquidaciones

| Campo      | Valor                         |
| ---------- | ----------------------------- |
| **ID**     | HU-COM-17                     |
| **Módulo** | Comisiones (front y back)     |
| **Estado** | `In Progress`                 |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Continúa [HU-COM-15](HU-COM-15-comisiones-experiencia-rediseno.md). Funcionalmente es lo mismo (no cambia el cálculo ni las liquidaciones); cambia qué se muestra y cómo se explica.

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** ver a todas mis profesionales y entender en un vistazo cuánta plata está pagada, cuánta falta y en qué paso está cada una,  
**para** no pensar que faltan profesionales ni quedarme con un total que no sé cómo leer.

---

## Contexto

Mockup aprobado: «Comisiones: resumen de profesionales y liquidaciones». Qué confundía: «Inicio» y «Liquidar» mostraban solo a las profesionales con comisiones en el período («7 profesionales» aunque el salón tuviera más); «A pagar» sumaba todo el período, incluso lo ya pagado; la barra de colores no tenía leyenda y repartía personas, no plata; y no se veía cuánto dinero había en cada paso.

Decisiones de la administradora: las profesionales **«Sin movimientos» van al final** de Liquidar, solo con el texto «No tiene ventas este período» (sin «último período con comisiones») y las **inactivas siguen sin aparecer**.

---

## Criterios de aceptación

1. **Todas las activas en Liquidar** — Liquidar lista a **todas** las profesionales activas (más cualquier inactiva que tenga una liquidación en el período), aunque no tengan comisiones. Una línea arriba lo dice: «Se muestran las N profesionales activas. X tienen comisiones este período; las otras Y no tienen nada para liquidar (están al final)».
2. **Orden y tramos** — Se agrupan por lo que falta hacer: Sin liquidar → Borrador → Aprobada → Pagada → **Sin movimientos** (al final). Cada tramo tiene su cabecera con la cantidad y el subtotal («Gs. X por generar / por aprobar / por pagar / ya cobrado»; «Nada para liquidar en este período»). Un filtro propio «Sin movimientos · N» y «Todas · N» cuentan a todas.
3. **Qué hay detrás de cada fila** — Debajo del nombre: «N movimientos» (sin liquidar), «Liquidación #N» (borrador o aprobada) o «Pagada el …». Una profesional sin movimientos muestra «No tiene ventas este período» (y «sin reglas propias (usa el % por defecto)» si no tiene reglas); sin monto («—»), sin casilla de selección y sin acción.
4. **Plata en cada paso** — Los tres pasos de Liquidar muestran cuántas profesionales y cuánto dinero hay en cada uno. El encabezado de la lista dice «Total del período: Gs. X · ya pagado Gs. Y».
5. **Inicio: pagado y por pagar** — El resumen muestra el total del período («de N profesionales con comisiones»), y dos bloques: **«Ya pagado»** (monto y cuántas profesionales) y **«Falta pagar»** (sin liquidar + borrador + aprobada, monto y cuántas). Ya no existe un único «A pagar».
6. **Barra con leyenda** — La barra reparte **el dinero** del período por estado (el ancho es proporcional a la plata) y trae una leyenda con el color, el estado y el monto de cada uno, con los mismos colores que los pasos de abajo.
7. **«Qué falta hacer»** — Cuatro tarjetas (Sin liquidar, Borrador, Aprobada, Pagada) con la cantidad de profesionales, el dinero («Gs. X por generar / por aprobar / por pagar / ya cobrado») y la acción siguiente (Generar, Aprobar, Pagar, Ver pagos) que lleva a Liquidar filtrado por ese estado; un paso sin nadie dice «Nada por hacer». Reemplaza a «Continuar con la liquidación» y «¿Cómo funciona?».
8. **«Tu equipo» completo** — Dice «N profesionales activas · X con comisiones · Y sin movimientos» y muestra una barra proporcional; lista a las que tienen comisiones (con monto y estado) y, aparte, nombra a las que no tienen movimientos con «Ver las Y» (lleva a Liquidar › Sin movimientos).
9. **Equipo** — Muestra la misma cuenta, el estado de cada profesional (también «Sin movimientos», con monto «—» y «No tiene ventas este período»), el detalle de su estado («N movimientos · falta generar», «Borrador: falta aprobar», «Lista para pagar», «Pagada el …») y los filtros Todas · Con comisión pendiente · Pagadas · Sin movimientos · Sin reglas (· Retienen aguinaldo).
10. **Celular** — Inicio y Liquidar sin scroll horizontal: las tarjetas de pasos y los bloques se apilan.
11. **API** — `GET /api/commissions/overview` agrega a cada fila `lineCount` (movimientos detrás del monto) y `paidOn` (día de pago de las liquidaciones pagadas). Las filas ya incluían a todas las activas.
12. **Textos y estilo** — Todo en español e inglés, tema claro y oscuro, objetivos táctiles de al menos 44 px.

---

## Notas

- «Sin movimientos» = sin comisiones sin liquidar ni liquidación en el período (no significa inactiva).
- El total de Inicio suma las filas del período (lo pagado + lo pendiente).
