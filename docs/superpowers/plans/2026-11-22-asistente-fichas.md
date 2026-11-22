# Asistente: fichas de servicio desde el chat · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La administradora y la profesional crean o editan fichas de servicio conversando con el asistente (tarjeta + botón «Guardar ficha»), cada una con los datos que su rol autoriza, y la factura desde la ficha arranca sin preguntar qué cobrar.

**Architecture:** Un tercer tipo de borrador, `SERVICE_RECORD`, junto a `INVOICE` y `APPOINTMENT`. Dos herramientas nuevas (`ver_ficha_abierta`, `proponer_ficha`) arman el borrador en `AssistantRecordDrafts`; el botón confirma por `AssistantDraftService` llamando a los servicios de siempre (`ServiceRecordService`, `AppointmentServiceRecordService`). El rol se aplica en el servidor: a la profesional el payload se guarda y se envía sin montos.

**Tech Stack:** Spring Boot 4.2 (Java 21, Jackson 3 `tools.jackson`, JUnit 5/Mockito, H2), React 18 + TypeScript + Vitest, Playwright (`e2e/`).

**Spec:** `docs/superpowers/specs/2026-11-22-asistente-fichas-design.md` (en adelante «el diseño»; sus secciones se citan como §n).

## Global Constraints

- Todo texto visible por `t()` con claves en **`en.json` y `es.json`**; errores del backend en `SCREAMING_SNAKE_CASE`, traducidos en `femme.apiErrors.*`.
- Tras editar Java: `./gradlew spotlessApply --no-daemon`; antes de cerrar: `spotlessCheck`. Frontend: `npx tsc --noEmit` es el lint. Solo `npm`.
- Montos del asistente: `Gs. 50.000` (`AssistantMoney.gs`). Nunca texto de conversación en logs.
- **Cada criterio de aceptación de la HU-AST-08 tiene su Playwright** (UI en inglés). Playwright no levanta el backend: arrancarlo con `SPRING_PROFILES_ACTIVE=e2e ./gradlew bootRun --no-daemon` (y parar el 8080/5173 locales antes de correr e2e).
- El modelo propone, la persona confirma: **ninguna herramienta escribe una ficha**; solo el endpoint `POST /api/assistant/drafts/{id}/confirm`.
- Un solo borrador activo por conversación (una propuesta nueva reemplaza la anterior, de cualquier tipo).
- La profesional **nunca** recibe un monto de ficha: ni en herramientas, ni en errores con `extra`, ni en el DTO del borrador, ni en el resultado de confirmar, ni por SSE.
- Los commits son **checkpoints que solo se hacen si el usuario lo pide** (preferencia vigente); los pasos «Checkpoint» dicen qué agregar. El trabajo va al PR #444 (`feat/asistente_chat`).
- Ya está hecho y sin commit: el ajuste de prompt de la parte 2 (reglas 10/11 de `system-prompt.md`, descripción de `proponer_factura`, aserciones en `AssistantOrchestratorTest`). La Tarea 1 lo documenta.

## Review Focus

1. **Fuga de montos a la profesional** por rutas laterales: `extra` de `MULTIPLE_RECORDS`/`STALE_RECORD`, el DTO tras recargar, el 409 `ASSISTANT_RECORD_CHANGED`, `tool.status`. Esperado: ningún campo de monto, ni vacío.
2. **Cantidades y posiciones inválidas:** `quantity` 0, negativa o > 99; `position` fuera de rango; el mismo servicio agregado dos veces. Esperado: error claro, nunca una ficha corrupta.
3. **El mundo cambió antes del botón:** ficha cerrada/anulada/facturada, turno cancelado o ya ligado, cliente desactivado. Esperado: 409 con código traducido y el borrador sigue vivo.
4. **Doble toque / dos pestañas** sobre «Guardar ficha». Esperado: una sola ficha, segundo toque = 409 con el resultado original.
5. **Cliente de otro salón o borrador de otra persona** por id. Esperado: 404, sin crear nada.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `assistant/AssistantDraftType.java` (mod) | agrega `SERVICE_RECORD` |
| `assistant/AssistantDraftPayloads.java` (mod) | records `ServiceRecordDraftPayload` (+ `Line`, `LineKey`, `Change`, `NotApplied`) |
| `assistant/AssistantRecordDrafts.java` (nuevo) | lógica de negocio: resolver crear/editar, aplicar cambios, claves de línea, huella, enmascarado por rol, rebase y commit |
| `assistant/AssistantRecordTools.java` (nuevo) | `ver_ficha_abierta`, `proponer_ficha`: specs por rol, parseo de argumentos, tarjeta |
| `assistant/AssistantTools.java` (mod) | cablea las herramientas nuevas (como `agenda`/`proposals`) |
| `assistant/AssistantDraftService.java` (mod) | `createRecordDraft`, `activeRecordPayload`, rama `confirmServiceRecord`, `ConfirmResult.serviceRecordId/recordOperation` |
| `assistant/AssistantDraftController.java` (mod) | auditoría `service-records` create/update con origen `ASSISTANT` |
| `assistant/AssistantProposalTools.java` (mod) | `FICHA_DRAFT_PENDING` en `proponer_factura` |
| `assistant/ScriptedAssistantModelClient.java` (mod) | palabras clave `record …` |
| `resources/assistant/system-prompt.md` (mod) | regla de fichas |
| `frontend/src/api/assistant.ts`, `assistant/AssistantContext.tsx`, `components/assistant/ServiceRecordDraftCard.tsx` (nuevo), `AssistantMessageList.tsx`, i18n en/es | tarjeta y flujo |
| `e2e/tests/asistente/hu-ast-08-…spec.ts` (nuevo), `e2e/fixtures/assistant.ts`, `e2e/tests/mt-isolation/mt-asistente.spec.ts` | pruebas |
| `requirements/user_stories/HU-AST-08-…md` (nuevo), `HU-AST-03` (mod), `CLAUDE.md` (mod) | documentación |

