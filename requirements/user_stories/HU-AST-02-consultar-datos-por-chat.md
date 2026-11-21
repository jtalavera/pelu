# HU-AST-02 · Consultar datos por chat

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **ID**     | HU-AST-02                                                                          |
| **Módulo** | Asistente conversacional                                                           |
| **Estado** | `In Progress`                                                                      |
| **Flag**   | `ASSISTANT_CHATBOT`                                                                |
| **Plan**   | [Plan de implementación del asistente](../asistente/plan_asistente.md) · fase 1    |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** persona que trabaja en el salón,  
**quiero** hacerle preguntas al asistente sobre los turnos, los clientes, los servicios y los profesionales,  
**para** obtener la información sin buscarla pantalla por pantalla.

---

## Contexto

El asistente entiende la pregunta con un modelo de lenguaje y la responde consultando las mismas fuentes de datos que el resto del sistema, siempre dentro del salón de quien pregunta. El modelo **consulta** con `buscar_clientes`, `listar_servicios`, `listar_profesionales` y `turnos_del_dia`, y **propone** borradores con `proponer_factura` y `descartar_borrador` (fase 2); no tiene ninguna herramienta que cree, cambie, cancele o emita algo: eso lo hace la persona con el botón de la tarjeta. En las pruebas automáticas el modelo es un doble guionado que responde por patrones de texto y pasa por el mismo recorrido real (herramientas, streaming y pantalla).

---

## Criterios de aceptación

1. **Enviar — Enter.** `Enter` envía el mensaje y `Shift + Enter` agrega un salto de línea. Mientras el asistente responde, la caja queda bloqueada.
2. **Respuesta en streaming — Con indicador.** El mensaje de la persona aparece enseguida; mientras el asistente consulta se muestra qué está haciendo («Revisando la agenda…», «Buscando clientes…») y la respuesta aparece a medida que llega.
3. **Turnos del día — Hora, cliente, servicio y profesional.** Preguntar por los turnos de una fecha (hoy, mañana o una fecha concreta) lista cada turno con su hora, cliente, servicio y profesional; si no hay, lo dice.
4. **Turnos de un cliente — Dos consultas encadenadas.** Preguntar por los turnos de un cliente por su nombre busca al cliente y muestra solo sus turnos.
5. **Buscar clientes — Por nombre.** Pedir que busque a un cliente lo encuentra por nombre; si no existe, el asistente dice que no lo encontró.
6. **Servicios y profesionales — Formato fijo.** Preguntar por los servicios los lista activos, uno por línea, mostrando **solo el nombre y el precio** con el formato `- Nombre — Gs. 50.000` (punto de miles, sin decimales, como en el resto de la app); no aparecen la categoría, la duración ni otros datos, y tampoco los servicios inactivos. Preguntar por los profesionales los lista, sin los inactivos. Este formato es permanente: lo define la herramienta (`AssistantMoney`), lo exige el prompt de sistema y lo verifican los tests.
7. **Solo cliente propio — Aislamiento por salón.** El asistente nunca devuelve clientes, turnos ni profesionales de otro salón, aunque se los pida por nombre.
8. **Profesional — Solo nombres.** Una profesional puede usar el asistente, pero ve de los clientes solo el nombre (sin teléfono ni RUC) y los busca solo por nombre, igual que en la lista de clientes.
9. **No entiende — Respuesta de ayuda.** Ante una pregunta que no entiende, el asistente lo dice y sugiere qué puede hacer.
10. **Sin confirmación — No cambia datos.** Pedirle al asistente algo que modifica datos (por ejemplo facturar o agendar un turno) solo prepara un borrador en una tarjeta ([HU-AST-03](HU-AST-03-proponer-y-emitir-factura-desde-el-chat.md), [HU-AST-06](HU-AST-06-agendar-turno-desde-el-chat.md)): ningún cliente, turno ni factura cambia hasta que la persona lo confirma con el botón.
11. **Error del modelo — Mensaje traducido.** Si el modelo no está disponible, la burbuja muestra un mensaje de error traducido (sin códigos técnicos) y la caja vuelve a quedar disponible.
12. **Mensaje vacío o demasiado largo — Validación.** Un mensaje vacío no se envía (el botón «Enviar» queda deshabilitado). La caja no admite más de 2000 caracteres y el servidor rechaza uno más largo (`ASSISTANT_MESSAGE_TOO_LONG`; la pantalla lo traduce diciendo el máximo: «El mensaje es demasiado largo: el máximo es de 2000 caracteres.»).
13. **Conversación propia — Una por persona.** Cada persona tiene su propia conversación: nadie puede leer ni continuar la de otra persona, ni siquiera conociendo su identificador.

---

## Fuera de alcance

- Preguntas sobre qué servicios hace cada profesional: el sistema todavía no registra esa relación. Se decide en la fase de disponibilidad.
- Disponibilidad de horarios, facturar y agendar (fases 2 y 3).
- Costo por salón y cupos de uso (pendiente; la fase 1 solo mide tokens y latencia por salón).

## Notas

- Las respuestas parciales se emiten por SSE (`POST /api/assistant/messages`): eventos `message.delta`, `tool.status`, `message.done` y `error`.
- El texto de las conversaciones no se escribe en los logs; solo ids, herramientas usadas, tokens, latencia y códigos de error.
- Errores nuevos: `ASSISTANT_DISABLED`, `ASSISTANT_MODEL_UNAVAILABLE`, `ASSISTANT_CONVERSATION_NOT_FOUND`, `ASSISTANT_MESSAGE_EMPTY`, `ASSISTANT_MESSAGE_TOO_LONG`, `ASSISTANT_TOO_MANY_STEPS`, `ASSISTANT_INTERNAL_ERROR`.
