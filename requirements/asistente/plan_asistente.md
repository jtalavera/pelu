# Plan de implementación · Asistente conversacional (chat)

| Campo | Valor |
|--------|--------|
| **Feature** | Asistente conversacional en el panel lateral |
| **Rama** | `feat/asistente_chat` (desde `develop`) |
| **Estado** | Planificación aprobada |
| **Fecha** | 2026-11-20 |
| **Feature flag** | `ASSISTANT_CHATBOT` |

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual. Convenciones (zona horaria del servidor UTC, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## 1. Objetivo

Desde cualquier pantalla, un botón **Asistente** en la cabecera abre un chat. El usuario escribe o dicta una instrucción. En el MVP el asistente puede:

1. **Facturar** servicios a un cliente: propone un **borrador** que existe solo en el chat. Al confirmar, emite la factura real y ofrece **«Compartir con el cliente»**, que abre el detalle de factura existente directamente en su panel «Compartir» (email o WhatsApp).
2. **Consultar disponibilidad** de profesionales en la agenda.
3. **Agendar un turno** para un cliente con un profesional, también con borrador y confirmación.

Material de referencia (artefactos privados de la sesión de diseño; pedir acceso al autor):

- Propuestas de UI (se eligió la **opción A: panel lateral acoplado**).
- Prototipo navegable de la opción A (aprobado).
- Documento de arquitectura con diagramas.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|------|----------|
| UI | Opción A: panel lateral acoplado a la derecha; en teléfono, pantalla completa. Reutiliza `Drawer` del design system. |
| Principio | **El modelo propone, la persona confirma.** El modelo no tiene ninguna herramienta que escriba datos de negocio. |
| Orquestación | El loop del agente corre en el backend Spring Boot (no en Foundry Agent Service). |
| Proveedor del modelo | Azure AI Foundry (Microsoft Foundry). |
| Librerías Java | Spring AI 2.x (starter de OpenAI) sobre `com.openai:openai-java` + `azure-identity` (token de Entra ID, sin API keys). |
| Modelo inicial | Uno chico y barato con tool calling: **gpt-5-mini** (o el «mini» vigente del catálogo al desplegar). Se ajusta con evaluaciones; *nano* si alcanza. |
| Región | La misma del backend: `centralus` (ver `infrastructure_v2/environments/*/terraform.tfvars`). |
| Feature flag | Propio: `ASSISTANT_CHATBOT`, por tenant/tier, independiente de SIFEN. |
| Retención | Conversaciones: **30 días**. Borradores: vencen a las **24 horas**. |
| Compartir | «Compartir con el cliente» abre `InvoiceDetailModal` en el panel «Compartir». **También sin SIFEN** (comprobante no fiscal). |
| Dictado | Azure AI Speech con el Speech SDK de JavaScript y token de corta duración emitido por el backend. |
| Costo / cupos | **Pendiente (TBD).** Se mide en fase 1. |

---

## 3. Arquitectura

```
Navegador                         Container App (Spring Boot)                    Azure
─────────                         ───────────────────────────                    ─────
AssistantPanel (React) ──SSE──▶  AssistantController ──▶ AssistantOrchestrator ──▶ Foundry (modelo)
   │                                                      │
   │                                                      ├─▶ Herramientas de lectura ──▶ servicios existentes
   │                                                      └─▶ proponer_* ──▶ AssistantDraftService ──▶ Azure SQL
   │
   ├── «Confirmar» ──REST──▶  AssistantDraftController.confirm ──▶ InvoiceIssuanceService / AppointmentService
   │                                                                     └─▶ Service Bus → SIFEN (existente)
   ├── «Compartir con el cliente» ──▶ InvoiceDetailModal(initialPanel="share") (existente)
   └── Speech SDK (JS) ──audio──▶ Azure AI Speech   (token: GET /api/assistant/speech-token)
```

Reglas:

- El `tenantId` sale **siempre** del JWT (`FemmeUserPrincipal`). Ninguna herramienta acepta un tenant como parámetro.
- Toda ID que devuelva el modelo se revalida contra el tenant antes de usarse.
- Precios, IVA, totales y horarios libres los calcula el backend desde el catálogo y la agenda, nunca el modelo.
- La tarjeta de borrador se dibuja con el payload estructurado del borrador, no con texto del modelo.
- Confirmar es un endpoint REST normal disparado por un botón. No existe una herramienta «confirmar».

---

## 4. Backend

### 4.1 Paquete y clases nuevas

`com.cursorpoc.backend.assistant` (paquete nuevo, para no mezclar con `service/`):

| Clase | Responsabilidad |
|-------|-----------------|
| `AssistantController` | `POST /api/assistant/messages` (SSE), `GET /api/assistant/conversations/current`, `POST /api/assistant/conversations` (nueva), `GET /api/assistant/speech-token`. |
| `AssistantDraftController` | `POST /api/assistant/drafts/{id}/confirm`, `POST /api/assistant/drafts/{id}/discard`, `PATCH /api/assistant/drafts/{id}` (completar datos faltantes desde la tarjeta: medio de pago, email). |
| `AssistantOrchestrator` | Arma el prompt de sistema, el historial recortado y las herramientas habilitadas por rol; llama al `ChatClient` de Spring AI; traduce el stream a eventos SSE. |
| `AssistantModelClient` | Interfaz sobre el `ChatModel`. Implementación real (Foundry) y doble guionado para el perfil `e2e`. |
| `AssistantTools` | Herramientas anotadas con `@Tool` (ver §4.4). Delegan en servicios existentes. |
| `AssistantDraftService` | Crea, reemplaza, descarta, vence y confirma borradores. Idempotencia y revalidación. |
| `AvailabilityService` | **Nuevo** (también reutilizable fuera del chat). Huecos libres por profesional, día, franja y duración. |
| `AssistantConversationService` | Persistencia de conversación y mensajes, recorte de contexto, borrado por retención. |
| `AssistantRetentionJob` | `@Scheduled` diario: borra conversaciones de más de 30 días y marca `EXPIRED` los borradores vencidos. |
| `AssistantQuotaService` | Cupos por tenant (valores TBD; arranca con límite alto y solo métricas). |
| `SpeechTokenService` | Pide a Azure AI Speech un token de corta duración usando la identidad administrada. |
| `FoundryClientConfig` | Bean del cliente `openai-java` con `BearerTokenCredential` de `azure-identity` (scope `https://cognitiveservices.azure.com/.default`) si el starter de Spring AI no acepta Entra ID directamente. |

### 4.2 Dependencias (`build.gradle.kts`)

- `org.springframework.ai:spring-ai-bom` (2.x) + `spring-ai-starter-model-openai`.
- `com.openai:openai-java` (lo trae Spring AI; fijar versión si hace falta el bean propio).
- Actualizar `com.azure:azure-identity` (hoy 1.15.4).
- `io.projectreactor:reactor-core` para exponer el `Flux` como SSE desde Spring MVC (no se migra a WebFlux).
- Confirmar versiones en Maven Central antes de fijarlas.

### 4.3 Endpoints y contratos

Todos bajo `/api/assistant/**`, autenticados, con `requireFlag(ASSISTANT_CHATBOT)` → `403 ASSISTANT_DISABLED` si el flag está apagado. Cada endpoint loguea INFO en request y response (path, método, tenantId, estado) y ERROR en no-2xx.

**`POST /api/assistant/messages`** (`text/event-stream`)

```json
{ "conversationId": 123, "text": "Facturale a María los servicios de hoy", "inputMode": "TEXT|VOICE", "currentPage": "hoy" }
```

Eventos SSE:

| Evento | Payload | Uso |
|--------|---------|-----|
| `message.delta` | `{ "text": "..." }` | Texto parcial del asistente. |
| `tool.status` | `{ "tool": "buscar_clientes", "state": "running|done" }` | Indicador «Buscando clientes…». |
| `card.options` | `{ "kind": "CLIENT|SERVICE|SLOT|PAYMENT", "options": [{ "label": "...", "value": "..." }] }` | Chips para tocar. |
| `card.draft` | `AssistantDraftDto` | Tarjeta de borrador (factura o turno). |
| `card.draft.updated` | `{ "id": "...", "status": "SUPERSEDED|EXPIRED|..." }` | Atenúa un borrador anterior. |
| `message.done` | `{ "messageId": 456, "usage": { ... } }` | Fin del turno. |
| `error` | `{ "code": "ASSISTANT_MODEL_UNAVAILABLE" }` | Error traducible. |

Se consume con `fetch` + `ReadableStream` (no `EventSource`, que no permite el header `Authorization`).

**`POST /api/assistant/drafts/{id}/confirm`**

- Header `Idempotency-Key` = id del borrador (también se usa el estado del borrador como guarda).
- Respuesta factura: `{ "type": "INVOICE", "invoiceId": 482, "invoiceNumberFormatted": "001-001-0000482", "sifenSubmissionStatus": "QUEUED|null" }`.
- Respuesta turno: `{ "type": "APPOINTMENT", "appointmentId": 9001, "startAt": "...", "professionalId": 3 }`.
- Errores: `ASSISTANT_DRAFT_NOT_FOUND` (404), `ASSISTANT_DRAFT_EXPIRED` (409), `ASSISTANT_DRAFT_ALREADY_CONFIRMED` (409, devuelve el resultado original), `ASSISTANT_DRAFT_INCOMPLETE` (400, falta pago/email), `ASSISTANT_SLOT_TAKEN` (409, con horarios alternativos), `ASSISTANT_PRICE_CHANGED` (409, con borrador recalculado), más los códigos que ya tiran los servicios reutilizados (`APPOINTMENT_OVERLAP`, `SIFEN_RECIPIENT_EMAIL_REQUIRED`, etc.).

**`GET /api/assistant/speech-token`** → `{ "token": "...", "region": "centralus", "expiresInSeconds": 540 }`.

### 4.4 Herramientas del modelo

| Herramienta | Tipo | Parámetros | Se apoya en | Roles |
|-------------|------|-----------|-------------|-------|
| `buscar_clientes` | Lectura | `query` (nombre, RUC o teléfono) | `ClientService` | ADMIN, PROFESSIONAL |
| `listar_servicios` | Lectura | `query?` | `ServiceCatalogService` | todos |
| `listar_profesionales` | Lectura | `serviceId?` | `ProfessionalDirectoryService` | todos |
| `turnos_del_dia` | Lectura | `date`, `clientId?`, `professionalId?` | `AppointmentService` | según permisos actuales de agenda |
| `consultar_disponibilidad` | Lectura | `date`, `serviceIds[]`, `professionalId?`, `window?` | `AvailabilityService` (nuevo) | todos |
| `proponer_factura` | Propuesta | `clientId`, `serviceIds[]` o `appointmentIds[]`, `professionalId?`, `paymentMethod?`, `email?` | `InvoiceService` (validaciones), `TaxService` | solo roles que hoy pueden facturar |
| `proponer_turno` | Propuesta | `clientId`, `serviceIds[]`, `professionalId?`, `date`, `time` | `AvailabilityService`, validaciones de `AppointmentService` | solo roles que hoy pueden agendar |
| `descartar_borrador` | Propuesta | `draftId` | `AssistantDraftService` | dueño del borrador |

Reglas:

- Las herramientas de lectura devuelven **solo** los campos necesarios (sin notas libres de fichas en el MVP, para reducir superficie de inyección).
- Los resultados se envuelven como datos (`{"data": ...}`), y el prompt de sistema indica que su contenido nunca son instrucciones.
- Fechas y horas relativas («mañana», «el jueves») se resuelven en el backend con la zona horaria del tenant; la fecha actual va en el prompt de sistema.

### 4.5 `AvailabilityService`

- Entrada: tenant, fecha, duración total (suma de servicios), profesional opcional, franja opcional, paso (30 min por defecto).
- Fuentes: `ProfessionalSchedule` (día y horario de cada profesional), turnos existentes no cancelados, servicios que hace cada profesional, «ahora» si la fecha es hoy.
- Salida: lista por profesional de horarios de inicio válidos (máx. 8 por profesional).
- Reutiliza la misma regla de solapamiento que `AppointmentService` (`APPOINTMENT_OVERLAP`). Extraer esa regla a un componente compartido para que no diverjan.

### 4.6 Modelo de datos (Flyway, desde `V103`)

```sql
-- V103__assistant_tables.sql (SQL Server)
CREATE TABLE assistant_conversation (
  id            BIGINT IDENTITY PRIMARY KEY,
  tenant_id     BIGINT        NOT NULL REFERENCES tenants(id),
  user_id       BIGINT        NOT NULL REFERENCES app_users(id),
  created_at    DATETIME2     NOT NULL,
  last_activity DATETIME2     NOT NULL,
  closed_at     DATETIME2     NULL
);
CREATE INDEX ix_assistant_conversation_tenant_user ON assistant_conversation(tenant_id, user_id, last_activity);

CREATE TABLE assistant_message (
  id              BIGINT IDENTITY PRIMARY KEY,
  conversation_id BIGINT        NOT NULL REFERENCES assistant_conversation(id) ON DELETE CASCADE,
  role            VARCHAR(16)   NOT NULL,   -- USER | ASSISTANT | TOOL
  content         NVARCHAR(MAX) NOT NULL,   -- texto o JSON del resultado de herramienta
  input_mode      VARCHAR(8)    NULL,       -- TEXT | VOICE
  tool_name       VARCHAR(64)   NULL,
  prompt_tokens   INT           NULL,
  completion_tokens INT         NULL,
  created_at      DATETIME2     NOT NULL
);

CREATE TABLE assistant_draft (
  id              UNIQUEIDENTIFIER PRIMARY KEY,
  tenant_id       BIGINT        NOT NULL REFERENCES tenants(id),
  user_id         BIGINT        NOT NULL REFERENCES app_users(id),
  conversation_id BIGINT        NOT NULL REFERENCES assistant_conversation(id),
  type            VARCHAR(16)   NOT NULL,   -- INVOICE | APPOINTMENT
  status          VARCHAR(16)   NOT NULL,   -- DRAFT | SUPERSEDED | DISCARDED | EXPIRED | CONFIRMING | CONFIRMED
  payload         NVARCHAR(MAX) NOT NULL,   -- JSON validado
  payload_hash    CHAR(64)      NOT NULL,
  expires_at      DATETIME2     NOT NULL,   -- created_at + 24 h
  result_type     VARCHAR(16)   NULL,
  result_id       BIGINT        NULL,       -- invoice.id o appointment.id
  created_at      DATETIME2     NOT NULL,
  updated_at      DATETIME2     NOT NULL
);
CREATE INDEX ix_assistant_draft_tenant_status ON assistant_draft(tenant_id, status, expires_at);
```

```sql
-- V104__assistant_chatbot_flag.sql
INSERT INTO feature_flags (flag_key, enabled, description)
VALUES ('ASSISTANT_CHATBOT', 0, 'Asistente conversacional en el panel lateral (facturar, disponibilidad, agendar).');
```

- Ajustar nombres de tablas/columnas referenciadas a las reales del esquema al escribir la migración.
- Las entidades JPA deben funcionar con H2 en modo MSSQL (tests).
- La conversación y sus mensajes se borran a los 30 días de `last_activity` (`AssistantRetentionJob`). Los borradores confirmados conservan `result_id` mientras exista la conversación; la trazabilidad permanente queda en `AuditLogService`.

### 4.7 Ciclo de vida del borrador

```
[proponer_*] → DRAFT ─┬─ cambio pedido por chat ─▶ SUPERSEDED (se crea uno nuevo)
                       ├─ «Descartar» ────────────▶ DISCARDED
                       ├─ 24 h sin confirmar ──────▶ EXPIRED
                       └─ «Confirmar» ─▶ CONFIRMING ─┬─ OK ─────────────▶ CONFIRMED
                                                      └─ error validación ▶ DRAFT (con el error)
```

- Solo un borrador `DRAFT` activo por conversación.
- La confirmación toma un lock de fila (`UPDATE … WHERE status='DRAFT'`) para que un doble toque no emita dos veces.
- Al confirmar se **recalcula** el payload; si el hash cambia (precio, hueco, datos fiscales), no se emite: se devuelve el borrador nuevo para revisar.
- Al confirmar se registra en `AuditLogService` con origen `ASSISTANT` y el id del borrador.

### 4.8 Confirmación por tipo

- **Factura:** construye un `InvoiceCreateRequest` desde el payload y llama al mismo camino que `POST /api/invoices` (con SIFEN: `InvoiceIssuanceService.issueWithSifen`; sin SIFEN: `InvoiceService.issueInvoice`). Respeta `SIFEN_RECIPIENT_EMAIL_REQUIRED` y el certificado activo. Marca como facturados los turnos de origen igual que el flujo manual.
- **Turno:** llama a `AppointmentService` como `POST /api/appointments` (estado inicial «Pendiente», recordatorio según HU vigente).

### 4.9 Seguridad

- `SecurityConfig`: `/api/assistant/**` autenticado; ninguna ruta pública nueva.
- Filtro de contenido del deployment en Foundry con Prompt Shields (entrada del usuario y documentos/herramientas).
- Prompt de sistema versionado en el repo (`src/main/resources/assistant/system-prompt.md`), con fecha actual, nombre del salón, rol del usuario y reglas.
- Logs: sin texto completo de conversaciones en App Insights; sí tokens, latencia, herramientas usadas, códigos de error.
- Cupos por tenant (`AssistantQuotaService`), con valores TBD.

---

## 5. Frontend

### 5.1 Componentes

| Componente | Ubicación | Notas |
|------------|-----------|-------|
| `AssistantButton` | `src/layout/AppShell.tsx` (topbar) | Visible solo con `useFeatureFlag("ASSISTANT_CHATBOT")`. Atajo `Ctrl/Cmd K`. Punto de aviso si hay borrador pendiente con el panel cerrado. |
| `AssistantPanel` | `src/components/assistant/` | Usa `Drawer` del design system. Ancho ~400 px en desktop (empuja el contenido), pantalla completa < 768 px con botón «Volver». Persiste abierto al navegar (estado en un `AssistantContext` en `AppShell`). |
| `AssistantMessageList` | idem | Burbujas usuario/asistente, indicador de escritura, `aria-live="polite"`. |
| `AssistantComposer` | idem | `<form onSubmit>` + botón submit; Enter envía, Shift+Enter salta línea; botón micrófono (44×44). |
| `InvoiceDraftCard`, `AppointmentDraftCard` | idem | Estados: borrador (borde punteado ámbar), confirmando, confirmado (verde), reemplazado/descartado/vencido (atenuado). Chips para datos faltantes. Botones con `ACTION_BUTTON`. |
| `OptionChips` | idem | Clientes, servicios, horarios, medios de pago. Al tocar, envían el valor como mensaje. |
| `useAssistantStream` | `src/hooks/` | `fetch` + `ReadableStream`, parseo SSE, reconexión. |
| `useSpeechDictation` | `src/hooks/` | Speech SDK (`microsoft-cognitiveservices-speech-sdk`), token de `/api/assistant/speech-token`, texto parcial en el campo; nunca envía solo. |

Evaluar si `OptionChips` o las tarjetas de borrador conviene llevarlos a `design-system/` (según CLAUDE.md: **proponer, no agregar automáticamente**).

### 5.2 «Compartir con el cliente»

- Botón en la tarjeta de factura confirmada → abre `InvoiceDetailModal` con una prop nueva `initialPanel?: "share"`.
- Hoy `shareAvailable` depende de `kudeEligible` (solo SIFEN). **Cambio:** habilitar «Compartir» también para el comprobante no fiscal:
  - WhatsApp: generalizar `lib/invoiceKudeShare.ts` para descargar el PDF no fiscal (`GET /api/invoices/{id}/pdf`) cuando no hay KuDE.
  - Email: **endpoint nuevo** `POST /api/invoices/{id}/pdf/email` (hoy solo existe `…/sifen/kude/email`), reutilizando `EmailService`/ACS y `NonFiscalReceiptPdfService`.
- Este cambio aplica también fuera del asistente (detalle de factura en Facturación).

### 5.3 i18n y estilo

- Todas las cadenas con `t()`, claves nuevas en `en.json` y `es.json` bajo `femme.assistant.*`.
- Códigos de error nuevos bajo `femme.apiErrors.*` (`ASSISTANT_DISABLED`, `ASSISTANT_DRAFT_EXPIRED`, `ASSISTANT_SLOT_TAKEN`, `ASSISTANT_PRICE_CHANGED`, `ASSISTANT_DRAFT_INCOMPLETE`, `ASSISTANT_MODEL_UNAVAILABLE`, `ASSISTANT_QUOTA_EXCEEDED`, `ASSISTANT_DRAFT_NOT_FOUND`, `ASSISTANT_DRAFT_ALREADY_CONFIRMED`).
- Tema claro y oscuro, mobile-first, targets ≥ 44 px.

---

## 6. Infraestructura (`infrastructure_v2/`)

| Recurso | Detalle |
|---------|---------|
| Cuenta Azure AI Foundry (`azurerm_cognitive_account`, kind `AIServices`) + proyecto | En `var.location` (`centralus`). Incluye Speech y Content Safety. |
| Deployment del modelo (`azurerm_cognitive_deployment`) | gpt-5-mini (o vigente). SKU regional en `centralus` si está disponible; si no, Data Zone US (confirmar en fase 0). Cuota TPM acotada. |
| Filtro de contenido | Con Prompt Shields activado. |
| Role assignments | Identidad del Container App: *Cognitive Services OpenAI User* y *Cognitive Services User* (Speech). Grupo `femme-sql-admins`: los mismos roles para desarrollo local. |
| Variables del Container App | `FEMME_AI_ENDPOINT`, `FEMME_AI_DEPLOYMENT`, `FEMME_SPEECH_REGION`. Sin secretos. |
| Diagnostic settings | Al Log Analytics existente. |
| Desarrollo local | Documentar en `CLAUDE.md` cómo apuntar a Foundry de dev (igual que Key Vault/Service Bus) o usar el doble del modelo con `FEMME_ASSISTANT_MODEL=fake`. |

---

## 7. Estrategia de pruebas

Según CLAUDE.md, **cada criterio de aceptación** de cada HU debe tener un test de Playwright.

| Nivel | Qué | Cómo |
|-------|-----|------|
| Unitarios backend | `AvailabilityService`, `AssistantDraftService` (estados, idempotencia, vencimiento, revalidación), herramientas (aislamiento de tenant, filtrado por rol), resolución de fechas relativas | JUnit 5 + H2 |
| Integración backend | Orquestador con `AssistantModelClient` guionado: secuencias de llamadas a herramientas → eventos SSE esperados | `@SpringBootTest` |
| Unitarios frontend | Parser SSE, tarjetas por estado, chips, composer | Vitest |
| E2E | Todos los AC de las HUs del asistente | Playwright con el **modelo guionado** del perfil `e2e` (respuestas determinísticas por patrón de entrada). Sin llamadas a Foundry ni a Speech (Speech se simula inyectando texto). |
| Multi-tenant | Un usuario del tenant A no ve clientes, turnos ni borradores del tenant B a través del asistente | Agregar spec a la suite `test:mt` (`tests/mt-isolation/mt-asistente.spec.ts`) |
| Calidad del modelo | Conjunto de ~100 pedidos reales anonimizados (español de Paraguay) con la herramienta y argumentos esperados; casos de inyección | Evaluaciones en Foundry (`azure-ai-projects`) o script propio; corre manual/nocturno, no en cada PR |

Si algún AC no se puede cubrir con Playwright (por ejemplo, calidad del reconocimiento de voz real), avisar y acordar cómo seguir.

---

## 8. Fases e historias de usuario

Cada fase se libera detrás de `ASSISTANT_CHATBOT`. Las HUs se crean en `requirements/user_stories/` con el formato habitual (ID propuesto `HU-AST-xx`).

### Fase 0 · Base técnica

- Terraform: cuenta de Foundry, deployment, filtro de contenido, roles, variables.
- Validar en dev: disponibilidad del modelo en `centralus`; que el starter de OpenAI de Spring AI acepte token de Entra ID (si no, bean propio con `openai-java`).
- Dependencias Spring AI; `AssistantModelClient` real + guionado.
- Migraciones `V103`/`V104`; feature flag.
- **Listo cuando:** en dev el backend recibe una respuesta del modelo real con identidad administrada, y en `e2e` el doble responde.

### Fase 1 · Panel y consultas (solo lectura) — `HU-AST-01`, `HU-AST-02`

- **HU-AST-01 Abrir el asistente desde cualquier pantalla.** Botón en cabecera visible solo con el flag; `Ctrl K`; panel acoplado que persiste al navegar; pantalla completa en teléfono; «Nueva conversación»; historial de la conversación actual al recargar; mensaje de bienvenida con sugerencias.
- **HU-AST-02 Consultar datos por chat.** Herramientas de lectura; preguntas como «¿cuántos turnos tiene Lucía hoy?» o «¿qué servicios hace Hugo?»; respuesta en streaming; aislamiento por tenant; errores traducidos; fallback cuando no entiende.
- Métricas de tokens y latencia por tenant en App Insights (insumo para la decisión de costos).

### Fase 2 · Facturar con borrador — `HU-AST-03`, `HU-AST-04`

- **HU-AST-03 Proponer y emitir una factura desde el chat.** Borrador solo en el chat; toma los servicios del día del cliente si no se indican; pide lo que falta (cliente, servicios, medio de pago, email si SIFEN lo exige) con chips; cambios por chat reemplazan el borrador; «Descartar»; vence a las 24 h; «Confirmar y emitir» emite por el camino existente (con y sin SIFEN); revalidación; idempotencia; estado SIFEN en la tarjeta; texto «sí/dale» no emite.
- **HU-AST-04 Compartir la factura con el cliente.** Botón «Compartir con el cliente» abre `InvoiceDetailModal` en «Compartir»; «Compartir» disponible también para el comprobante no fiscal (WhatsApp + endpoint nuevo de email). Actualizar los specs existentes del detalle de factura que dependan de `kudeEligible`.

### Fase 3 · Disponibilidad y turnos — `HU-AST-05`, `HU-AST-06`

- **HU-AST-05 Consultar disponibilidad.** `AvailabilityService` (horario del profesional, turnos, servicios que hace, duración, franja mañana/tarde, «hoy» desde ahora); horarios como chips; aviso si el profesional no hace el servicio; sugerencia de otro día si no hay huecos.
- **HU-AST-06 Agendar un turno desde el chat.** Propuesta de turno con borrador; pide cliente/servicio/hora faltantes; cambios por chat («mejor a las 16», «con Hugo»); confirmación crea el turno en estado «Pendiente»; conflicto → `ASSISTANT_SLOT_TAKEN` con alternativas; «Ver en la agenda» navega con el panel abierto.

### Fase 4 · Dictado — `HU-AST-07`

- **HU-AST-07 Dictar instrucciones.** Botón micrófono; permisos del navegador; texto parcial en el campo; el usuario revisa y envía; el mensaje queda marcado «Dictado»; errores de micrófono/red traducidos. E2E con el dictado simulado (inyección de transcripción).

### Fase 5 · Endurecimiento y salida

- Evaluaciones con pedidos reales anonimizados; comparar el modelo inicial con *nano* y uno más capaz; ajustar.
- Pruebas de inyección (nombres/notas de clientes con instrucciones).
- Cupos por tenant y política de costos (cuando se defina).
- Tablero en App Insights (tokens, costo estimado, latencia, tasa de confirmación de borradores, errores).
- Activación gradual por salón.

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Modelo no disponible en `centralus` | Data Zone US como alternativa; decidir en fase 0. |
| Spring AI 2.x no acepta Entra ID directo | Bean propio de `openai-java` con `azure-identity`. |
| El modelo elige mal herramientas o argumentos | El backend valida todo; borrador visible antes de confirmar; evaluaciones; subir de modelo si hace falta. |
| Inyección de instrucciones desde datos del salón | Nada se escribe sin confirmación humana; Prompt Shields; herramientas de lectura con campos mínimos. |
| Doble emisión | Idempotencia por id de borrador + lock de estado. |
| Precio u horario cambian entre propuesta y confirmación | Recalcular y comparar hash al confirmar. |
| Costos | Métricas desde fase 1; cupos por tenant; modelo chico por defecto. |
| E2E no determinísticos | Modelo guionado en perfil `e2e`; evaluaciones del modelo real fuera de CI. |

---

## 10. Pendientes

- Costo por salón y cupos (TBD).
- Confirmar versiones exactas de Spring AI / `openai-java` / `azure-identity` en Maven Central.
- Confirmar qué roles pueden facturar y agendar hoy, para filtrar herramientas por rol.
- Definir el texto del prompt de sistema y el conjunto de evaluación inicial.