---

### Task 1: Historia HU-AST-08 y AC20 de HU-AST-03

**Files:**
- Create: `requirements/user_stories/HU-AST-08-fichas-de-servicio-desde-el-chat.md` (formato de `HU-AST-03-…md`)
- Modify: `requirements/user_stories/HU-AST-03-proponer-y-emitir-factura-desde-el-chat.md` (agregar AC20)

- [ ] **Step 1: Escribir HU-AST-08** con estos criterios, uno por línea, en el estilo de la HU-AST-03 (título en negrita + comportamiento observable). Las referencias entre paréntesis son al diseño:
  1. **Leer la ficha** (§6.1): «¿qué tiene la ficha de Juan?» responde con sus líneas; la administradora ve montos `Gs. 50.000`, la profesional no ve ninguno.
  2. **Crear ligada al turno** (§6.2): con un solo turno hoy y sin ficha, la tarjeta muestra la línea del turno + lo pedido; «Guardar ficha» crea la ficha, el turno pasa a «En curso» y queda ligado.
  3. **Crear suelta** (§6.2): sin turno hoy, la administradora crea la ficha solo con lo pedido.
  4. **Varios turnos hoy** (§6.2): el asistente pregunta cuál (por hora y servicio).
  5. **Profesional: solo con turno propio** (§4, §6.2): sin turno propio hoy no se crea nada y se explica; un turno ajeno se rechaza.
  6. **Editar la ficha abierta** (§6.1): agregar, quitar, cambiar cantidad y profesional; la tarjeta marca lo agregado (+), lo quitado y lo cambiado.
  7. **Precio dicho** (§6.1): la administradora fija un precio dicho en el pedido; la profesional no puede fijar precios y no los ve.
  8. **La profesional nunca ve montos** (§3, §6.4): ni en la lectura, ni en la tarjeta, ni al recargar, ni al guardar.
  9. **Varias fichas / ficha vieja** (§6.2): con varias fichas abiertas pregunta cuál; con una ficha abierta de un día anterior pregunta si editar esa o abrir una nueva para hoy.
  10. **Cambios sobre el borrador pendiente** (§6.6): un segundo pedido se suma al borrador; la tarjeta vieja queda «Reemplazado».
  11. **Ficha cambiada antes de guardar** (§6.5): no guarda; la tarjeta se rehace con el estado actual, los cambios que ya no aplican se muestran «no aplicados» y se pide confirmar de nuevo.
  12. **Doble toque** (§6.5): una sola ficha; el segundo toque responde 409 `ASSISTANT_DRAFT_ALREADY_CONFIRMED`.
  13. **Descartar, vencer y recargar**: «Descartar» o pedirlo por chat atenúa la tarjeta; vence a las 24 h; al recargar la tarjeta (o la ficha guardada) sigue ahí.
  14. **Factura con ficha sin guardar** (§6.8): `proponer_factura` responde `FICHA_DRAFT_PENDING` y el asistente pide guardar o descartar antes.
  15. **Aislamiento** (§6.9): clientes, turnos y borradores de otro salón o de otra persona no se ofrecen ni se confirman.
  16. **Auditoría** (§6.5): guardar registra `service-records`/`create|update` con origen `ASSISTANT`.
