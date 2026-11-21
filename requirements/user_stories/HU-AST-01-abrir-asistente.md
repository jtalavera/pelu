# HU-AST-01 · Abrir el asistente desde cualquier pantalla

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **ID**     | HU-AST-01                                                                          |
| **Módulo** | Asistente conversacional                                                           |
| **Estado** | `In Progress`                                                                      |
| **Flag**   | `ASSISTANT_CHATBOT`                                                                |
| **Plan**   | [Plan de implementación del asistente](../asistente/plan_asistente.md) · fase 1    |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** persona que trabaja en el salón (administración o profesional),  
**quiero** abrir un asistente de chat desde cualquier pantalla sin perder lo que estaba haciendo,  
**para** consultar información mientras sigo usando el sistema.

---

## Contexto

El asistente es un panel lateral que se abre desde la cabecera. En esta fase es de solo lectura (ver [HU-AST-02](HU-AST-02-consultar-datos-por-chat.md)). La función se enciende por tenant y por tier con el flag `ASSISTANT_CHATBOT` (efectivo = global **y** tier **y** tenant; nace apagado). Con el flag apagado la función no existe: ni botón ni acceso por API.

---

## Criterios de aceptación

1. **Solo con el flag — Botón en la cabecera.** El botón «Asistente» aparece en la cabecera únicamente si `ASSISTANT_CHATBOT` está habilitado para el salón. Con el flag apagado no hay botón y cualquier llamada a `/api/assistant/**` responde `403 ASSISTANT_DISABLED`.
2. **Abrir y cerrar — Con el botón.** Tocar el botón abre el panel; volver a tocarlo, o tocar la «X» del panel, lo cierra. El botón indica si el panel está abierto (`aria-expanded`).
3. **Atajo — `Ctrl/Cmd + K`.** El atajo abre el panel desde cualquier pantalla y lo cierra si ya estaba abierto.
4. **Panel acoplado en escritorio — Sin tapar la pantalla.** En pantallas anchas (≥ 1024 px) el panel queda a la derecha con 400 px de ancho y el contenido de la pantalla se angosta para dejarle lugar, en lugar de quedar debajo. En pantallas medianas (768–1023 px) se superpone a la derecha.
5. **Persiste al navegar — Misma conversación.** Con el panel abierto, cambiar de pantalla (por ejemplo de Hoy a Agenda) no lo cierra ni pierde la conversación.
6. **Teléfono — Pantalla completa.** En pantallas de menos de 768 px el panel ocupa toda la pantalla bajo la cabecera y trae un botón «Volver» que lo cierra.
7. **Bienvenida — Con sugerencias.** Una conversación vacía muestra un saludo, qué puede hacer el asistente y sugerencias que se envían al tocarlas.
8. **Nueva conversación — Empezar de cero.** El botón «Nueva conversación» vacía el panel y vuelve a mostrar la bienvenida. La conversación anterior ya no se puede continuar.
9. **Historial — Al recargar.** Al recargar la página y volver a abrir el asistente se ve la conversación actual con sus mensajes anteriores.
10. **Táctil — Objetivos de 44 px.** En teléfono, el botón de la cabecera, «Volver», «Nueva conversación», las sugerencias y «Enviar» miden al menos 44 × 44 px.
11. **Caja de texto — Crece hasta 5 líneas.** La caja de mensaje arranca de una línea y crece al escribir (o dictar) varias líneas con Shift + Enter, hasta mostrar 5 líneas completas sin barra de desplazamiento. Pasadas las 5 líneas deja de crecer y se desplaza por dentro. Al enviar vuelve a una línea.

---

## Fuera de alcance

- Dictado por voz ([HU-AST-07](../asistente/plan_asistente.md)).
- Tarjetas de borrador, facturar y agendar (fases 2 y 3).

## Notas

- Un dispositivo compartido con sesión por PIN (HU-66) no tiene asistente: la sesión PIN no tiene un usuario real al que asociar la conversación. Está cubierto por tests unitarios (`ProfessionalAccessPolicyTest`, `AssistantPanel.test.tsx`).
- Frontend: `AssistantProvider` en `AppShell`, `components/assistant/`. Backend: `AssistantController` (`GET /api/assistant/conversations/current`, `POST /api/assistant/conversations`).
- Retención: las conversaciones se borran a los 30 días sin actividad (`AssistantRetentionJob`).
