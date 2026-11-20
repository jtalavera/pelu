# HU-COM-22 · «Para revisar» como un solo panel de filas

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-22                 |
| **Módulo** | Comisiones (front)        |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). **Reemplaza los criterios 1 a 5 de [HU-COM-21](HU-COM-21-inicio-para-revisar-y-sin-grupo.md)** (las tarjetas de «Para revisar»); lo demás de HU-COM-21 («Sin grupo») sigue vigente.

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que «Para revisar» sea un panel de filas que ocupe todo el ancho y diga sin rodeos qué pasa y qué hacer,  
**para** no tener tarjetas con huecos, textos partidos ni un «0 %» que parece normal cuando en realidad no se paga nada.

---

## Contexto

Mockup aprobado: «Comisiones: Para revisar, opciones», opción A. Con las tarjetas de HU-COM-21 y dos avisos quedaba un hueco a la derecha, el «0 %» se partía en dos líneas, la franja de color se curvaba con la esquina y «Pagan el % general… 0 %» sonaba a normal cuando 0 % significa que no se cobra comisión. No cambia ningún cálculo ni ninguna API.

---

## Criterios de aceptación

1. **Un solo panel, una fila por aviso** — «Para revisar» es un panel de ancho completo con una fila por aviso: ícono en un recuadro de color, el número una sola vez seguido de la frase («20 líneas de venta sin profesional»), una línea con la consecuencia y el botón a la derecha. Ya no hay etiqueta de consecuencia ni el texto «N cosas, de lo que más afecta…» arriba. Solo aparecen los avisos que existen; si no hay ninguno dice «Todo en orden».
2. **Orden y color por tipo** — De lo que más afecta la plata a lo que menos: líneas sin profesional (ámbar), grupos sin su propio % (verde azulado; ámbar si el % general es 0 %) y liquidaciones en borrador (gris).
3. **Un solo botón relleno** — Solo la primera fila lleva el botón relleno; las demás, de borde. Los botones siguen llevando adonde llevaban («Asignar profesional», «Poner los %», «Revisar borradores»).
4. **El % general, sin rodeos** — La fila de grupos dice «Hoy cobran el % general de servicios: N %» con el % vigente. Si es **0 %** dice **«Hoy no pagan comisión: el % general de servicios es 0 %»** en ámbar. Si no se pudo leer, dice «Hoy cobran el % general de servicios» sin número. El número y el signo % nunca se separan en dos líneas.
5. **Singular y plural** — «1 línea…», «1 grupo sin su propio %», «1 liquidación en borrador» (con su ayuda en singular) frente a los plurales.
6. **Celular y accesibilidad** — En pantalla angosta la fila se apila sin desbordar, el botón mide al menos 44 px, los íconos son decorativos y todo está en español e inglés, en tema claro y oscuro.