- [ ] **Step 2: AC20 en HU-AST-03:** «**Sin indicar qué cobrar — Primero la ficha.** Pedir «facturale a <cliente>» o «facturemos los servicios de <cliente>» sin nombrar ítems llama de inmediato a `proponer_factura` sin ítems (no pregunta qué cobrar ni lista el catálogo): el borrador sale de la ficha abierta o del único turno de hoy; solo si no hay nada que cobrar (`NOTHING_TO_INVOICE`) el asistente pide qué cobrar.» Nota en la historia: la instrucción al modelo real se verifica a mano; el Playwright cubre el borrador desde la ficha (AC2) y el test de prompt cubre el texto de la regla.
- [ ] **Step 3: Checkpoint** (solo si el usuario lo pide): `git add requirements src/backend/src/main/resources/assistant/system-prompt.md src/backend/src/main/java/com/cursorpoc/backend/assistant/AssistantProposalTools.java src/backend/src/test/java/com/cursorpoc/backend/assistant/AssistantOrchestratorTest.java` y mensaje `feat(assistant): factura desde la ficha sin preguntar qué cobrar + historia HU-AST-08`.

---

### Task 2: Payload y lógica de negocio del borrador de ficha

**Files:**
- Modify: `assistant/AssistantDraftType.java`, `assistant/AssistantDraftPayloads.java`
- Create: `assistant/AssistantRecordDrafts.java`
- Test: `src/test/java/com/cursorpoc/backend/assistant/AssistantRecordDraftsTest.java` (Mockito, estilo de `AssistantInvoiceDraftsTest`)

**Interfaces — Produces** (paquete `com.cursorpoc.backend.assistant`):
```java
// AssistantDraftType: INVOICE, APPOINTMENT, SERVICE_RECORD
// AssistantDraftPayloads:
public record ServiceRecordDraftPayload(
    Long clientId, String clientName,
    Long serviceRecordId,            // null = ficha nueva
    Long appointmentId,              // turno a ligar; null = ninguno
    String appointmentTime,          // "HH:mm" para la tarjeta, o null
    List<Line> lines,                // lista RESULTANTE, en orden; position = índice + 1
    List<Change> changes,            // cambios pedidos, con claves estables
    List<NotApplied> notApplied,     // cambios que ya no encontraron su línea (rebase)
    @JsonInclude(NON_NULL) BigDecimal total,   // null para la profesional
    String recordFingerprint) {      // huella del estado de la ficha al proponer (null si nueva)
  public record Line(int position, Long serviceId, String name, int quantity,
      @JsonInclude(NON_NULL) BigDecimal unitPrice, @JsonInclude(NON_NULL) BigDecimal lineTotal,
      Long professionalId, String professionalName, String mark /* NEW|KEPT|CHANGED|REMOVED */) {}
  public record LineKey(Long serviceId, Long professionalId, int occurrence) {}
  public record Change(String op /* ADD|REMOVE|CHANGE */, LineKey key, Long serviceId,
      Integer quantity, Long professionalId, BigDecimal unitPrice) {}
  public record NotApplied(String op, String name) {}
}
// AssistantRecordDrafts (@Component):
public record Request(Long clientId, Long appointmentId, Long recordId, boolean newRecord,
    List<Add> add, List<Integer> remove, List<ChangeReq> change) {
  public record Add(Long id, int quantity, Long professionalId, BigDecimal unitPrice) {}
  public record ChangeReq(int position, Integer quantity, Long professionalId, BigDecimal unitPrice) {} }
ServiceRecordDraftPayload build(AssistantContext ctx, Request req, Optional<ServiceRecordDraftPayload> pending);
Map<String,Object> view(AssistantContext ctx, long clientId, Optional<ServiceRecordDraftPayload> pending); // JSON de ver_ficha_abierta
ServiceRecordDraftPayload rebase(AssistantContext ctx, ServiceRecordDraftPayload old);   // reaplica `changes` sobre el estado actual
long commit(FemmeUserPrincipal principal, ServiceRecordDraftPayload fresh);              // devuelve el id de la ficha guardada
static String fingerprint(ServiceRecordDraftPayload p);                                  // SHA-256 de recordId, appointmentId y líneas resultantes
```
Errores = `AssistantTools.ToolException(code[, extra])`.

