# Canal WhatsApp (Épica C)

Diseño y operación del canal compartido de WhatsApp. Especificación:
`requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md` (Épica C). Textos de las
plantillas para Meta: `requirements/user_stories/Plantillas_WhatsApp_para_Meta.md`.

## Estado

| Incremento | Estado |
| ---------- | ------ |
| **C0** HU-WAP-01 y HU-WAP-02 | Implementado. Falta la **prueba manual contra el número real** (Definición de terminado, punto 8) |
| C1…C5 | Pendientes |

## Piezas (`com.cursorpoc.backend.whatsapp`)

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

## Lo que NO está verificado contra Meta

La documentación de Meta no estaba accesible al implementar C0 (el dominio `developers.facebook.com` no resuelve desde el
entorno de desarrollo). Los siguientes puntos siguen el comportamiento conocido de la API `v21.0` y deben contrastarse
con la documentación vigente **antes de habilitar un salón**:

- Forma de los `components` de botones (`sub_type` `url` / `quick_reply`, `index` como texto, parámetro `payload`) y del
  botón «Copiar código» de la plantilla de autenticación (enviado como botón `url` con el código).
- Clasificación de códigos de error de Meta (`MetaCloudWhatsAppGateway.classify`) y su carácter reintentable.
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
- Vitest: `PlatformWhatsAppPage.test.tsx`.
- Playwright: `e2e/tests/hu-wap-01-canal-base.spec.ts` y `e2e/tests/hu-wap-02-catalogo-plantillas.spec.ts`
  (con el proveedor falso; nada sale del proceso).
