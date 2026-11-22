# HU-AST-08 · Crear y editar fichas de servicio desde el chat

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **ID**     | HU-AST-08                                                                          |
| **Módulo** | Asistente conversacional                                                           |
| **Estado** | `In Progress`                                                                      |
| **Flag**   | `ASSISTANT_CHATBOT`                                                                |
| **Diseño** | [Diseño de fichas desde el chat](../../docs/superpowers/specs/2026-11-22-asistente-fichas-design.md) |
| **Plan**   | [Plan de implementación](../../docs/superpowers/plans/2026-11-22-asistente-fichas.md) |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administradora o profesional del salón,  
**quiero** abrir o cambiar la ficha de servicio de una clienta conversando con el asistente,  
**para** dejar la ficha al día sin salir del chat, viendo solo los datos que mi rol autoriza.

---

## Contexto

Principio de todo el asistente: **el modelo propone, la persona confirma**. Pedir una ficha deja una **tarjeta** con el resultado (lo agregado, lo quitado, lo cambiado); la ficha solo se crea o cambia al tocar «Guardar ficha», con los **mismos servicios** que la pantalla de Fichas. Ninguna herramienta escribe una ficha.

- **Administradora:** crea fichas con o sin turno, edita cualquier ficha abierta y puede fijar precios. Ve los montos.
- **Profesional:** solo crea una ficha **desde un turno propio** y edita las fichas **abiertas de hoy**; solo servicios y cantidades. **Nunca ve ni fija montos**: tampoco en el chat (ni en las respuestas, ni en la tarjeta, ni al recargar).
- Al crear una ficha para una clienta con turno hoy, queda **ligada al turno** (el turno pasa a «En curso»), igual que el botón de la agenda.
- Las propinas, anular fichas y ligar una ficha existente a un turno siguen haciéndose desde la pantalla de Fichas.

---

## Criterios de aceptación

1. **Leer la ficha — Por rol.** «¿Qué tiene la ficha de <cliente>?» responde con sus líneas (servicio, cantidad, profesional). La administradora ve además los montos (`Gs. 50.000`); la profesional no ve ninguno.
2. **Crear ligada al turno.** Con un único turno hoy y sin ficha, pedir «abrile la ficha a <cliente> con <servicio>» deja una tarjeta con la línea del turno más lo pedido. «Guardar ficha» crea la ficha; el turno pasa a «En curso» y queda ligado a ella.
3. **Crear suelta.** Sin turno hoy, la administradora crea la ficha solo con lo pedido.
4. **Varios turnos hoy.** Con dos o más turnos el asistente pregunta cuál (por hora y servicio) antes de preparar la tarjeta.
5. **Profesional — Solo con turno propio.** Sin un turno propio hoy no se crea nada y el asistente lo explica; un turno de otra profesional se rechaza.
6. **Editar la ficha abierta.** Agregar servicios, quitar líneas, cambiar cantidad y profesional. La tarjeta marca lo agregado (+), lo quitado (tachado) y lo cambiado.
7. **Precio dicho — Solo administración.** La administradora puede fijar un precio dicho en el pedido («el corte a 45.000»); llega a la tarjeta. La profesional no puede fijar precios: se rechaza y se le explica.
8. **La profesional nunca ve montos.** Ni en la respuesta de lectura, ni en la tarjeta (sin columna de montos ni total), ni al recargar, ni al guardar.
9. **Varias fichas o ficha vieja.** Con varias fichas abiertas pregunta cuál. Si la única ficha abierta es de un día anterior, pregunta si se edita esa o se abre una nueva para hoy (ligada al turno de hoy si lo hay).
10. **Cambios sobre el borrador pendiente.** Un segundo pedido sobre la misma clienta se suma a la tarjeta pendiente; la tarjeta anterior queda atenuada («Reemplazado»).
11. **Ficha cambiada antes de guardar.** Si la ficha cambió desde la propuesta, no se guarda: la tarjeta se rehace con el estado actual, los cambios que ya no aplican se muestran como «no aplicados» y se pide confirmar de nuevo.
12. **Doble toque.** Dos toques sobre «Guardar ficha» (aunque lleguen a la vez) crean o cambian la ficha una sola vez; el segundo responde 409 `ASSISTANT_DRAFT_ALREADY_CONFIRMED`.
13. **Descartar, vencer y recargar.** «Descartar» (o pedirlo por chat) atenúa la tarjeta sin tocar nada; un borrador no guardado en 24 h vence; al recargar, la tarjeta (o la ficha guardada) sigue ahí con su estado.
14. **Factura con ficha sin guardar.** Si hay una tarjeta de ficha sin guardar de esa clienta, pedir la factura no la reemplaza: el asistente pide guardar o descartar la ficha antes (`FICHA_DRAFT_PENDING`).
15. **Aislamiento — Por salón y por persona.** El asistente no ofrece clientes, turnos ni fichas de otro salón, y nadie puede confirmar, completar o descartar un borrador ajeno con solo conocer su identificador.
16. **Auditoría.** Guardar la ficha registra `service-records` / `create` o `update` con origen `ASSISTANT`.

---

## Fuera de alcance

- Propinas, anular fichas y ligar a un turno una ficha ya existente (se hacen desde Fichas y la agenda).
- Editar las líneas desde la tarjeta con campos o botones: los cambios se piden por el chat.
- Fichas de «cliente ocasional» (sin cliente registrado).
- Dar a la profesional acceso a facturar o a ver montos.