- [ ] **Step 1: Tests (fallan primero)** en `AssistantRecordDraftsTest`, un `@Test` por línea, con los códigos y valores del diseño:
  - `createsLinkedToTheOnlyAppointmentOfToday`: sin ficha y con un turno de hoy → `appointmentId` del turno, línea 1 = servicio del turno (`mark` KEPT), lo pedido `NEW`.
  - `createsLooseWhenAdminHasNoAppointmentToday` y `professionalWithoutOwnAppointmentGetsNoAppointmentToday` (`NO_APPOINTMENT_TODAY`) y `professionalOnAnotherProfessionalsAppointmentIsRefused` (`APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL`).
  - `severalAppointmentsToday` → `MULTIPLE_APPOINTMENTS` con `extra.appointments` (hora, servicio); sin montos.
  - `editsTheOnlyOpenRecordOfToday`: agregar / quitar por posición / cambiar cantidad y profesional → líneas y marcas `NEW`/`REMOVED`/`CHANGED`.
  - `severalOpenRecords` → `MULTIPLE_RECORDS` (`extra.records`: id, fecha, servicios); `staleOpenRecordAsksFirst` → `STALE_RECORD`; con `newRecord=true` crea nueva y con `recordId` edita esa.
  - `nothingToSave` (`NOTHING_TO_SAVE`) al quitar todas las líneas o crear sin nada que agregar y sin turno.
  - `invalidArguments`: `quantity` 0/-1/100 → `INVALID_ARGUMENTS`; `position` fuera de rango → `INVALID_LINE_POSITION`; `unitPrice` ≤ 0 → `INVALID_PRICE`.
  - `adminPriceSaidIsKept` y `professionalCannotSetPrices` (`PRICE_NOT_ALLOWED`).
  - **`professionalPayloadHasNoAmounts`**: serializar el payload y los `extra` de los errores de la profesional con Jackson y afirmar que el JSON no contiene `unitPrice`, `lineTotal`, `total` ni `price` (Review Focus 1).
  - `appliesOnTopOfAPendingDraft`: con `pending` presente, las posiciones se resuelven sobre su lista resultante (§6.1/§6.6).
  - `rebaseReappliesChangesAndReportsMissingLines`: con la ficha cambiada, `rebase` reaplica por `LineKey` y deja `NotApplied` para la línea que ya no existe (§6.5); `fingerprint` cambia si cambian las líneas.
  - `clientOfAnotherTenantIsNotFound`.
- [ ] **Step 2:** `cd src/backend && ./gradlew test --tests "*AssistantRecordDraftsTest" --no-daemon` → falla por clase inexistente.
- [ ] **Step 3: Implementar** `AssistantDraftType.SERVICE_RECORD`, los records de `AssistantDraftPayloads` y `AssistantRecordDrafts` con las firmas de arriba. Aproximación: inyectar `ClientService`, `ServiceRecordRepository` (`findByTenantAndClientAndStatusWithLines`), `ServiceRecordService`, `AppointmentServiceRecordService`, `AppointmentService`, `ServiceCatalogService`, `ProfessionalDirectoryService`, `FemmeTimeProperties`. «Hoy» = día de negocio (`FemmeTimeProperties.zoneId()`, nunca `systemDefault`). Una ficha vieja es la que `createdAt` cae antes de hoy. `LineKey.occurrence` = n.º de ocurrencia del par (servicio, profesional) en la lista. Línea sin profesional en la profesional = la suya. Los montos salen de la ficha / catálogo (nunca de argumentos del modelo salvo `unitPrice` de la administradora); para la profesional no se calculan montos en absoluto.
- [ ] **Step 4:** correr el test del Step 2 → PASS. Luego `./gradlew spotlessApply --no-daemon`.
- [ ] **Step 5: `commit`**: administradora crea con `ServiceRecordService.createServiceRecord` (y liga con `AppointmentServiceRecordService.assign` si hay `appointmentId`, o usa `createFromAppointment` + `updateServiceRecord` cuando la ficha debe arrancar del turno) y edita con `updateServiceRecord`; la profesional crea con `createFromAppointment` y edita con `updateServicesAsProfessional(tenantId, id, request, professionalId)`. Test `commitUsesTheRoleSpecificService` (Mockito `verify`) para ambos roles, creando y editando.
- [ ] **Step 6: Checkpoint:** `git add src/backend/src/main/java/com/cursorpoc/backend/assistant src/backend/src/test/java/com/cursorpoc/backend/assistant` · `feat(assistant): borrador de ficha de servicio (payload y reglas por rol)`.

---

### Task 3: Herramientas `ver_ficha_abierta` y `proponer_ficha`

**Files:**
- Create: `assistant/AssistantRecordTools.java`
- Modify: `assistant/AssistantTools.java` (cableado), `assistant/AssistantDraftService.java` (`createRecordDraft`, `activeRecordPayload`), `assistant/AssistantProposalTools.java` (`FICHA_DRAFT_PENDING`)
- Test: `AssistantRecordToolsTest.java`, ampliar `AssistantToolsTest` y `AssistantInvoiceDraftsTest`/`AssistantProposalTools` según corresponda

