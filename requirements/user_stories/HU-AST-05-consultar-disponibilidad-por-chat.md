# HU-AST-05 · Consultar disponibilidad por chat

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **ID**     | HU-AST-05                                                                          |
| **Módulo** | Asistente conversacional                                                           |
| **Estado** | `In Progress`                                                                      |
| **Flag**   | `ASSISTANT_CHATBOT`                                                                |
| **Plan**   | [Plan de implementación del asistente](../asistente/plan_asistente.md) · fase 3    |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** persona que atiende el salón (administración o profesional),  
**quiero** preguntarle al asistente cuándo hay lugar para un servicio,  
**para** ofrecerle al cliente un horario sin revisar la agenda profesional por profesional.

---

## Contexto

El cálculo lo hace el sistema (`AvailabilityService`), nunca el modelo: toma el horario de trabajo de cada profesional (días y bloques), la duración del servicio, los turnos existentes y la hora actual. Un turno cancelado libera su horario; uno «No vino» lo sigue ocupando (misma regla que al agendar). Los horarios se ofrecen cada 30 minutos y como botones que se pueden tocar. Un servicio por consulta.

---

## Criterios de aceptación

1. **Horarios libres — Como botones.** «¿Hay lugar mañana para <servicio> con <profesional>?» responde con los horarios libres como botones (hasta 8) y un resumen. Un horario solo se ofrece si el servicio entra completo antes del fin del bloque de trabajo.
2. **Turnos existentes — No se ofrecen horarios ocupados.** Los horarios que se solapan con un turno existente de esa profesional no aparecen; el que termina justo cuando empieza otro sí.
3. **Franja — Mañana o tarde.** Pedir «a la mañana» o «a la tarde» deja solo los horarios de esa franja (antes o desde las 12:00).
4. **Profesional — Filtro opcional.** Con profesional, solo se muestran sus horarios; sin profesional, los de todas las profesionales activas, indicando de quién es cada uno.
5. **Sin lugar — Sugiere otro día.** Si ese día no hay lugar, el asistente lo dice y ofrece el próximo día con horarios libres.
6. **Sin horario cargado — Lo avisa.** Si una profesional no tiene horario de trabajo cargado, el asistente lo dice en lugar de inventar horarios.
7. **Tocar un horario — Lo envía como mensaje.** Al tocar un botón, el horario se envía al chat como mensaje de la persona (con la profesional y el servicio) y el asistente pregunta para qué cliente.
8. **Aislamiento — Por salón.** Los horarios y las profesionales que ve el asistente son solo las del salón de la persona.

---

## Fuera de alcance

- Consultar varios servicios a la vez (se consulta de a uno).
- Ausencias, feriados y vacaciones: la agenda no los modela todavía.
- Validar que la profesional realice el servicio (no existe esa relación en el modelo).

## Notas

- Al agendar desde un horario ofrecido, ver [HU-AST-06](HU-AST-06-agendar-turno-desde-el-chat.md).
