# HU-COM-21 · «Para revisar» en tarjetas claras y «Sin grupo» que se entienda

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-21                 |
| **Módulo** | Comisiones (front)        |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Continúa [HU-COM-15](HU-COM-15-comisiones-experiencia-rediseno.md), [HU-COM-16](HU-COM-16-configurar-grupos-y-servicios.md) y [HU-COM-20](HU-COM-20-comisiones-reglas-simples.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que los avisos de «Para revisar» y la vista «Sin grupo» digan con claridad qué pasa, qué consecuencia tiene y qué hacer,  
**para** resolverlos sin tener que interpretar números repetidos, textos largos ni colores de alarma.

---

## Contexto

Mockup aprobado: «Comisiones: Para revisar» (variante B, tarjetas; y tablero C, «Sin grupo»). Problemas de antes:

- En «Para revisar» el número aparecía dos veces («20» y «20 líneas sin profesional»), la consecuencia estaba en letra chica («Pagan el % general (0 % si no lo cambiaste)») y los botones eran del mismo tono pálido que el fondo.
- En «Grupos y servicios › Sin grupo» el contador (1247) no entraba en su círculo, la lista decía «Les falta regla» (ya no es cierto desde HU-COM-20: pagan el % general), todo se veía como una alarma ámbar y cada fila repetía la etiqueta «Sin grupo».

No cambia ningún cálculo ni ninguna API: solo cómo se muestra.

---

## Criterios de aceptación

1. **Tarjetas de «Para revisar»** — En Inicio, cada aviso es una tarjeta con una franja de color arriba, una **etiqueta** con la consecuencia, **el número una sola vez, grande**, seguido de la frase («20 líneas de venta sin profesional»), una línea de ayuda y un botón con verbo + objeto («Asignar profesional», «Poner los %», «Revisar borradores»). Solo aparecen los avisos que existen; si no hay ninguno dice «Todo en orden».
2. **Orden y colores por tipo** — Van de lo que más afecta la plata a lo que menos: líneas sin profesional (ámbar, «No generan comisión»), grupos sin su propio % (verde azulado, «Pagan el % general») y liquidaciones en borrador (gris, «Sin pagar todavía»). Un texto arriba cuenta cuántas cosas hay.
3. **Un solo botón relleno** — Solo la primera tarjeta lleva el botón relleno (lo primero por hacer); las demás llevan botón de borde.
4. **El % general, con su valor real** — La tarjeta de grupos sin su % dice «Hoy cobran el % general de servicios: N %» con el % general vigente. Si no se pudo leer, dice lo mismo sin número (nunca un número inventado).
5. **Singular y plural** — «1 línea de venta…», «1 grupo sin su propio %», «1 liquidación en borrador» (y su ayuda en singular) frente a los plurales.
6. **«Sin grupo» ya no es una alarma** — En la lista de «Grupos y servicios», «Sin grupo» se ve como cualquier otro grupo (sin ámbar), con la leyenda **«Pagan el % general»**, y su cantidad va en una **píldora que crece** con el número y lleva separador de miles (1.247), sin cortarse.
7. **Cabecera con qué hay** — El detalle de «Sin grupo» dice «N ítems · N servicios · N productos» y, debajo, qué pagan: «Pagan el % general: servicios X %, productos Y %. Podés dejarlos así o armar grupos para darles otro %.» (sin números si no se pudo leer).
8. **Filtro por tipo** — «Todos N», «Servicios N» y «Productos N» (con botones de al menos 44 px y estado marcado) muestran todo, solo servicios o solo productos. Los contadores de la píldora y de la cabecera siguen hablando de todo lo que no tiene grupo. Cambiar de grupo vuelve a «Todos».
9. **Filas sin repetir** — Dentro de «Sin grupo» las filas no repiten la etiqueta «Sin grupo»; cada una muestra nombre, detalle y un solo control, «Elegir grupo». En una búsqueda sí dicen en qué grupo está cada una, y una fila recién asignada se marca con ✓ y el nombre del grupo.
10. **Asignar en lote se mantiene** — Al marcar varias filas sigue apareciendo la barra «N seleccionados · Asignar a …» para moverlas de una vez a un grupo.
11. **Textos y estilo** — Todo en español e inglés, tema claro y oscuro, objetivos táctiles de al menos 44 px y sin desbordes en el celular.