**Interfaces — Consumes:** `AssistantRecordDrafts.build/view` (Tarea 2); `ToolOutcome`/`CardEvent`, `EVENT_DRAFT`/`EVENT_DRAFT_UPDATED` y el patrón de `AssistantAgendaTools.proponerTurno` para emitir tarjeta y atenuar los reemplazados.
**Produces:**
```java
// AssistantRecordTools (@Component)
static final String VER_FICHA_ABIERTA = "ver_ficha_abierta";
static final String PROPONER_FICHA = "proponer_ficha";
boolean handles(String name);
List<ToolSpec> specsFor(AssistantContext ctx);           // ambas herramientas para ADMIN y PROFESSIONAL; `unitPrice` solo en el esquema del ADMIN
ToolOutcome run(AssistantContext ctx, String name, JsonNode args);
// AssistantDraftService
Created createRecordDraft(AssistantContext ctx, ServiceRecordDraftPayload payload);
Optional<ServiceRecordDraftPayload> activeRecordPayload(AssistantContext ctx);
```
Esquema de `proponer_ficha` (§6.1): `clientId` (requerido), `appointmentId?`, `recordId?`, `newRecord?`, `agregar[{id,quantity,professionalId?,unitPrice?}]`, `quitar[int]`, `cambiar[{position,quantity?,professionalId?,unitPrice?}]`. Descripciones en español rioplatense, como las demás.

- [ ] **Step 1: Tests (fallan primero)**:
  - `AssistantRecordToolsTest`: `specsAreOfferedToBothRoles`; `professionalSpecHasNoUnitPrice`; `verFichaAbiertaForProfessionalReturnsNoAmounts` (JSON sin claves de monto); `proponerFichaCreatesADraftAndACard` (evento `card.draft`, tipo `SERVICE_RECORD`); `proponerFichaSupersedesThePreviousDraft` (`card.draft.updated` SUPERSEDED); `refusalCodesReachTheModelWithExtra`.
  - `AssistantToolsTest`: `isKnown` y `specsFor` incluyen las dos herramientas.
  - `proponerFacturaRefusesWhileARecordDraftIsActive`: con borrador de ficha activo de la misma clienta → `ToolException("FICHA_DRAFT_PENDING")`; con otra clienta o sin borrador de ficha, no.
- [ ] **Step 2:** correr `./gradlew test --tests "*AssistantRecordToolsTest" --tests "*AssistantToolsTest" --no-daemon` → FAIL.
- [ ] **Step 3: Implementar** `AssistantRecordTools` y el cableado en `AssistantTools` (constructor, `isKnown`, `specsFor`, despacho de `run`, igual que `agenda`). `createRecordDraft` usa `create(ctx, SERVICE_RECORD, payload, AssistantRecordDrafts.fingerprint(payload))`; `activeRecordPayload` copia a `activeInvoicePayload` filtrando por el tipo. `proponer_ficha` pasa `activeRecordPayload` como `pending` **solo si es de la misma clienta**. En `proponerFactura` y `agregarItem`, antes de armar el borrador, lanzar `FICHA_DRAFT_PENDING` si `activeRecordPayload(ctx)` es de ese `clientId`.
- [ ] **Step 4:** tests del Step 2 → PASS; `spotlessApply`.
- [ ] **Step 5: Checkpoint:** `feat(assistant): herramientas ver_ficha_abierta y proponer_ficha`.

---

### Task 4: Guardar la ficha (confirmar), auditoría y cambio de ficha

**Files:**
- Modify: `assistant/AssistantDraftService.java` (rama `SERVICE_RECORD`, `ConfirmResult`), `assistant/AssistantDraftController.java` (auditoría)
- Test: `AssistantDraftIntegrationTest.java` (nuevos tests; fixture ya existe)

**Interfaces — Consumes:** `AssistantRecordDrafts.rebase/commit/fingerprint` (Tarea 2).
**Produces:** `ConfirmResult` gana `Long serviceRecordId` y `String recordOperation` (`"create"`/`"update"`) — actualizar las construcciones en `confirmInvoice` y `confirmAppointment` (con `null`). Errores: `409 ASSISTANT_RECORD_CHANGED` (cuerpo con `draft`), y pasa tal cual el código del servicio (`SERVICE_RECORD_NOT_OPEN`, `APPOINTMENT_ALREADY_HAS_SERVICE_RECORD`, `APPOINTMENT_NOT_ACTIVE`).

