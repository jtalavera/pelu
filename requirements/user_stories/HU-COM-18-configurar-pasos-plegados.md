# HU-COM-18 · Configurar con pasos plegados

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-18                 |
| **Módulo** | Comisiones (front y back) |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Continúa [HU-COM-16](HU-COM-16-configurar-grupos-y-servicios.md). No cambia el cálculo ni los valores que se configuran; cambia cómo se ve y cómo se resalta lo que falta.

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que Configurar me diga con una línea por paso cómo está cada cosa y me abra sola lo primero que falta,  
**para** saber qué hacer sin que me compitan varios bordes, cuadros y colores.

---

## Contexto

Mockup aprobado: «Comisiones: Configurar, resaltado de pasos» (opción C, pasos plegados). Qué molestaba: el paso 2 tenía un borde grueso siempre, haya o no algo pendiente; el paso 3, que sí tenía algo pendiente, no se destacaba; los pasos 1 y 4 no tenían el círculo con ✓ de los otros; y había tres señales a la vez (borde, número, cuadro amarillo).

Reglas: un paso se marca solo si tiene algo pendiente; todos tienen el mismo círculo; los bordes son todos iguales y finos; lo pendiente se dice con palabras («146 sin grupo»), no con un bloque de color.

---

## Criterios de aceptación

1. **Una línea por paso** — Configurar es una lista de cuatro pasos plegables. Cada fila tiene un círculo (✓ o su número), el título, **un resumen de una línea**, una etiqueta a la derecha y una flecha. Todos tienen el mismo borde fino.
2. **El círculo y la etiqueta dicen cómo está** — **✓ verde + «Al día»**: configurado. **Número ámbar + qué falta** («N sin grupo», «N sin reglas», «Nadie retiene todavía»): pendiente. **Número gris + «Opcional»**: no hay nada para hacer.
3. **Resúmenes** — Paso 1: «Con IVA · 0 % servicios · 10 % productos · liquidación mensual». Paso 2: «12 grupos · 40 de 186 servicios ya tienen grupo». Paso 3: «Cuánto cobra cada profesional en cada grupo». Paso 4: según el aguinaldo (criterio 6).
4. **Se abre solo el primero que falta** — Al entrar, el primer paso pendiente aparece abierto y los demás plegados; si no falta nada, todos quedan plegados. Cada paso se abre y se cierra tocándolo o con el teclado (Enter/Espacio), con `aria-expanded`. Un paso que se arregló mientras está abierto no se cierra solo.
5. **Un solo botón principal** — El paso pendiente abierto lleva el único botón relleno («Ordenar grupos y servicios» en el paso 2, «Ir al equipo» en el 3); en cualquier otro paso abierto el botón es secundario.
6. **Paso 4 según el aguinaldo** — Aguinaldo desactivado: gris «Opcional» («Aguinaldo desactivado · el costo de producto va para la profesional»), no cuenta como pendiente. Activado y alguna profesional retiene: ✓ verde «Al día» («Retiene 5 % por defecto · 4 de 12 profesionales retienen · …»); que otras no retengan es normal y no se marca. Activado y **nadie retiene**: ámbar «Nadie retiene todavía» y cuenta como pendiente.
7. **Contador del menú** — El número de «Configurar» cuenta los pasos pendientes: grupos (2), reglas (3) y aguinaldo activo sin nadie que retenga (4). Se actualiza al cambiar sin recargar.
8. **Dentro de cada paso** — Paso 1 y 4: sus filas con «Cambiar» (y en el 4, «Quién retiene para aguinaldo»); paso 2: texto con la cantidad sin grupo, los grupos como atajos, el botón principal y «Ver los N sin grupo»; paso 3: quiénes faltan y «Ir al equipo». Cambiar un valor deja el paso abierto y actualiza su resumen.
9. **Excepciones y programados a mano** — Al final, siempre visible, el bloque «Excepciones por servicio o producto» con «Ver excepciones» y «Cambios programados e historial», y la cantidad de cambios programados («1 cambio programado»).
10. **API** — `GET /api/commissions/overview` agrega `professionalsRetaining`: profesionales activas con retención de aguinaldo mayor a cero.
11. **Textos y estilo** — Todo en español e inglés, tema claro y oscuro, objetivos táctiles de al menos 44 px, sin scroll horizontal en el celular.

---

## Notas

- Se quitan las tres «fichas» numéricas del paso 2; el mismo dato va en el resumen y en la etiqueta.
- El buscador de Configurar no cambia.
