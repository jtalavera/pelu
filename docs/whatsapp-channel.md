# Canal WhatsApp (Épica C)

Diseño y operación del canal compartido de WhatsApp. Especificación:
`requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md` (Épica C). Textos de las
plantillas para Meta: `requirements/user_stories/Plantillas_WhatsApp_para_Meta.md`.

## Estado

| Incremento | Estado |
| ---------- | ------ |
| **C0** HU-WAP-01 y HU-WAP-02 | Implementado. Falta la **prueba manual contra el número real** (Definición de terminado, punto 8) |
| **C1** HU-WAP-03 y HU-WAP-07 | Implementado. Quedan criterios que dependen de otros incrementos (ver abajo) |
| **C2** HU-WAP-04 | Implementado el **motor** de mensajes de la reserva. Todavía no lo dispara ningún flujo real (depende de A4, A5 y A6) |
| C3…C5 | Pendientes |

## Piezas de C2 (mensajes de la reserva)

`BookingNotifier` es el motor de HU-WAP-04: se le dice qué le pasó a la reserva y él arma el mensaje, elige el canal y lo
deja en cola. **Hoy nadie lo llama** (la reserva online, el enlace de gestión y la aprobación de solicitudes no existen
todavía); los tests lo ejercitan a través de un disparador de soporte de e2e.

| Pieza | Responsabilidad |
| ----- | --------------- |
| `BookingEvent` | Los cinco eventos y su plantilla: confirmado, pendiente, rechazado o vencido, propuesta de horario, cancelado |
| `BookingContact` | A quién va: el celular, email y consentimiento de la clienta (turno del salón) o el **contacto propio** del turno online con el consentimiento del formulario |
| `BookingNotifier.notify(...)` | Se llama **dentro de la transacción** de quien cambia el turno. Una clave por (turno, evento, horario): no se duplica. Anula lo que sigue en cola de un horario viejo (reprogramación) o todo lo pendiente (cancelación) |
| `WhatsAppOutbox.enqueueUndeliverable` | Lo que WhatsApp no puede llevar (sin consentimiento, baja, canal apagado, celular inválido) queda como `FAILED` con el motivo y sale por email después del commit; sin email solo queda registrado |
| `BookingMessagingSettings` | El interruptor «Confirmaciones de reserva» de cada salón (RSV-02). Hasta A2 se lee de `app.femme.whatsapp.booking-notices-enabled` (apagado por defecto en producción) |
| `BookingNoticeFormatter` | `viernes 28/11` y `15:30`, siempre en español y en la zona del salón |

**Cómo lo conectan los incrementos que faltan**, con una línea dentro de su transacción:

```java
bookingNotifier.notify(tenantId, appointmentId, BookingEvent.CONFIRMED,
    BookingContact.online(nombre, celular, email, aceptoWhatsApp),   // o BookingContact.ofClient(cliente)
    slug + "/turno/" + token);                                        // solo slug en rechazo y cancelación
```

- **A4** (reserva online): `PENDING` o `CONFIRMED` según la aprobación configurada.
- **A5** (gestión por enlace): `CANCELLED` y, al reprogramar, otra `CONFIRMED`/`PENDING` (el motor anula la vieja).
- **A6** (aprobación): `CONFIRMED` al aprobar, `REJECTED` al rechazar o vencer, `PROPOSAL` al proponer otro horario.
- Crear un turno desde la agenda **no** llama al motor (criterio 8).

Decisiones de C2:

- El motivo que escribe la administradora al rechazar **no existe** en el motor: la plantilla no lo admite y queda solo
  en la app.
- Las notificaciones de un turno online usan `clientId = null` al encolar: manda el consentimiento del formulario del
  turno, no el de la ficha de la clienta. Las bajas y los números sin WhatsApp (por celular) se respetan igual.
- Si WhatsApp falla después de encolar (plantilla pausada, error definitivo, «no entregado») el respaldo por email es el
  de C1.
- Las claves de deduplicación terminan en `:<segundos del horario>`, y C3 (recordatorios) usará la misma forma para que
  una reprogramación anule también el recordatorio viejo.
- Un fallo al **armar** el aviso (por ejemplo, una variable vacía) se propaga al llamador: es un error de programación,
  no una situación de negocio.

## Piezas de C1

| Pieza | Responsabilidad |
| ----- | --------------- |
| `WhatsAppConsentService` | Quién puede recibir: consentimiento de la clienta atado al celular para el que se dio, bajas y números sin WhatsApp **por celular** (valen para todos los salones) |
| `WhatsAppDispatcher` | Reintentos con esperas de 1, 5 y 15 minutos (el primer envío más 3 reintentos), cancelación si se retiró el consentimiento, respaldo por email |
| `WhatsAppDeliveryService` | Estados de Meta (`sent` → `delivered` → `read` o `failed`): solo avanzan, cada notificación se procesa una vez, el salón se deduce del `wamid` de **nuestro** registro |
| `WhatsAppFallbackService` + `FallbackEmailSender` | Un único email con el mismo contenido (texto de la plantilla con sus variables más el enlace); se reclama una sola vez en la base y, si el email falla, se libera y el barrido lo reintenta |
| `WhatsAppRetentionJob` | A los 90 días enmascara el celular, quita el email de respaldo y las variables |
| `AppointmentMessagesController` | `GET /api/appointments/{id}/messages`: la administradora ve estado y celular; la profesional solo si hubo aviso |
| `PUT /api/clients/{id}/whatsapp-consent` | Interruptor del salón (con ambos flags; la auditoría lo registra sola) |