- [ ] **Step 1: Tests de integración (fallan primero)** sobre la API real con el modelo guionado, agregando a `AssistantDraftIntegrationTest`:
  - `adminSavesALinkedRecord`: proponer → confirmar → la ficha existe con las líneas esperadas, el turno quedó «En curso» y ligado; `draft.status=CONFIRMED`, `resultType=SERVICE_RECORD`.
  - `professionalSavesAndNeverSeesAmounts`: toda la respuesta de propuesta, `GET conversations/current` y confirmar, serializada, no contiene `unitPrice`/`lineTotal`/`total` (Review Focus 1).
  - `doubleConfirmCreatesOneRecord` (dos confirmaciones concurrentes → una ficha; la segunda 409 `ASSISTANT_DRAFT_ALREADY_CONFIRMED`).
  - `changedRecordIsNotSavedAndIsRebased`: cambiar la ficha por la API de fichas entre propuesta y confirmar → 409 `ASSISTANT_RECORD_CHANGED` con el borrador rehecho (`notApplied` cuando una línea desapareció); un segundo confirmar guarda.
  - `closedRecordOrBusyAppointmentKeepsTheDraft` (409 con el código del servicio, estado `DRAFT`).
  - `otherPersonOrTenantCannotConfirm` (404) y `professionalCannotConfirmAnotherProfessionalsNewRecord` (`FORBIDDEN`/`APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL`).
  - `confirmIsAuditedAsAssistantSource`: fila `service-records`/`create|update`, `source=ASSISTANT`.
- [ ] **Step 2:** `./gradlew test --tests "*AssistantDraftIntegrationTest" --no-daemon` → FAIL.
- [ ] **Step 3: Implementar** `confirmServiceRecord(principal, tenantId, userId, d)` siguiendo `confirmAppointment`/`confirmInvoice`: permiso (admin, o profesional con `professionalId`), `claim` atómico, `rebase` y comparación de `fingerprint` (si difiere: guardar el payload rehecho, volver a `DRAFT` y devolver el resultado «cambió» → `AssistantDraftException(409, "ASSISTANT_RECORD_CHANGED", Map.of("draft", dto))`, igual que `Repriced`), luego `commit`, `CONFIRMED` y `setResult("SERVICE_RECORD", id)`. Los errores de servicio (`ResponseStatusException`) se propagan con su razón. En `toDto`, `missing` queda vacío para este tipo. En el controlador, registrar `recordBusinessAction(principal, "service-records", result.recordOperation(), id, SOURCE_ASSISTANT)`.
- [ ] **Step 4:** tests → PASS; `./gradlew spotlessApply spotlessCheck test --no-daemon` completo en verde.
- [ ] **Step 5: Checkpoint:** `feat(assistant): guardar la ficha desde la tarjeta`.

---

### Task 5: Prompt y modelo guionado

**Files:**
- Modify: `src/main/resources/assistant/system-prompt.md`, `assistant/ScriptedAssistantModelClient.java`
- Test: `AssistantOrchestratorTest` (prompt), `ScriptedAssistantModelClientTest`

- [ ] **Step 1: Tests (fallan primero):**
  - `AssistantOrchestratorTest`: el prompt contiene `ver_ficha_abierta`, `proponer_ficha`, «nunca digas que la ficha ya está guardada» y «La profesional nunca ve montos».
  - `ScriptedAssistantModelClientTest` (palabras clave en inglés, según §7 del diseño): `record Juan` → pide `buscar_clientes` y luego `ver_ficha_abierta`; `record Juan add Cut x2 at 45000` → `proponer_ficha` con `agregar:[{id,quantity:2,unitPrice:45000}]`; `record Juan remove 2` → `quitar:[2]`; `record Juan set 1 x3` → `cambiar:[{position:1,quantity:3}]`; `record Juan new` → `newRecord:true`; el texto de éxito para una ficha («Preparé la ficha de … para que la revises.») y los de error por código (`MULTIPLE_RECORDS`, `STALE_RECORD`, `MULTIPLE_APPOINTMENTS`, `NO_APPOINTMENT_TODAY`, `FICHA_DRAFT_PENDING`, `PRICE_NOT_ALLOWED`).
