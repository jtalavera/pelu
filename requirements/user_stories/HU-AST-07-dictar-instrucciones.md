# HU-AST-07 · Dictar instrucciones al asistente

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **ID**     | HU-AST-07                                                                          |
| **Módulo** | Asistente conversacional                                                           |
| **Estado** | `In Progress`                                                                      |
| **Flag**   | `ASSISTANT_CHATBOT`                                                                |
| **Plan**   | [Plan de implementación del asistente](../asistente/plan_asistente.md) · fase 4    |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** persona que atiende el salón (administración o profesional),  
**quiero** dictarle mis pedidos al asistente en lugar de escribirlos,  
**para** pedir cosas con las manos ocupadas o sin tipear, y revisar lo que entendió antes de enviarlo.

---

## Contexto

El dictado **solo escribe en el cuadro de mensaje**: nunca envía solo. La persona revisa (y puede corregir) el texto y lo envía como cualquier otro mensaje, con el mismo flujo de borradores y confirmación. El reconocimiento lo hace **Azure AI Speech** directamente desde el navegador, con un token de corta duración que emite el backend (`GET /api/assistant/speech-token`): el navegador nunca recibe una clave ni la credencial del servidor. El idioma de reconocimiento sigue al de la aplicación (español de Paraguay o inglés).

Un mensaje en el que se usó el micrófono se guarda como **«Dictado»** (`input_mode = VOICE`), **aunque se haya editado después** (criterio: «si hubo dictado en ese mensaje»). Vaciar el cuadro empieza un mensaje nuevo.

---

## Criterios de aceptación

1. **Botón — Micrófono en el cuadro de mensaje.** Con el asistente abierto hay un botón de micrófono junto a «Enviar», con nombre accesible («Dictar un mensaje»), de al menos 44 × 44 px.
2. **Dictar — Texto parcial en el campo.** Al tocarlo, el navegador pide permiso para el micrófono y empieza a escuchar: el botón pasa a «Detener el dictado», aparece «Escuchando…» y lo que se va diciendo se ve en el cuadro de mensaje mientras se habla. Lo que ya estaba escrito se conserva y lo dictado se agrega después.
3. **No envía solo — La persona revisa.** Aunque el reconocimiento termine una frase o se detenga el dictado, el texto queda en el cuadro y no se envía ningún mensaje hasta que la persona toca «Enviar» o presiona Enter.
4. **Enviar — El mensaje queda marcado «Dictado».** Al enviar un texto dictado, su burbuja muestra la marca «Dictado» (también si lo editó antes de enviarlo) y el asistente responde igual que con un mensaje escrito. Un mensaje escrito a mano no lleva marca.
5. **Persistencia — Al recargar.** Al recargar y reabrir el asistente, la marca «Dictado» sigue en esos mensajes (el modo se guarda en la conversación) y no aparece en los escritos.
6. **Vaciar el campo — Empieza de nuevo.** Si la persona vacía el cuadro después de dictar y escribe algo a mano, ese mensaje es texto, sin marca.
7. **Errores — Traducidos y sin perder el texto.** Permiso de micrófono denegado, micrófono ausente o en uso, falta de soporte del navegador, servicio de voz no disponible y pérdida de conexión muestran un mensaje traducido en el cuadro de mensaje. El texto escrito o dictado hasta ahí se conserva, se puede seguir escribiendo y reintentar el dictado (el error desaparece al reintentar).
8. **Micrófono apagado — Nunca queda abierto.** El micrófono se apaga al detener el dictado, al enviar el mensaje, al escribir con el teclado, cuando el asistente empieza a responder, al empezar una conversación nueva, al cerrar el panel y, como límite, a los 2 minutos de escucha.
9. **Token — Solo con el asistente habilitado.** `GET /api/assistant/speech-token` responde con `{ token, region, expiresInSeconds }` (sin caché) a quien puede usar el asistente (administración y profesionales); sin sesión no responde, con el flag apagado para el salón responde 403 `ASSISTANT_DISABLED`, y si Azure Speech no está disponible 503 `ASSISTANT_SPEECH_UNAVAILABLE`.
10. **Arranque rápido — Precalentado.** Para que el dictado empiece enseguida, al abrir el panel y al acercarse al botón del micrófono (mouse, foco o toque) la pantalla deja listos el reconocimiento de voz y el token de Voz. Precalentar nunca abre el micrófono ni empieza a escuchar: eso solo ocurre al tocar el botón.

---

## Fuera de alcance

- Respuestas por voz (lectura en voz alta de las respuestas del asistente).
- Dictar sin tocar el botón (palabra de activación) o enviar con la voz («enviar»).
- Otros idiomas de reconocimiento además del español de Paraguay y el inglés.

## Notas

- **Pruebas automáticas:** Playwright no puede hablar. Los tests usan un dictado simulado (`window.__assistantDictation`, solo en la build de Playwright con `VITE_PLAYWRIGHT=1`) que inyecta texto parcial, frases finales y errores; cubre toda la lógica de la pantalla. La **calidad del reconocimiento real** (micrófono, acento, ruido) no se puede cubrir con un test automático y se prueba a mano.
- **Rapidez del arranque:** el backend reutiliza el token de Speech unos minutos (informa el tiempo que le queda, nunca el total) y la pantalla lo guarda en memoria mientras alcance para los 2 minutos de escucha; el micrófono, el token y el SDK se piden a la vez y el micrófono se abre una sola vez (se le pasa al SDK el mismo `MediaStream`). En desarrollo, la consola del navegador muestra `[dictation] ready` con los milisegundos de cada tramo. La precarga se cubre con Playwright (contador `prewarms` del dictado simulado); los tiempos reales se miden a mano.
- Tests unitarios cubren el intercambio y la reutilización del token de Speech con el backend (`AzureSpeechTokenService`), el token en memoria (`speechToken.test.ts`) y la lógica de la pantalla (compositor y hook de dictado).
- El reconocimiento real se verificó contra el Foundry de dev con audio sintético (inglés `en-US` y español `es-PY`), con un token emitido por el mismo intercambio que hace el backend. Falta la prueba con un micrófono y una persona reales (permiso del navegador, acento, ruido).
- La infraestructura ya incluye Speech en la cuenta de Foundry y los roles *Cognitive Services User*; el Container App recibe `FEMME_SPEECH_REGION`.