## Piezas de C0 (`com.cursorpoc.backend.whatsapp`)

| Pieza | Responsabilidad |
| ----- | --------------- |
| `WhatsAppGateway` | Transporte. `MetaCloudWhatsAppGateway` (real) o `FakeWhatsAppGateway` (e2e/tests), elegido por `app.femme.whatsapp.provider` (`meta` por defecto) |
| `WhatsAppSettings` | Configuración de plataforma. Con `enabled=true` y algún valor obligatorio faltante, el canal queda **apagado** y `WhatsAppConfigCheck` lo informa (log ERROR + alerta de plataforma, solo nombres) |
| `WhatsAppTemplate` | Catálogo versionado de las 7 plantillas; valida cantidad de variables y botones y las limpia |
| `WhatsAppTemplateStatusService` | Estado de cada plantilla según Meta (consulta + webhook). Solo se usa una plantilla `APPROVED` |
| `WhatsAppAccess` | `WHATSAPP_REMINDERS` ∧ `ONLINE_BOOKING` para el salón ∧ interruptor global con configuración completa |
| `WhatsAppOutbox` + `WhatsAppDispatcher` | Modo **por cola**: el mensaje se guarda `QUEUED` en la transacción del hecho que lo origina y sale después del commit; un barrido recoge los que perdieron el aviso |
| `WhatsAppSender` | Modo **síncrono** (código de verificación, tiempo de espera corto) y envío de prueba de plataforma |
| `WhatsAppWebhookSignature` / `WhatsAppWebhookProcessor` | Firma `X-Hub-Signature-256` y avisos de plantillas |
| `PlatformAlertService` | Alertas para administradores de plataforma (`platform_alerts`) |

## Decisiones tomadas al implementar C0

- **Proveedor explícito.** La especificación dice que el proveedor falso reemplaza al real «cuando el canal está
  deshabilitado», pero también que con el canal apagado se responde «no disponible». Para que producción nunca dé por
  enviado un mensaje que no salió, el proveedor es una propiedad: `app.femme.whatsapp.provider=meta|fake`. Solo los
  perfiles `e2e` y `test` usan `fake`. El controlador de soporte
  (`/api/admin/whatsapp-test-support`) existe solo con `femme.data-init.enabled=true` **y** proveedor `fake`;
  `WhatsAppProductionDefaultsTest` verifica que no exista en un despliegue real.
- **El modo «solo log» que imprimía parámetros se eliminó** (RT-13). Los logs reales llevan destinatario enmascarado
  (`+595******456`), plantilla y resultado, nunca variables ni códigos. El código de verificación no se guarda en
  `whatsapp_messages.payload`.
- **Firma del webhook adelantada a C0** (era HU-WAP-06, criterio 1): el `POST` ahora exige la firma antes de leer nada.
  Mensajes entrantes y estados de entrega siguen sin procesarse hasta C1/C4.
- **Saludo sin nombre.** Las plantillas empiezan con «Hola {{1}},» y Meta no admite variables vacías, así que sin nombre
  se usa el texto fijo «clienta» («Hola clienta,»). Una variable vacía que no sea el nombre se rechaza y no se envía.
- **Alertas mínimas.** Hasta HU-WAP-08 las alertas quedan en `platform_alerts` y se ven en Plataforma → WhatsApp; el
  email a administradores de plataforma llega en C5.
- **Sin reintentos todavía.** En C0 un envío fallido queda `FAILED` con un código tipificado; los reintentos con espera
  (1, 5 y 15 minutos) y el respaldo por email son HU-WAP-07 (C1). Hoy quien llama ve la categoría (`isRetryable`).

## Decisiones tomadas al implementar C1

- **Reintentos:** «hasta 3 intentos con esperas de 1, 5 y 15 minutos» se implementó como el primer envío más 3
  reintentos (4 intentos en total). Solo se reintentan los errores transitorios y los límites de envío.
- **Consentimiento retirado con un mensaje ya en cola:** el mensaje se cancela (`CANCELLED`, `NO_CONSENT` u
  `OPTED_OUT`) y **no** se manda el email de respaldo: la clienta retiró el aviso por WhatsApp, no pidió otro canal.
- **Qué cae a email:** confirmaciones y recordatorios (propósitos `BOOKING` y `REMINDER`) con falla definitiva,
  «no entregado», número sin WhatsApp, plantilla pausada o canal apagado. El código de verificación nunca.