- [ ] **Step 2:** correr los dos tests → FAIL.
- [ ] **Step 3: Prompt.** Agregar sección «Fichas de servicio» con las reglas: (a) para abrir o cambiar una ficha, primero `ver_ficha_abierta` y después `proponer_ficha` con SOLO los cambios; las posiciones son las que devolvió `ver_ficha_abierta`; (b) preguntar según los códigos `MULTIPLE_RECORDS`, `STALE_RECORD` (¿editar esa o abrir una nueva para hoy?), `MULTIPLE_APPOINTMENTS`; `NO_APPOINTMENT_TODAY` → explicar que una profesional solo abre fichas desde un turno propio; (c) la tarjeta ya muestra todo: pedir que la revise y la guarde con «Guardar ficha»; nunca decir que ya está guardada; (d) la profesional nunca ve montos: no los menciones ni los pidas; solo la administradora puede decir un precio; (e) si responde `FICHA_DRAFT_PENDING` al facturar, pedir que guarde o descarte la ficha primero. Actualizar las reglas 1 y 7 para mencionar fichas.
- [ ] **Step 4: Modelo guionado.** Agregar el patrón `RECORD` (`(?i)^\s*(?:record|ficha)\s+(.+?)(?:\s+(add|remove|set|new)\b(.*))?$`) y el manejo en el flujo de herramientas, siguiendo `ADD`/`itemArgs`; reutilizar `QUANTITY` y `PRICE`.
- [ ] **Step 5:** tests → PASS; `spotlessApply`.
- [ ] **Step 6: Checkpoint:** `feat(assistant): prompt y modelo guionado para fichas`.

---

### Task 6: Frontend, tarjeta de ficha

**Files:**
- Modify: `src/frontend/src/api/assistant.ts` (tipo `ServiceRecordDraftPayload`, `AssistantDraft.type` y `DraftConfirmResult.type` aceptan `"SERVICE_RECORD"`, `serviceRecordId?`), `assistant/AssistantContext.tsx` (`recordChanged?: boolean` en la tarjeta; manejar `ASSISTANT_RECORD_CHANGED` como `ASSISTANT_PRICE_CHANGED`; el resultado de `ALREADY_CONFIRMED` usa `draft.type` en vez de `"INVOICE"` fijo), `components/assistant/AssistantMessageList.tsx` (rutear `SERVICE_RECORD`), `i18n/locales/en.json` y `es.json`
- Create: `components/assistant/ServiceRecordDraftCard.tsx`, `ServiceRecordDraftCard.test.tsx`

**Interfaces — Produces:** `ServiceRecordDraftCard({ card, onConfirm, onDiscard, onViewRecord? })`, mismos `data-testid` que las otras tarjetas (`assistant-draft-card` con `data-type="SERVICE_RECORD"`, `data-draft-id`, `data-status`, `assistant-draft-confirm`, `assistant-draft-discard`, `assistant-draft-error`) más `assistant-record-line-{n}` (con `data-mark`), `assistant-record-total` (solo si el payload trae `total`), `assistant-record-appointment`, `assistant-record-not-applied`, `assistant-record-changed`.

- [ ] **Step 1: Tests Vitest (fallan primero)** en `ServiceRecordDraftCard.test.tsx`: la administradora ve líneas con monto `Gs. 50.000` y total; **la profesional** (payload sin `unitPrice`/`total`) no renderiza ningún elemento de monto ni de total (`queryByTestId('assistant-record-total')` nulo y el texto `Gs.` ausente); marcas `NEW`/`REMOVED`/`CHANGED` visibles; «no aplicado» y el aviso de ficha cambiada; estados (guardada en verde «Ficha guardada», reemplazada/descartada/vencida atenuadas); botones llaman `onConfirm`/`onDiscard`; `busy` deshabilita.
- [ ] **Step 2:** `cd src/frontend && npm run test -- ServiceRecordDraftCard` → FAIL.
- [ ] **Step 3: Implementar** la tarjeta copiando la estructura de `AppointmentDraftCard.tsx` (badge de estado, `ACTION_BUTTON`, colores de marco). Líneas con prefijo `+`/tachado según `mark`. Toda cadena por `t()` en `femme.assistant.recordDraft.*` (título, `savedTitle`, `savedBadge`, `confirm` «Guardar ficha», `confirming`, `appointment`, `changed`, `notApplied`, marcas) y `femme.assistant.tool.ver_ficha_abierta` / `proponer_ficha` (estado «Consultando la ficha…» / «Preparando la ficha…»). Agregar claves de errores que no existan en `femme.apiErrors`: `ASSISTANT_RECORD_CHANGED`, `SERVICE_RECORD_NOT_OPEN`, `APPOINTMENT_ALREADY_HAS_SERVICE_RECORD`, `APPOINTMENT_NOT_ACTIVE`, `APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL` (verificar cuáles ya están). Botones ≥ 44 px (`sm:h-11 sm:min-h-11`).
- [ ] **Step 4:** el test del Step 2 → PASS; `npx tsc --noEmit`; `npm run test` completo (incluye la paridad en/es de `locales.test.ts`).
- [ ] **Step 5: Checkpoint:** `feat(assistant): tarjeta de ficha de servicio`.

---

### Task 7: Playwright, aislamiento y documentación

**Files:**
- Create: `e2e/tests/asistente/hu-ast-08-fichas-desde-el-chat.spec.ts`
- Modify: `e2e/fixtures/assistant.ts` (helpers), `e2e/tests/mt-isolation/mt-asistente.spec.ts`, `CLAUDE.md`, `HU-AST-08` (estado)

**Interfaces — Produces (en `fixtures/assistant.ts`):** `bookAppointmentToday(request, token, { clientId, serviceId, professionalId, hhmm }): Promise<{ id: number }>` (reservar hoy en la zona del salón; tomar una hora aún futura o el caso límite que el servicio de turnos acepte — verificar en `AppointmentService.create`), `listRecordsApi(request, token, clientId)`, `professionalToken(request, adminToken)` usando `professionalWithAccess` de `fixtures/commissions.ts`.

- [ ] **Step 1: Escribir los specs** (uno o más `test` por criterio; la UI en inglés; flag encendido en `beforeAll` como los otros specs de `asistente/`). Cubren AC1–AC16 de la HU-AST-08: lectura por rol (la profesional sin ningún `Gs.` en el chat), crear ligada al turno (verificar por API que la ficha existe y el turno está «En curso»), suelta, varios turnos, profesional sin turno / turno ajeno, editar (agregar/quitar/cambiar), precio dicho (admin sí / profesional rechazado), cero montos para la profesional en tarjeta + recarga + API de conversación, varias fichas y ficha vieja (usar el helper de e2e de fichas con fecha antigua o `ServiceRecordTestSupportController` si la fecha no se puede fijar), acumulación sobre borrador pendiente, ficha cambiada (editar por API entre propuesta y botón → tarjeta con aviso y «no aplicado»), doble toque, descartar/vencer (`expireDraftApi`) /recargar, `FICHA_DRAFT_PENDING`, y auditoría (consultar el log de auditoría por API admin). Fijar los drafts por `data-draft-id` (la locator `lastDraftCard` es dinámica).
- [ ] **Step 2: Aislamiento** en `mt-asistente.spec.ts`: la profesional/administradora del salón A no obtiene fichas ni clientes del salón B con `ver_ficha_abierta`/`proponer_ficha`, y no puede confirmar un borrador ajeno (404).
- [ ] **Step 3: Docs:** `CLAUDE.md` (herramientas `ver_ficha_abierta`/`proponer_ficha`, tarjeta «Guardar ficha», palabras clave `record …` del modelo guionado, la profesional sin montos); estado de HU-AST-08 a `In Progress → Done` al pasar todo.
- [ ] **Step 4: Verificación** (parar 8080/5173 locales): backend e2e (`SPRING_PROFILES_ACTIVE=e2e ./gradlew bootRun --no-daemon`), luego `cd e2e && npx playwright test tests/asistente` (todo en verde, incluidos los 88 previos) y `npm run test:mt -- tests/mt-isolation/mt-asistente.spec.ts`. Después `cd src/backend && ./gradlew spotlessCheck test --no-daemon`, `cd src/frontend && npx tsc --noEmit && npm run test`. Relanzar el stack local contra Azure dev al terminar.
- [ ] **Step 5: Checkpoint:** `feat(assistant): crear y editar fichas desde el chat (HU-AST-08)`.

---

## Self-review

- **Cobertura del diseño:** §6.1 → T2/T3; §6.2 → T2; §6.3 → T6; §6.4 → T2 + Review Focus 1 (T2/T4/T6/T7); §6.5 → T4; §6.6 → T2/T3 (`pending`); §6.7 → T5; §6.8 → T3; §6.9 → T4/T7; §7 pruebas → T2–T7; parte 2 → T1 (ya implementada).
- **Consistencia de tipos:** `ServiceRecordDraftPayload`, `Request`, `LineKey` y los métodos `build/view/rebase/commit/fingerprint` se definen en T2 y se usan sin cambios en T3/T4; `ConfirmResult.serviceRecordId/recordOperation` se define en T4 y lo consume el controlador; `recordChanged` y los `data-testid` se definen en T6 y los usa T7.
- **Riesgos conocidos para el implementador:** el hecho de que `ServiceRecordService.update*` recrea las líneas (ids inestables) obliga a usar `LineKey` y no ids; el «turno de hoy» en e2e depende de la hora; `@JsonInclude` en Jackson 3 sigue siendo `com.fasterxml.jackson.annotation` (verificarlo contra el resto del código).