- **Dirección del respaldo:** quien encola el mensaje la pasa (`fallbackEmail`): el email de la clienta o el contacto
  propio del turno online (C2/C3). Sin dirección la falla solo queda registrada.
- **Número sin WhatsApp:** se marca por celular (`whatsapp_unreachable`) y vale para todos los salones, porque el
  número emisor es uno solo.
- **Interruptor del salón:** es una acción inmediata (no espera a «Guardar»), guarda el celular **guardado**, y queda
  bloqueado mientras el campo de celular tiene cambios sin guardar. La clienta genérica y las inactivas no lo admiten.
- **Mensajes entrantes** (`BAJA`, `ALTA`, botones) siguen sin procesarse: son HU-WAP-06 (C4). La tabla de bajas y su
  efecto ya existen; hasta C4 solo se llena desde el controlador de soporte de e2e.

## Criterios que quedan pendientes de otros incrementos

| Criterio | Depende de |
| -------- | ---------- |
| HU-WAP-03 (1): consentimiento propio de los turnos online | Columnas `contact_*` de `appointments` (A4) |
| HU-WAP-03 (3): alta desde el email con enlace firmado | Secreto de enlaces y página pública (A0/A5) |
| HU-WAP-03 (4): retiro respondiendo `BAJA` | Webhook de mensajes entrantes (C4) |
| HU-WAP-07 (6) y parte de (7): «Requiere atención» cuando falló todo | Lista de solicitudes y «Requiere atención» (A6, RSV-07) |
| HU-WAP-07 (3): la espera exacta de 1/5/15 minutos solo se verifica por el campo `next_attempt_at` | — (e2e usa `expedite` en lugar de esperar) |

## Lo que NO está verificado contra Meta

La documentación de Meta no estaba accesible al implementar C0 (el dominio `developers.facebook.com` no resuelve desde el
entorno de desarrollo). Los siguientes puntos siguen el comportamiento conocido de la API `v21.0` y deben contrastarse
con la documentación vigente **antes de habilitar un salón**:

- Forma de los `components` de botones (`sub_type` `url` / `quick_reply`, `index` como texto, parámetro `payload`) y del
  botón «Copiar código» de la plantilla de autenticación (enviado como botón `url` con el código).
- Clasificación de códigos de error de Meta (`MetaCloudWhatsAppGateway.classify`) y su carácter reintentable.
- Forma de los estados de entrega (`statuses[]` con `id`, `status`, `timestamp`, `errors[].code`) y los códigos de
  error de un «no entregado» (`131026`, `131049`…).
- Campos de `GET /{waba-id}/message_templates` (`status`, `category`, `rejected_reason`) y de los avisos
  `message_template_status_update` / `message_template_quality_update` del webhook.
- Que `v21.0` siga soportada.

## Puesta en marcha (por entorno)

Ver `infrastructure_v2/infrastructure_v2.md` → «WhatsApp channel». Resumen: secretos en Key Vault
(`app-femme-whatsapp-access-token`, `app-femme-whatsapp-app-secret`, `app-femme-whatsapp-webhook-verify-token`),
variables `whatsapp_*` en `terraform.tfvars`, webhook en Meta con los campos `message_template_status_update` y
`message_template_quality_update`, y recién entonces `whatsapp_enabled = true`. Después: Plataforma → WhatsApp →
«Actualizar estado en Meta» y un envío de prueba con cada plantilla.

## Pruebas

- JUnit: `MetaCloudWhatsAppGatewayTest` (servidor HTTP simulado), `WhatsAppTemplateTest` (incluye que el catálogo
  coincide con `Plantillas_WhatsApp_para_Meta.md`), `WhatsAppTemplateVariablesTest`, `WhatsAppWebhookSignatureTest`,
  `WhatsAppSettingsTest`, `WhatsAppChannelIntegrationTest`, `WhatsAppProductionDefaultsTest`,
  `PhoneNumberNormalizerTest`, `WhatsAppWebhookControllerTest`.
- Vitest: `PlatformWhatsAppPage.test.tsx`, `WhatsAppConsentSwitch.test.tsx`, `AppointmentNoticeLine.test.tsx`.
- C1: `WhatsAppDeliveryIntegrationTest`, `AppointmentMessagesControllerTest`, casos nuevos en `ClientServiceTest` y
  `ProfessionalAccessPolicyTest`.
- Playwright: `e2e/tests/hu-wap-01-canal-base.spec.ts` y `e2e/tests/hu-wap-02-catalogo-plantillas.spec.ts`
  y, de C1, `hu-wap-03-consentimiento.spec.ts`, `hu-wap-07-seguimiento-entrega.spec.ts` y
  `mt-isolation/mt-whatsapp.spec.ts` (con el proveedor falso; nada sale del proceso). El mundo `mt` tiene un tercer
  salón suspendido a propósito, así que el caso de aislamiento usa solo los salones A y B.
