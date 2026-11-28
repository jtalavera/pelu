# Especificación · Reserva online con WhatsApp y Ficha técnica con fórmulas

| Campo | Valor |
| ----- | ----- |
| **Producto** | Pelu / Flowbit |
| **Versión** | 2.0 · 26/11/2026 (reemplaza a la 1.0, que era solo web y email) |
| **Base de análisis** | rama `develop` de `jtalavera/pelu` (commit `3462875`), lectura de código sin ejecutar |
| **Épicas** | A · Reserva online (HU-RSV-01…07, 10) — B · Ficha técnica y fórmulas (HU-FTE-01…04, 06) — **C · Canal WhatsApp (HU-WAP-01…08, nueva)** |
| **Flags (add-ons)** | `ONLINE_BOOKING` · `TECHNICAL_RECORD` · `WHATSAPP_REMINDERS` (nombre previsto en los paquetes; cubre todos los mensajes transaccionales, no solo recordatorios) |
| **Estado** | `Backlog` — pendiente de confirmar las decisiones de la sección 2 |
| **Reemplaza** | La versión 1.0 de este documento y, de los paquetes originales, HU-RSV-02…07/10 y HU-FTE-01…04/06. Los paquetes 3 (rentabilidad) y 4 (fidelización) siguen vigentes para más adelante. |

**Qué cambió respecto de la 1.0:** WhatsApp pasa a ser el canal principal de verificación, confirmación, recordatorio y respuesta de la clienta; el email queda como alternativa y respaldo. La Épica B (ficha técnica) **no cambia**. Se agrega la Épica C porque el código actual de WhatsApp es solo una base (envía una plantilla de texto y no hace nada con lo que llega), y el hecho de que **un único número sirva a todos los salones** obliga a resolver cosas que con email no existían.

---

## 1. Alcance de esta fase

### Dentro
- **Reserva online** desde un enlace público (Instagram, WhatsApp, QR del local), sin crear cuenta. La clienta verifica su celular con un código por WhatsApp (o su email), y recibe confirmación, recordatorio y enlace de gestión por WhatsApp.
- **Canal WhatsApp** sobre el número único de la plataforma: plantillas aprobadas por Meta, consentimiento de la clienta, recordatorios de **todos** los turnos (no solo los online), respuestas por botón («Confirmo» / «No puedo ir»), seguimiento de entrega con respaldo por email y control de costos.
- **Ficha técnica estructurada**: registro por visita (fórmula de color y plantillas para barbería, uñas, tratamientos y spa), historial por clienta, repetir la última fórmula, y alergias con test de parche.

### Fuera (queda para más adelante)
- El **número con bot** para prospectos de Flowbit (es otro canal, otro objetivo y no toca el producto de los salones).
- Conversación libre entre salón y clienta dentro de Pelu (bandeja de entrada), campañas y mensajes de marketing, avisos al salón por WhatsApp (siguen por email y dentro de la app), lista de espera y seña.
- Fotos de antes/después (D8), cuidados post-servicio, dictado por el asistente.
- Horario general del salón: la disponibilidad sigue gobernada por el horario de cada profesional más los bloqueos y cierres de esta fase.
- Rentabilidad, comisiones avanzadas y fidelización.

---

## 2. Decisiones de partida (confirmar antes de empezar)

Las tomé con el criterio más seguro; cada una indica la alternativa. Cambiar una afecta solo a las historias nombradas. **Las marcadas ▲ son nuevas o cambiaron respecto de la 1.0.**

| # | Decisión adoptada | Alternativa | Afecta |
| - | ----------------- | ----------- | ------ |
| **D1 ▲** | **El código de verificación va por WhatsApp al celular que la clienta escribió** (plantilla de *autenticación*). Si no tiene WhatsApp o prefiere, lo recibe por **email**. Hace falta **al menos uno de los dos verificados**. Celular obligatorio siempre; email obligatorio solo si elige verificar por email. | Verificar siempre por email | RSV-05 |
| **D2 ▲** | **Vincular con una clienta existente solo si coinciden el contacto verificado (celular normalizado o email) y el nombre normalizado**; si no, se crea una clienta nueva. Ni el celular ni el email son únicos en el sistema. Nunca se revela si la persona ya era clienta. Clienta inactiva → no se reserva, mensaje genérico. | Crear siempre una clienta nueva | RSV-05 |
| **D3** | **Aprobación manual por defecto** (el turno nace `PENDING`); cada salón puede pasar a confirmación automática. | Automática por defecto | RSV-02, RSV-07 |
| **D4 ▲** | **Anti-abuso sin captcha externo en esta fase, con control de costo**: cada código por WhatsApp **cuesta dinero** y un atacante podría agotar el crédito pidiendo códigos a números ajenos. Por eso: límites por IP, por celular y por salón **en base de datos**, **tope diario de códigos por salón** y **tope diario global** con corte automático hacia email, campo trampa (honeypot) y aprobación manual por defecto. El captcha queda como mejora si se detecta abuso. | Captcha (Turnstile/hCaptcha) desde el inicio | RSV-05, WAP-08 |
| **D5** | **Sin reserva transitoria**: el horario se revalida y se toma al verificar el código, con bloqueo por profesional dentro de la transacción. | Retener 5 minutos | RSV-04, RSV-05 |
| **D6** | **«Cualquiera» asigna a la profesional con menos turnos ese día** entre las libres; desempate por id. | Rotación o preferencia por salón | RSV-04 |
| **D7** | **El registro técnico se ata a ficha + servicio + profesional**, no a la línea (las líneas se borran y recrean al guardar). | — (no es opcional) | FTE-01 |
| **D8** | **Fotos fuera de esta fase** (no hay almacenamiento de archivos y `develop` revirtió `azure-identity`). | Azure Blob ahora | — |
| **D9 ▲** | **Un solo número de WhatsApp para todos los salones**, sobre Cloud API de Meta directo (lo que ya existe en `WhatsAppService`). Solo se envían **plantillas aprobadas**. El número figura como Flowbit, así que cada mensaje **nombra al salón** en el texto. Las respuestas se atribuyen al salón por el contexto del mensaje (botones firmados y última conversación), no por el número. | Un número por salón (más caro y complejo de operar) o un proveedor intermediario | WAP-01…06 |
| **D10 ▲** | **Consentimiento explícito de la clienta** para recibir WhatsApp (`whatsapp_opt_in`), con fecha y origen. Se obtiene con una casilla **desmarcada** en la reserva online y en la ficha de clienta del salón. **Las clientas existentes no lo tienen**: siguen recibiendo recordatorio por email hasta que den su consentimiento. El código de verificación no lo requiere: lo pide la propia clienta. | Consentimiento implícito por tener celular (no cumple las políticas de Meta) | WAP-03 |
| **D11 ▲** | **Un recordatorio por turno, por un solo canal**: WhatsApp si hay consentimiento y está habilitado; si no, email (como hoy). Si WhatsApp **falla o reporta no entregado**, se cae a email una sola vez. Nunca se envían los dos a la vez. | Enviar ambos siempre | WAP-05, WAP-07 |
| **D12 ▲** | **Supuesto: la línea que conectaste es el número compartido de recordatorios** (no el del bot de prospectos). No pude ver la configuración de Meta; si es otra, WAP-01 cambia. | — | WAP-01 |

---

## 3. Lo que hay hoy en `develop` (anclajes verificados)

| Tema | Estado actual | Dónde |
| ---- | ------------- | ----- |
| Crear turno | Siempre nace `PENDING`; valida «no en el pasado» y no solapamiento; `clientId` opcional; **no valida que la profesional pueda hacer el servicio** (la relación profesional↔servicio no existe en el modelo); duración 5–480 min, por defecto la del servicio | `AppointmentService.create` |
| Disponibilidad | `forDay(tenantId, date, durationMinutes, professionalId, part, now, max)` ya exige que **entre toda la duración** en el bloque del horario y descarta lo ocupado; paso fijo de 30 min; **sin ausencias ni feriados**; considera todas las profesionales activas; existen `nextDayWithSlots` e `isFree` | `AvailabilityService` |
| Origen del turno | El turno **no guarda su origen** | `Appointment` |
| Clientas | `ClientService.create(tenantId, ClientRequest)`; email, teléfono y RUC **no son únicos** (el flag `ALLOW_DUPLICATE_CLIENT_EMAIL` existe en la base pero **ninguna clase lo usa**); canales de adquisición: `INSTAGRAM, FACEBOOK, TIKTOK, GOOGLE, RECOMENDACION, PASO_POR_EL_LOCAL, OTRO` | `ClientService`, `ClientAcquisitionChannel` |
| Email | Solo **texto plano** (`sendPlainTextEmail`); con `app.femme.email.enabled=false` (dev/e2e) **solo se registra en el log** y no se envía | `EmailService` |
| Seguridad | Rutas públicas = lista de `permitAll` **antes** de `anyRequest().access(new ProfessionalAccessPolicy())`; la profesional es **deny-by-default** con lista blanca de rutas y otra más acotada para sesión por PIN | `SecurityConfig`, `ProfessionalAccessPolicy` |
| Flags | `FeatureFlagService.isEnabled(flagKey, tenantId)`; patrón `*Access` con constante `FLAG` y `requireEnabled`; alta de flag con `INSERT` condicional apagado (V105) | `AssistantAccess`, `V105` |
| Límite de tasa | No hay librería; `SifenRateLimiter` es específico de SIFEN | `build.gradle.kts` |
| Fichas de servicio | Estados `OPEN`/`CLOSED`/`VOIDED`; editar solo en `OPEN` (`409 SERVICE_RECORD_NOT_OPEN`); **la clienta de una ficha abierta puede cambiar**; la profesional accede por `GET/PUT /api/service-records/{id}` (también con PIN) | `ServiceRecordService`, `ProfessionalAccessPolicy` |
| Categorías | `service_categories.kind` ya existe (`SERVICE`/`PRODUCT`, V72): **no reutilizar ese nombre** | V72 |
| Ficha técnica actual | Notas + Fórmula de color en texto libre (HU-68); la profesional solo ve esto de la clienta | `ClientTechnicalSheetService`, `ClientTechnicalSheetForm` |
| Ficha de la clienta (front) | Pestañas `data`, `appointments`, `invoices`, `sheet`, `radiography`; la pestaña **`sheet`** ya aloja la ficha técnica | `ClientDetailPage` |
| Rutas del front | `routes.tsx` con React Router; páginas públicas existentes (login, recuperar, activar) fuera de `ProtectedRoute` | `routes.tsx` |
| Cliente HTTP del front | `femmeJson` agrega credenciales y tiene lógica de sesión PIN: **no sirve para la página pública** | `api/femmeClient.ts` |
| **WhatsApp: envío** | `sendTemplateMessage(to, template, language, bodyParameters)` arma solo el componente `body` (sin botones ni encabezado), **devuelve `void`** (no lee la respuesta, por lo que **no obtiene el id del mensaje** que Meta devuelve) y ante error lanza `ResponseStatusException(500, "WHATSAPP_SEND_FAILED")`. Con `enabled=false` o sin credenciales solo escribe en el log (y ahí **sí imprime los parámetros**). Crea un `HttpClient` por llamada | `WhatsAppService` |
| **WhatsApp: configuración** | Variables `WHATSAPP_ENABLED`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` (v21.0), `WHATSAPP_BASE_URL`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. **Un único** `phone-number-id` para toda la aplicación. En `infrastructure_v2/` **no hay nada de WhatsApp** (ni secretos ni variables) | `application.properties`, Terraform |
| **WhatsApp: webhook** | `GET` de verificación con comparación en tiempo constante; `POST` **solo responde 200 sin procesar nada** y registra únicamente el largo. Ruta `permitAll`. **No valida la firma `X-Hub-Signature-256`** (no existe en el código) ni identifica el tenant (`tenantId=n/a`) | `WhatsAppWebhookController`, `SecurityConfig` |
| **WhatsApp: uso actual** | Ninguna funcionalidad usa `sendTemplateMessage` todavía. «Enviar por WhatsApp» del KuDE es un **enlace `wa.me` hecho por el navegador**, no la API | `whatsappShare.ts` |
| **Recordatorios** | Job horario; estados recordables `PENDING` y `CONFIRMED`; ventana ≤ 25 h; **solo email**, en español (`es-PY`); un turno sin email de clienta no recibe nada | `AppointmentReminderScheduler` |
| **Teléfono de la clienta** | Texto libre (`Client.phone`); **no hay consentimiento ni verificación** de WhatsApp en el modelo | `Client`, `ClientRequest` |


---

## 4. Requisitos transversales

Aplican a todas las historias de esta especificación (se verifican en la revisión de cada una).

| ID | Regla (testeable) |
| -- | ----------------- |
| **RT-01** | Con el flag del tenant **apagado**: las rutas y menús de la funcionalidad no existen para el usuario; las llamadas autenticadas responden `403 <FLAG>_DISABLED`; las públicas responden la **misma** página/JSON neutro que un slug inexistente (no se revela cuál es el caso). |
| **RT-02** | **Aislamiento por tenant.** En rutas públicas el tenant **se resuelve solo por el slug**; ningún endpoint acepta `tenantId` del cliente. Un tenant no puede leer ni modificar datos de otro (404). Cada historia con datos de tenant suma un caso en la suite `mt-isolation`. |
| **RT-03** | **Respuestas públicas con lista blanca de campos** (DTOs propios). Nunca se serializa una entidad ni se exponen ids internos de clientas, teléfonos o emails de otras personas. |
| **RT-04** | Todo texto visible por `t()` con claves en `es.json` y `en.json`; errores de API traducidos en `femme.apiErrors.*`. |
| **RT-05** | Mobile first: áreas táctiles ≥ 44 px, sin scroll horizontal, safe areas, una acción principal por vista (reglas de `AGENTS.md`). Componentes del design system antes de crear nuevos. |
| **RT-06** | Fechas y «hoy» en la **zona horaria del servidor** (definición transversal del PRD). |
| **RT-07** | Los logs incluyen `tenantId` y **no** registran emails, teléfonos, códigos de verificación ni tokens (el fallback de dev de `EmailService` sí imprime el cuerpo: solo ocurre con email deshabilitado y debe verificarse que producción no lo tenga). |
| **RT-08** | Datos técnicos sensibles (alergias, tests de parche, correcciones de registros cerrados): toda edición queda en `audit_log` y **no** se incluyen en exportaciones, páginas públicas ni mensajes. |
| **RT-09** | Cada pantalla nueva autenticada suma su tour guiado (`docs/guided-tour-conventions.md`). |
| **RT-10** | La profesional **nunca** ve montos ni costos, también en las pantallas nuevas (regla vigente del producto). |
| **RT-11** | **Consentimiento antes de WhatsApp.** Ningún mensaje que no sea el código de verificación se envía a una clienta sin `whatsapp_opt_in` vigente. Retirar el consentimiento (por la clienta o por el salón) tiene efecto inmediato y queda registrado. |
| **RT-12** | **Solo plantillas aprobadas.** El sistema no envía texto libre fuera de la ventana de 24 h de una conversación iniciada por la clienta. Una plantilla no aprobada o pausada por Meta **no se usa**: el mensaje cae al respaldo por email. |
| **RT-13** | **WhatsApp no debe filtrar datos.** Los mensajes llevan solo lo necesario (nombre de pila, salón, servicio, fecha y hora, enlace de gestión). Nunca alergias, tests de parche, montos ni notas internas. En los logs reales solo se registra destinatario enmascarado, plantilla y estado (hoy el modo desarrollo imprime parámetros: debe verificarse que no esté activo en producción). |
| **RT-14** | **Nada falla en silencio.** Cada envío deja un registro (`whatsapp_messages`) con plantilla, estado y error si lo hubo; un fallo de envío nunca rompe la operación de negocio que lo originó (crear, aprobar o cancelar un turno) ni se pierde: se reintenta o se cae al respaldo. |

---

# ÉPICA A · Reserva online

## HU-RSV-01 · Ausencias y cierres del salón

**Como** administradora,
**quiero** cargar vacaciones, licencias y cierres,
**para** que nadie pueda reservar cuando no hay quien atienda.

### Criterios de aceptación
1. **Bloqueo por profesional** — Configuración → Equipo, y desde el calendario («Bloquear horario»): profesional, inicio y fin (fecha y hora) o «todo el día», motivo (Vacaciones, Licencia, Capacitación, Otro) y nota opcional.
2. **Cierre del salón** — Afecta a todas las profesionales; mismo formato. Se pueden cargar varios días de una vez.
3. **Disponibilidad** — `AvailabilityService` excluye bloqueos y cierres. Como el asistente usa el mismo servicio (`AssistantAgendaTools`), los respeta sin cambios propios.
4. **Calendario** — Los bloqueos se ven sombreados con su motivo (administradora) o solo «No disponible» (profesional).
5. **Agenda manual** — El personal puede agendar sobre un bloqueo previa confirmación explícita («Esta profesional figura ausente: Vacaciones. ¿Agendar igual?»). El control es del frontend; el backend no bloquea a personal autenticado. La reserva pública **nunca** cae en un bloqueo.
6. **Bloqueo sobre turnos existentes** — Antes de guardar, lista los turnos que quedan dentro y la administradora decide por turno (dejar, reprogramar, cancelar). **No se cancela nada automáticamente.**
7. **Permisos** — Crea, edita y elimina solo la administradora. La profesional ve sus propios bloqueos en solo lectura.
8. **Validaciones** — Fin posterior al inicio; rango máximo de 1 año; no se permiten bloqueos solapados de la misma profesional (se unifican o se rechazan con mensaje).
9. **Aislamiento** — RT-02.

### Notas
- **Migración:** `professional_time_off`, `salon_closures` (ambas con `tenant_id`, índices por tenant + rango).
- **API:** CRUD `/api/time-off` y `/api/salon-closures`; el calendario recibe los bloqueos del rango visible.
- **Código:** nueva sobrecarga de `AvailabilityService.forDay` (la firma actual se conserva para el asistente).
- **E2E:** `hu-rsv-01-bloqueos.spec.ts`.

---

## HU-RSV-02 · Configurar la reserva online

**Como** administradora,
**quiero** decidir qué se puede reservar, con qué reglas y cómo se avisa a la clienta,
**para** recibir solo los turnos que quiero atender.

### Criterios de aceptación
1. **Activación** — Configuración → «Reservas online» (solo con `ONLINE_BOOKING`). Interruptor «Aceptar reservas». Apagarlo corta la página pública al instante sin tocar los turnos ya creados.
2. **Dirección propia (slug)** — Única en **toda la plataforma**: 3–40 caracteres, minúsculas, números y guiones; se rechazan palabras reservadas (`admin`, `api`, `app`, `login`, `r`…) y duplicados (`409 BOOKING_SLUG_TAKEN`). Al cambiarla se advierte que el enlace anterior deja de funcionar.
3. **Servicios reservables** — Casilla por servicio (apagada por defecto). Solo servicios activos de tipo `SERVICE`.
4. **Profesionales y qué hace cada una** — Casilla «Reservable online» por profesional y, para cada una, **qué servicios reservables atiende** (selector múltiple con atajo «Todos»). *El modelo actual no relaciona profesionales con servicios; sin esto una clienta podría reservar «Coloración» con quien no la hace.*
5. **«Cualquiera»** — Opción global para permitir que la clienta no elija profesional.
6. **Reglas** — Anticipación mínima en horas (por defecto 2), horizonte máximo en días (30), paso entre horarios (15/30/60 min; hoy fijo en 30), máximo de turnos futuros activos por celular verificado (3).
7. **Aprobación** — «Aprobar manualmente» (por defecto, D3) o «Confirmar automáticamente». Con manual: horas para responder antes de que la solicitud venza (por defecto 4).
8. **Cancelación por la clienta** — Horas límite para cancelar o reprogramar sola (por defecto 12) y texto de política opcional. **Esta regla gobierna también la cancelación por WhatsApp** (HU-WAP-06) y rige para **todos** los turnos del salón, no solo los online.
9. **Presentación** — Mensaje de bienvenida (hasta 300 caracteres) y casillas para mostrar u ocultar la dirección y el teléfono del negocio (`BusinessProfile`).
10. **Avisos al salón** — Email que recibe los avisos de reservas nuevas y cancelaciones (por defecto, el de contacto del negocio). Los avisos al salón **no** salen por WhatsApp en esta fase.
11. **Mensajes a la clienta por WhatsApp** (visible solo con `WHATSAPP_REMINDERS`) — Interruptores independientes: «Confirmaciones de reserva», «Recordatorios de turnos» (HU-WAP-05) y «Respuestas por botón» (HU-WAP-06), todos **apagados por defecto**. Cada uno muestra cuántas clientas del salón tienen consentimiento (HU-WAP-03) para que la administradora entienda a cuántas llegará. Sin `WHATSAPP_REMINDERS`, la sección no se muestra y todo sale por email.
12. **Teléfono del salón en los mensajes** — Casilla para incluir en los mensajes el teléfono del negocio (por defecto, el configurado en el perfil); si no hay uno cargado, la casilla no se puede activar.
13. **Completitud** — No se puede activar sin al menos un servicio reservable y una profesional reservable con ese servicio y con horario cargado; el mensaje dice qué falta (`409 BOOKING_NOT_READY`).
14. **Secretos del servidor** — Si falta el secreto de firma de enlaces, no se puede activar (`BOOKING_NOT_CONFIGURED`), igual que el patrón `STOCK_NOT_CONFIGURED`. Si falta la configuración de WhatsApp en el servidor, la sección de mensajes aparece deshabilitada con el motivo «WhatsApp no está configurado en la plataforma».
15. **Dependencia de flags** — `WHATSAPP_REMINDERS` solo tiene efecto si `ONLINE_BOOKING` está activo para el salón (la gestión del turno y la política de cancelación viven en esta configuración).

### Notas
- **Migración:** `booking_settings` (1 fila por tenant, `slug` con índice único global), `salon_services.bookable_online`, `professionals.bookable_online`, `booking_professional_services`; columnas de WhatsApp en `booking_settings` (`wa_booking_confirmations`, `wa_reminders`, `wa_reply_buttons`, `wa_show_salon_phone`).
- **Errores nuevos:** `BOOKING_SLUG_TAKEN`, `BOOKING_SLUG_INVALID`, `BOOKING_NOT_READY`, `BOOKING_NOT_CONFIGURED`.
- **Código:** `BookingAccess` (calca `AssistantAccess`, `FLAG = "ONLINE_BOOKING"`); `WhatsAppAccess` combina ambos flags.
- **E2E:** `hu-rsv-02-configurar-reservas.spec.ts`.

---

## HU-RSV-03 · Página pública: elegir servicio y profesional

**Como** clienta,
**quiero** abrir un enlace y ver qué puedo reservar,
**para** sacar turno sin escribirle a nadie.

### Criterios de aceptación
1. **Ruta pública** — `/r/:slug` en el SPA, fuera de `ProtectedRoute`. Backend: `GET /api/public/booking/{slug}` agregado a los `permitAll` de `SecurityConfig` **antes** de `anyRequest()`.
2. **Marca** — Nombre comercial, logo (`BusinessProfile.logoDataUrl`) y skin del tenant. Español por defecto, selector es/en.
3. **Servicios** — Agrupados por categoría, con nombre, duración y precio del catálogo. Solo los reservables.
4. **Profesional** — Lista con foto y nombre/apodo de las que atienden ese servicio (HU-RSV-02, criterio 4) y «Cualquiera» si está habilitado.
5. **Sin datos sensibles** — RT-03: no se expone teléfono, email ni dirección personal de nadie, ni datos de clientas ni de comisiones.
6. **Estados neutros** — Slug inexistente, reserva apagada, salón suspendido o flag apagado devuelven la **misma** página «Este enlace no está disponible» (RT-01).
7. **Cliente HTTP propio** — `api/publicBooking.ts` sin credenciales ni lógica de sesión PIN.
8. **Mobile first** — RT-05.

### Notas
- **Seguridad:** respuestas idénticas en los casos neutros para evitar enumerar salones; límite de tasa por IP.
- **E2E:** `hu-rsv-03-pagina-publica.spec.ts` (sin sesión) y caso en `mt-isolation` (dos slugs no se mezclan).

---

## HU-RSV-04 · Elegir día y horario

**Como** clienta,
**quiero** ver solo horarios realmente libres,
**para** no descubrir al final que ya no están.

### Criterios de aceptación
1. **Días disponibles** — Para el servicio y profesional elegidos, `GET /api/public/booking/{slug}/availability?serviceId&professionalId&from&to` devuelve los días del rango (máximo 14 días por llamada) con su cantidad de horarios libres.
2. **Horarios del día** — `GET …/availability/day?…&date=` devuelve los horarios libres. Se calculan con `AvailabilityService` usando la **duración del servicio**, el paso configurado, la anticipación mínima (pasando `now + anticipación`), el horizonte, los bloqueos y cierres (RSV-01) y solo las profesionales habilitadas para ese servicio (RSV-02).
3. **Lo antes posible** — Atajo que preselecciona el primer horario (`nextDayWithSlots`).
4. **«Cualquiera»** — Se asigna según D6; la clienta ve el nombre de la profesional asignada antes de confirmar.
5. **Sin horarios** — Mensaje claro con el teléfono del salón (si está visible) y el siguiente día con disponibilidad.
6. **Eficiencia** — El cálculo por rango **carga los turnos una sola vez** (no una consulta por día). Meta: respuesta aceptable con 14 días y varias profesionales.
7. **Zona horaria** — RT-06; los instantes se devuelven en ISO y se muestran en hora local del salón.

### Notas
- Cambio en `AvailabilityService`: `STEP_MINUTES` pasa a parámetro; nuevo método por rango; filtro de profesionales permitidas.
- **Pruebas unitarias** de: duración que no entra en el bloque, bloqueo parcial, anticipación mínima, horizonte, profesional deshabilitada.

---


## HU-RSV-05 · Confirmar con datos y verificar el celular

**Como** clienta,
**quiero** confirmar mi turno con mi nombre y celular y recibir un código por WhatsApp,
**para** quedar agendada sin crear una cuenta.

### Criterios de aceptación
1. **Datos** — Nombre completo, celular (obligatorios), email (opcional; obligatorio solo si elige verificar por email), nota opcional (200 caracteres) y casilla de términos. El celular se normaliza a formato internacional (`+595…`) aceptando las formas habituales (`0981 123 456`, `981123456`, `+595981123456`); un celular que no se puede normalizar se rechaza con mensaje claro.
2. **Consentimiento de WhatsApp (D10)** — Casilla **desmarcada**: «Quiero recibir la confirmación y los recordatorios de mi turno por WhatsApp». Solo se muestra si el salón tiene los mensajes por WhatsApp activos. Si no la marca, no se pierde nada: puede ver y gestionar su turno desde la pantalla de éxito y por email si lo cargó.
3. **Canal de verificación (D1)** — Por defecto **WhatsApp** al celular ingresado; alternativa «Prefiero recibirlo por email». `POST …/booking/otp` con el canal elegido envía un código de **6 dígitos** que vence a los 10 minutos. Se guarda solo su hash. Máximo 5 intentos por código; reenvío con espera de 60 s; máximo 3 envíos por hora por celular.
4. **Si WhatsApp no puede enviar** — Número sin WhatsApp, plantilla no aprobada o pausada, tope diario alcanzado (HU-WAP-08), plataforma con WhatsApp apagado o Meta caído: `409 OTP_CHANNEL_UNAVAILABLE` y la pantalla ofrece verificar por email (pide el email si no lo había cargado). No se muestra el error técnico.
5. **Límites y costo (D4)** — Por IP, por celular, por email y por salón, **guardados en base de datos**; más los topes diarios de HU-WAP-08. Campo trampa (honeypot): si viene completo, se responde como éxito sin enviar ni crear nada. Se respeta el máximo de turnos futuros activos por celular verificado (RSV-02).
6. **Confirmación** — `POST …/booking/confirm` con el código crea el turno. Recién acá se revalida y se toma el horario (D5): dentro de **una transacción** y con **bloqueo por profesional** (la verificación actual de solapamiento es «leer y después insertar» y admite carrera). Si ya no está libre: `409 SLOT_NO_LONGER_AVAILABLE` con los tres horarios más cercanos.
7. **Revalidaciones del servidor** — Vuelve a comprobar anticipación mínima, horizonte, bloqueos, que la profesional atienda ese servicio y que ambos sigan siendo reservables. No se confía en nada que venga del cliente.
8. **Vincular o crear clienta (D2)** — Si coinciden el contacto verificado (celular normalizado o email) **y** el nombre normalizado con una clienta activa del tenant, el turno se vincula a ella y **no se modifica ningún dato suyo**. En cualquier otro caso se crea una clienta nueva (`ClientService.create`) con canal de adquisición `RESERVA_ONLINE` (o el del enlace, RSV-10); a la nueva se le copian celular, email y consentimiento (con fecha y origen `ONLINE_BOOKING`).
9. **Contacto propio del turno** — El turno online guarda **su propio contacto de reserva**: celular verificado, email si lo hay y consentimiento (`appointments.contact_phone`, `contact_email`, `contact_whatsapp_opt_in`). Todos los mensajes de **ese** turno van a ese contacto, aunque la clienta vinculada tenga otro celular en su ficha. Así no se modifican datos de una clienta existente y no se manda un aviso a un número que la persona no verificó.
10. **Turno** — Se crea con estado según RSV-02 (`PENDING` o `CONFIRMED`) y origen `ONLINE` (`appointments.source`: `STAFF`, `ONLINE`, `ASSISTANT`; los existentes quedan `STAFF`). Sin usuario creador. El flujo de personal (`AppointmentService.create`) no cambia.
11. **Pantalla de éxito** — Resumen (servicio, profesional, fecha, hora, dirección si es visible), estado («Confirmado» o «Pendiente de aprobación»), botón «Agregar a mi calendario» (`.ics`) y el enlace de gestión **visible y copiable**. Si no dio consentimiento ni email, la pantalla avisa «Guardá este enlace: es la única forma de ver o cambiar tu turno» y no se le promete ningún mensaje.
12. **Mensaje de confirmación** — Con consentimiento: WhatsApp con la plantilla de confirmación o de pendiente (HU-WAP-04), con botón al enlace de gestión. Sin consentimiento y con email: email de texto plano con el mismo contenido. Si WhatsApp falla, respaldo por email (HU-WAP-07).
13. **Privacidad** — Nunca se informa si el celular, el email o el nombre ya existían; las respuestas de código incorrecto, vencido o agotado no filtran datos.
14. **Errores** — `SLOT_NO_LONGER_AVAILABLE`, `BOOKING_LIMIT_REACHED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `OTP_CHANNEL_UNAVAILABLE`, `RATE_LIMITED`.

### Notas
- **Migración:** `appointments.source`, `appointments.contact_phone/contact_email/contact_whatsapp_opt_in`, `booking_otp` (canal, hash, intentos, vencimiento), `booking_rate_events`; el valor `RESERVA_ONLINE` en `ClientAcquisitionChannel` (columna `VARCHAR`, no requiere cambio de esquema; **sí** hay que agregarlo a selectores y traducciones del front).
- **Plantilla del código:** de autenticación, definida por Meta (HU-WAP-02). El envío del código es **síncrono** con tiempo de espera corto (la clienta está esperando) y no pasa por la cola de reintentos.
- **E2E:** con WhatsApp y email deshabilitados el código no sale a ningún lado; se necesita un controlador de soporte que exponga el último código y los mensajes «enviados», habilitado **por propiedad** igual que `AssistantDraftTestSupportController` (`@ConditionalOnProperty femme.data-init.enabled=true`). **Debe quedar deshabilitado en producción**, y conviene una prueba que lo verifique.
- **Prueba de concurrencia:** dos confirmaciones simultáneas al mismo horario → exactamente una gana.
- **Auditoría:** el alta online se registra en `audit_log` con `source`.

---

## HU-RSV-06 · Ver, cancelar o reprogramar mi turno desde un enlace

**Como** clienta,
**quiero** cambiar o cancelar mi turno desde mi celular,
**para** avisar a tiempo sin llamar.

### Criterios de aceptación
1. **Enlace firmado** — `/r/:slug/turno/:token`. El token es **regenerable** (HMAC-SHA256 con secreto del servidor sobre tenant + turno + versión del token), para poder incluirlo en cada mensaje sin guardarlo en claro. Se invalida incrementando `appointments.manage_token_version` (al cancelar, reprogramar, completarse o pasar la fecha). En WhatsApp viaja como **botón de enlace** de la plantilla (la plantilla fija la parte inicial de la URL y el sistema aporta solo el token).
2. **Quién lo recibe** — Los turnos online, en la confirmación, en el recordatorio y en la pantalla de éxito. Los turnos creados por el salón lo reciben solo en el recordatorio por WhatsApp o email (HU-WAP-05). La clienta de un turno del salón sin contacto con consentimiento ni email no tiene enlace.
3. **Qué se ve** — Solo ese turno: servicio, profesional, fecha y hora, dirección (si es visible) y política de cancelación. Ningún otro dato personal.
4. **Cancelar** — Hasta las horas límite de RSV-02; motivo opcional (`cancel_reason`). El turno pasa a `CANCELLED` y el horario queda libre. Aviso por email al salón (RSV-07) y, con consentimiento, confirmación por WhatsApp a la clienta (HU-WAP-04).
5. **Fuera de plazo** — Mensaje con el teléfono del salón (si es visible); no se puede cancelar sola.
6. **Reprogramar** — Reutiliza RSV-04 con la misma duración y profesional (o «cualquiera»); revalida con el mismo bloqueo por profesional de RSV-05. Al cambiar `startAt` se **reinicia `reminder_sent_at`** (el flujo público no pasa por `AppointmentService.update`, así que lo hace explícitamente) y se anulan los mensajes pendientes del horario anterior (HU-WAP-05). Si el salón exige aprobación manual y el turno es online, vuelve a `PENDING`.
7. **Ficha de servicio** — Si el turno ya tenía ficha asociada, reprogramar la conserva (circuito turno↔ficha).
8. **Seguridad** — Token inválido, vencido o de otro tenant responde igual (`404`), con límite de tasa por IP. El enlace **no** exige verificar de nuevo: quien lo tiene es la titular (por eso se regenera y se invalida con cada cambio).
9. **Terminal** — Turnos `COMPLETED`, `CANCELLED`, `NO_SHOW` o ya iniciados no se pueden gestionar.

### Notas
- **Secreto:** `app.femme.booking.token-secret` (Key Vault, como `app-femme-integration-token-secret`).
- **Infra:** agregar el secreto en `infrastructure_v2/` y en la configuración del backend; sin él, `BOOKING_NOT_CONFIGURED`.
- **E2E:** `hu-rsv-06-gestionar-turno.spec.ts`; caso en el borde exacto del plazo de cancelación.

---

## HU-RSV-07 · Solicitudes y avisos para el salón

**Como** administradora,
**quiero** enterarme de las reservas online y aprobarlas,
**para** controlar mi agenda aunque la clienta reserve sola.

### Criterios de aceptación
1. **Origen visible** — Etiqueta «Online» en el calendario y en el detalle del turno (`AppointmentResponse` suma `source`).
2. **Reservas para aprobar** — Con aprobación manual, los turnos `PENDING` de origen online aparecen en una lista en **Hoy** y **Resumen**, con contador en el menú.
3. **Acciones** — **Aprobar** (`CONFIRMED`), **Rechazar** (motivo obligatorio; libera el horario) y **Proponer otro horario** (envía a la clienta el enlace de gestión para que elija). Cada acción notifica a la clienta con la plantilla correspondiente de HU-WAP-04 (WhatsApp con consentimiento, si no email).
4. **Vencimiento** — Un job horario (mismo patrón y misma habilitación por propiedad que `AppointmentReminderScheduler`) rechaza las solicitudes sin respuesta tras las horas configuradas, con aviso amable. Nunca después de iniciado el turno. *La granularidad es horaria.*
5. **Aviso al salón** — Email por cada reserva nueva y cada cancelación de la clienta, al correo configurado en RSV-02. Además, aparece en la app como solicitud pendiente. **No hay aviso por WhatsApp al salón** en esta fase.
6. **Profesional** — Ve sus turnos online como cualquier turno propio (sin datos personales de la clienta, igual que hoy). No aprueba ni rechaza.
7. **Resumen** — Cierra el pendiente de HU-77 «turnos sin confirmar» incorporando estas solicitudes a la franja «Requiere atención».
8. **Estado de los avisos** — El detalle del turno muestra el estado del último mensaje enviado a la clienta (HU-WAP-07): «Entregado», «Leído» o «No entregado — llamarla al…». Cuando falló todo el respaldo, el turno aparece en «Requiere atención» con el motivo.
9. **Idempotencia** — Aprobar dos veces, o aprobar algo ya cancelado por la clienta, no genera mensajes duplicados ni estados inválidos (`409`).

### Notas
- **E2E:** `hu-rsv-07-aprobar-reservas.spec.ts`.

---

## HU-RSV-10 · Enlace, QR y origen de la reserva

**Como** administradora,
**quiero** compartir mi enlace fácilmente y saber qué canal funciona,
**para** ponerlo en Instagram, WhatsApp y el local.

### Criterios de aceptación
1. **Pantalla «Compartir»** (dentro de Reservas online) — Enlace copiable, texto sugerido para la biografía de Instagram y un botón para compartir por WhatsApp (abre WhatsApp con el texto; **no usa la API de WhatsApp**).
2. **QR** — Descarga en PNG y una vista imprimible para cartel (impresión del navegador). Reutiliza la generación de QR que ya existe para el KuDE.
3. **Enlaces por origen** — `?c=instagram|facebook|tiktok|google|local|whatsapp`. Se guarda en el turno y, si la clienta es nueva, como su canal de adquisición. Mapeo: `local` → `PASO_POR_EL_LOCAL`; `whatsapp` → `OTRO` con detalle «WhatsApp» (el enum actual no tiene WhatsApp).
4. **Origen desconocido** — Se ignora y no rompe la reserva.
5. **Conteo** — La pantalla muestra reservas por origen en los últimos 30 días.

---

# ÉPICA B · Ficha técnica y fórmulas

## HU-FTE-01 · Registro técnico de la visita

**Como** profesional o administradora,
**quiero** dejar un registro técnico dentro de la ficha de servicio,
**para** que cualquiera del equipo sepa qué se hizo la última vez.

### Contexto
La ficha técnica actual (HU-68) pertenece a la **clienta** y se sobrescribe. El registro técnico pertenece a la **visita** y forma un historial. Convive con HU-68 sin tocarla.

### Criterios de aceptación
1. **Plantilla por categoría** — Configuración → Catálogo: cada categoría de servicios puede asignarse a una plantilla: **Color**, **Barbería**, **Uñas**, **Tratamiento**, **Spa** o **Libre**. Sin asignar, no se pide registro. Los campos de cada plantilla están definidos en el sistema (ver «Campos» abajo); en esta fase el salón no los edita.
2. **Sugerencia inicial** — Para categorías existentes, la pantalla propone una plantilla según el nombre (ej. «Coloración» → Color) y la administradora la acepta o cambia.
3. **Dónde se carga** — En el editor de la ficha de servicio, cada servicio cuya categoría tiene plantilla muestra «Registro técnico» (con una marca si ya existe). Vale para el editor de la administradora y para las líneas de la profesional.
4. **Clave del registro (D7)** — Un registro por **(ficha, servicio, profesional)**. Editar o recrear las líneas de la ficha **no borra registros**. Si un registro queda sin servicio en la ficha, se muestra en «Registros sin servicio asociado» y puede conservarse o eliminarse.
5. **Quién edita** — La profesional edita los registros **propios** mientras la ficha esté abierta y sea de hoy (mismo criterio que hoy para sus fichas); la administradora, cualquiera de una ficha abierta. También con sesión por PIN.
6. **Ficha cobrada** — Pasa a solo lectura para la profesional. La administradora puede corregirlo **con motivo obligatorio**, que queda en `audit_log` (RT-08).
7. **Ficha anulada** — Los registros se conservan en solo lectura.
8. **Aviso antes de cobrar (opcional)** — Casilla «Avisar si falta el registro técnico antes de cobrar» (apagada por defecto): al cobrar, un aviso descartable lista los servicios sin registro. No bloquea.
9. **Validación en el servidor** — Cada plantilla se valida con su esquema (tipos, rangos y largos); valores fuera de esquema → `400 TECHNICAL_ENTRY_INVALID` con el campo.
10. **Sin montos** — RT-10: el registro no contiene ni expone costos.
11. **Aislamiento** — RT-02 (`404` entre tenants).

### Campos por plantilla (versión 1)
- **Color** — ver HU-FTE-02.
- **Barbería** — peine/máquina (texto ≤ 20), degradé (ninguno/bajo/medio/alto/otro), largo arriba (≤ 40), barba (≤ 60), productos (≤ 120), notas.
- **Uñas** — sistema (esmalte/semipermanente/gel/acrílico/otro), forma, largo, color o marca (≤ 80), diseño (≤ 120), retoque en N semanas (1–12), notas.
- **Tratamiento** — producto (≤ 80), tiempo de pose en minutos, temperatura (≤ 20), notas.
- **Spa** — zona (≤ 80), técnica (≤ 80), presión (suave/media/firme), productos (≤ 120), contraindicaciones (≤ 200), notas.
- **Libre** — notas (≤ 2000).
- *Común a todas:* `schemaVersion` y notas generales (≤ 1000).

### Notas
- **Migración:** `service_categories.technical_template` (nombre elegido para no chocar con `service_categories.kind`), `technical_entries` (`service_record_id`, `salon_service_id`, `professional_id`, `template`, `schema_version`, `values_json`, `based_on_entry_id`, auditoría de creación y edición; **índice único** por ficha + servicio + profesional). **Sin `client_id`**: la clienta de una ficha abierta puede cambiar, así que el historial se consulta por `service_records.client_id` (ya indexado, `ix_service_records_client`).
- **API:** `GET/PUT /api/service-records/{id}/technical-entries`, `DELETE` del mismo recurso, `GET/PUT /api/settings/technical-templates` (solo administradora).
- **Permisos:** agregar las rutas a `ProfessionalAccessPolicy` **y** a `PIN_SESSION_ALLOWED`; el controlador recorta lo que la profesional puede editar.
- **Código:** `TechnicalRecordAccess` (flag `TECHNICAL_RECORD`).
- **E2E:** `hu-fte-01-registro-tecnico.spec.ts` (administradora, profesional, PIN, ficha cobrada, líneas recreadas, `mt-isolation`).

---

## HU-FTE-02 · Fórmula de color estructurada

**Como** colorista,
**quiero** registrar la fórmula por zona con productos, cantidades, oxidante y tiempo,
**para** repetir o corregir el resultado la próxima vez.

### Criterios de aceptación
1. **Bloques** — Hasta 4 por registro, con zona: Raíz, Largos, Puntas, Matiz/Tóner u «Otra» (con nombre libre).
2. **Componentes** — Hasta 6 por bloque: producto (del catálogo, con buscador, **o** texto libre «Otro»), tono (≤ 40), cantidad (> 0, máximo 1000) y unidad (g o ml).
3. **Producto del catálogo** — Si se elige uno, el servidor valida que sea del tenant y de tipo `PRODUCT` y **guarda su nombre en ese momento** (instantánea), de modo que el historial no cambia si el producto se renombra o se desactiva.
4. **Oxidante** — Volumen (10/20/30/40/otro), cantidad y unidad. La **proporción** (ej. 1 : 1,5) se calcula en pantalla a partir de las cantidades y se puede sobrescribir.
5. **Tiempo de pose** — Minutos enteros (0–240).
6. **Datos generales** — Técnica (≤ 120), resultado logrado (≤ 120) y valoración opcional 1–5.
7. **Totales** — La pantalla suma los gramos por producto de todos los bloques (base para un futuro consumo de insumos; **no** mueve stock en esta fase).
8. **Carga rápida en celular** — Pasos cortos, teclado numérico para cantidades y áreas táctiles ≥ 44 px (RT-05). Funciona con sesión por PIN.
9. **Convivencia con HU-68** — El texto «Fórmula de color» de la clienta se conserva y se rotula **«Fórmula general (nota permanente)»**; no se migra ni se borra.
10. **Sin cronómetro, sin fotos, sin costos** — Quedan fuera de esta fase.

### Notas
- Los productos de texto libre no se vinculan a Stock; los del catálogo tampoco consumen stock todavía.
- **Pruebas unitarias** del esquema: límites, unidades, producto de otro tenant, producto de tipo `SERVICE`.

---

## HU-FTE-03 · Repetir o ajustar la fórmula anterior

**Como** colorista,
**quiero** partir de la fórmula de la visita anterior,
**para** ahorrar tiempo y mantener el tono.

### Criterios de aceptación
1. **Botón** — «Usar la fórmula de la última visita» aparece si la clienta tiene un registro previo de la **misma plantilla**.
2. **Copia editable** — Copia el contenido a un registro nuevo y deja todo editable. Guarda `based_on_entry_id` y muestra «Basada en la visita del dd/mm/aaaa».
3. **Elegir otra** — «Ver historial» permite elegir cualquier registro anterior de esa clienta.
4. **Productos que ya no están** — Si un producto fue desactivado, se avisa y el componente queda como texto libre para reemplazarlo.
5. **Sin historial** — Primera visita: no se muestra el botón.
6. **Misma clienta** — Solo se ofrecen registros de la clienta de la ficha actual; si la ficha cambia de clienta mientras está abierta, la copia ya hecha se conserva y no se vuelve a vincular.

---

## HU-FTE-04 · Historial técnico en la ficha de la clienta

**Como** administradora o profesional,
**quiero** ver la línea de tiempo técnica de una clienta,
**para** entender su trabajo previo antes de empezar.

### Criterios de aceptación
1. **Dónde** — Dentro de la pestaña **Ficha técnica** (`sheet`) que ya existe, **no** una pestaña nueva. Arriba quedan Notas y «Fórmula general» (HU-68); debajo, el historial por visita, del más reciente al más antiguo. Se extiende `ClientTechnicalSheetForm` para que lo vean tanto la administradora como la profesional (pantalla `/app/clients/:id/technical-sheet`).
2. **Cada entrada** — Fecha, profesional, servicio, resumen de la fórmula (zona → producto + cantidad) o de los campos de la plantilla, resultado y alertas (HU-FTE-06).
3. **Filtros** — Por plantilla y por profesional.
4. **Paginación** — Con el componente de paginación del sistema (HU-32/74).
5. **Alcance de la profesional** — El mismo que HU-68: ve el historial técnico de cualquier clienta del negocio, nunca datos personales ni montos.
6. **Clienta inactiva** — Se puede ver, no editar (`409 CLIENT_INACTIVE`, igual que HU-68).
7. **Desde el turno** — El detalle del turno abre la misma vista (reutiliza `ClientTechnicalSheetModal`).

### Notas
- **API:** `GET /api/clients/{id}/technical-entries?template=&professionalId=&page=` → rutas a la lista blanca de la profesional y de PIN.
- La consulta une `technical_entries` con `service_records` por clienta; fichas anuladas se excluyen del historial por defecto.

---

## HU-FTE-06 · Alergias y test de parche

**Como** administradora o profesional,
**quiero** registrar alergias y tests de parche y ver una alerta antes de aplicar un producto,
**para** evitar reacciones y dejar constancia.

### Criterios de aceptación
1. **Alergias y sensibilidades** — En la pestaña Ficha técnica: lista rápida (tintes con PPD, amoníaco, látex, acrílico/monómero, fragancias, otra) más texto libre (≤ 500) y fecha del último relevamiento.
2. **Test de parche** — Se agregan registros con fecha, producto, resultado (Negativo, Positivo, Pendiente), notas y quién lo cargó. **Solo se agregan**; un error se marca «cargado por error» con motivo (no se borra).
3. **Vigencia** — Configurable por salón en meses (por defecto 6).
4. **Servicios que lo exigen** — Casilla «Requiere test de parche vigente» por servicio.
5. **Alerta** — Banner no bloqueante con los estados «Alergia registrada», «Sin test de parche vigente» y «Test de parche positivo» en: detalle del turno, editor de la ficha y pestaña Ficha técnica. Para agregar a la ficha un servicio que lo exige, hay que reconocer la alerta («Entendido»).
6. **Bloqueo opcional** — Configuración del salón: «Impedir servicios que requieren test cuando el último test es positivo». Activo, el servidor responde `409 PATCH_TEST_POSITIVE_BLOCKED` al agregar ese servicio a una ficha. Un test negativo posterior lo levanta.
7. **Calendario** — Los turnos muestran un ícono de advertencia cuando corresponde. `AppointmentResponse` suma un indicador de **tipo** (sin detalle) calculado **en lote** para las clientas del rango, para no agregar una consulta por turno.
8. **Clienta ocasional** — La genérica «CLIENTE OCASIONAL» no tiene alertas.
9. **Privacidad** — RT-08: auditoría de toda edición, sin exportación, sin acceso del asistente, sin aparición en emails ni WhatsApp. Ve y registra quien ya accede a la ficha técnica (administradora y profesional); la profesional nunca ve datos personales.
10. **Sin datos** — Si el servicio lo exige y no hay test registrado: «Sin test de parche registrado».

### Notas
- **Migración:** `client_allergy_profile`, `client_patch_tests`, `salon_services.requires_patch_test`, `technical_settings` (vigencia, bloqueo, aviso previo al cobro).
- **Legal:** son datos de salud de las clientas del salón. El texto de consentimiento y la retención deben revisarse con asesoría legal antes del lanzamiento; este documento no asume ninguna norma.
- **Rendimiento:** el indicador del calendario necesita una consulta agregada por clienta; medir antes de generalizar.

---

# ÉPICA C · Canal WhatsApp

**Por qué una épica propia.** El código actual (`WhatsAppService` + webhook) es una base de la incidencia #224: puede enviar una plantilla con parámetros de texto, y recibe llamadas de Meta sin hacer nada con ellas. Para que las reservas funcionen por WhatsApp falta: botones, id de mensaje, seguimiento de entrega, firma del webhook, consentimiento, atribución de respuestas a un salón (con **un solo número para todos**), respaldo por email y control de costo. Las historias de la Épica A dependen de estas; cada incremento del plan indica de cuáles.

**Plantillas.** Meta solo permite iniciar una conversación con una **plantilla aprobada**; dentro de las 24 horas posteriores a un mensaje de la clienta se puede responder con texto libre. Las plantillas se envían a aprobación con anticipación (HU-WAP-02): **es el elemento con plazo externo más difícil de controlar** y conviene presentarlas apenas se confirme este documento.

---

## HU-WAP-01 · Base técnica del canal: envío, configuración y entorno de pruebas

**Como** plataforma,
**quiero** un servicio de envío que soporte plantillas con botones, devuelva el id del mensaje y se comporte igual en todos los entornos,
**para** que las demás historias usen WhatsApp sin repetir esa lógica.

### Criterios de aceptación
1. **Envío ampliado** — `WhatsAppService` soporta, además del cuerpo: **botones de enlace** (con parte dinámica de la URL), **botones de respuesta rápida** (con un `payload` propio) y, si hace falta, encabezado. Devuelve el **id del mensaje** (`wamid`) que entrega Meta; hoy descarta la respuesta.
2. **Errores tipificados** — Distingue: número inválido o sin WhatsApp, plantilla inexistente/no aprobada/pausada, límite de envíos o calidad, credencial vencida o sin permisos, y errores transitorios de red. Cada categoría tiene un código propio y decide si se reintenta (HU-WAP-07). Hoy todos se reducen a `WHATSAPP_SEND_FAILED`.
3. **Dos modos de envío** — **Síncrono con tiempo de espera corto** para el código de verificación (la clienta espera) y **por cola** para todo lo demás: el mensaje se guarda en `whatsapp_messages` en estado `QUEUED` **en la misma transacción** que el hecho que lo origina (turno creado, aprobado, cancelado) y un proceso lo envía **después del commit**. Si el turno no se confirma, no hay mensaje; si el envío falla, el turno **no se revierte** (RT-14).
4. **Normalización de teléfonos** — Un único componente convierte a formato internacional (`+595…`) y lo usan reserva, clientas y envío. Reglas del celular paraguayo: acepta `0981123456`, `981123456`, `+595981123456`, `595981123456`; rechaza fijos y largos incorrectos; para otros países exige el prefijo `+`. Pruebas unitarias con casos de borde.
5. **Configuración y secretos** — Agregar a Terraform y a Key Vault: token de acceso, `phone-number-id`, **identificador de la cuenta de WhatsApp Business** (nuevo, para consultar plantillas), **secreto de la app de Meta** (nuevo, para firmar el webhook) y token de verificación del webhook. Se usa un **token de acceso permanente** (de usuario del sistema), no uno temporal de prueba. Hoy no hay nada de esto en `infrastructure_v2/`.
6. **Arranque seguro** — Si `WHATSAPP_ENABLED=true` pero falta algún valor obligatorio, el sistema lo registra como error de configuración visible para administradores de plataforma y trata el canal como apagado (hoy lo trata como apagado en silencio).
7. **Entorno de desarrollo y e2e** — Un proveedor falso reemplaza al real cuando el canal está deshabilitado o sin credenciales: **guarda** los mensajes salientes y permite leerlos desde un controlador de soporte habilitado solo por propiedad (mismo patrón y la misma advertencia de RSV-05). El modo actual de «solo log» deja de imprimir parámetros fuera de desarrollo (RT-13).
8. **Dependencia de flags** — El canal funciona solo con `WHATSAPP_REMINDERS` **y** `ONLINE_BOOKING` activos para el salón, **y** el interruptor global (`WHATSAPP_ENABLED`) encendido. Con cualquiera apagado, el envío responde «canal no disponible» y quien llama aplica el respaldo por email.
9. **Rendimiento** — Un único cliente HTTP reutilizado (hoy se crea uno por envío) con tiempos de espera de conexión y de respuesta.

### Notas
- **Migración:** `whatsapp_messages` (ver HU-WAP-07), `whatsapp_processed_events` (id de mensaje de entrada, para no procesar dos veces), `whatsapp_opt_outs`.
- **Meta:** si la línea conectada **no** es la compartida de recordatorios (D12), este incremento cambia de alcance.
- **Pruebas:** servidor HTTP simulado como ya hace `WhatsAppServiceTest`; agregar cuerpos de botones, lectura del `wamid` y cada categoría de error.

---

## HU-WAP-02 · Catálogo de plantillas y su aprobación en Meta

**Como** operador de la plataforma,
**quiero** ver qué plantillas existen y en qué estado están ante Meta,
**para** no habilitar a un salón con una plantilla que Meta rechazó o pausó.

### Criterios de aceptación
1. **Catálogo versionado en el código** — Cada plantilla tiene nombre, idioma (`es`), categoría, variables numeradas, botones y texto base. Lo que figura abajo es el **borrador** para presentar a Meta; el texto final puede variar si Meta lo observa.
2. **Estado visible** — Una vista para administradores de plataforma consulta a Meta el estado de cada plantilla (`APPROVED`, `PENDING`, `REJECTED`, `PAUSED`) y el motivo del rechazo. Una plantilla no aprobada **no se usa** (RT-12); el mensaje cae al respaldo por email.
3. **Cambios de estado** — El sistema escucha los avisos de Meta sobre cambios de estado y de calidad de plantillas (suscripción del webhook) y los registra. Una pausa o rechazo genera una alerta.
4. **Variables saneadas** — Antes de enviar, cada variable se normaliza: sin saltos de línea, tabulaciones ni espacios repetidos (Meta las rechaza), con largo máximo y nombre de pila extraído del nombre completo (primer nombre en minúscula con inicial mayúscula; vacío → saludo sin nombre).
5. **Texto estrictamente transaccional** — Sin promociones ni descuentos en ninguna plantilla (Meta puede recategorizarlas a «marketing», que tiene otro costo y otras reglas).
6. **Pie obligatorio** — Las plantillas de utilidad incluyen el pie «Respondé BAJA para dejar de recibir avisos» (HU-WAP-06).

### Catálogo (borrador)
| Plantilla | Categoría | Variables | Botones | Cuándo |
| --------- | --------- | --------- | ------- | ------ |
| `pelu_codigo_verificacion` | Autenticación | código | «Copiar código» (formato definido por Meta) | RSV-05 |
| `pelu_turno_confirmado` | Utilidad | nombre, salón, servicio, fecha, hora, profesional | URL «Ver o cambiar mi turno» (token) | Reserva confirmada |
| `pelu_turno_pendiente` | Utilidad | nombre, salón, servicio, fecha, hora | URL «Ver mi solicitud» (token) | Reserva a aprobar |
| `pelu_turno_no_disponible` | Utilidad | nombre, salón, servicio, fecha | URL «Elegir otro horario» (slug) | Solicitud rechazada o vencida |
| `pelu_propuesta_horario` | Utilidad | nombre, salón, servicio, fecha | URL «Elegir nuevo horario» (token) | «Proponer otro horario» |
| `pelu_recordatorio_turno` | Utilidad | nombre, salón, servicio, fecha, hora | Respuesta rápida «Confirmo» y «No puedo ir»; URL «Ver mi turno» (token) | Recordatorio |
| `pelu_turno_cancelado` | Utilidad | nombre, salón, servicio, fecha | URL «Reservar otro turno» (slug) | Cancelación |

Texto base de ejemplo (`pelu_turno_confirmado`): «Hola {{1}}, tu turno en {{2}} está confirmado: {{3}}, el {{4}} a las {{5}} con {{6}}. Podés verlo o cambiarlo con el botón.» Las demás siguen el mismo estilo breve y neutro.

### Notas
- **Plazo externo:** presentar las siete plantillas cuanto antes; no hay forma de acelerar la aprobación ni de saber de antemano si Meta cambia una categoría.
- **Idioma:** Meta no tiene variante específica de Paraguay; se usa `es`. Los mensajes salen siempre en español (igual que el email actual), aunque la página pública permita inglés.
- **Verificación pendiente:** el nivel de verificación del negocio en Meta y el límite diario de conversaciones iniciadas del número deben confirmarse en el administrador de Meta; condicionan cuántos salones se pueden habilitar (ver riesgos).

---

## HU-WAP-03 · Consentimiento de la clienta para recibir WhatsApp

**Como** clienta,
**quiero** decidir si recibo avisos por WhatsApp,
**para** no recibir mensajes que no pedí.

### Criterios de aceptación
1. **Modelo** — La clienta guarda `whatsapp_opt_in`, fecha, origen (`ONLINE_BOOKING`, `STAFF`, `EMAIL_LINK`, `REPLY`) y, si se retira, `whatsapp_opt_out_at`. Los turnos online además guardan su propio consentimiento (RSV-05, criterio 9).
2. **Alta en el salón** — En la ficha de la clienta, un interruptor «Acepta recibir avisos por WhatsApp», con texto de ayuda: «Activalo solo si la clienta lo aceptó». Queda registrado quién y cuándo (`audit_log`).
3. **Alta desde el email** — El recordatorio por email que sigue existiendo incluye el enlace «Recibir mis avisos por WhatsApp», firmado y regenerable como el de RSV-06, hacia una página mínima con un botón de confirmación; al confirmar, registra el consentimiento con origen `EMAIL_LINK`. Es la vía para las clientas existentes que hoy no tienen consentimiento.
4. **Retiro** — Por el salón (el mismo interruptor) o por la clienta respondiendo `BAJA` (HU-WAP-06). Surte efecto **de inmediato**: un mensaje en cola se cancela antes de enviarse (RT-11).
5. **Baja a nivel de plataforma** — Como el número es **uno solo**, una baja por respuesta se guarda por **celular** en `whatsapp_opt_outs` y aplica a **todos** los salones. Un salón no puede reactivar ese celular con su interruptor; la clienta debe responder `ALTA` (o volver a marcar la casilla en una reserva online, que la reactiva).
6. **Clientas existentes** — No se les asume consentimiento. Mientras no lo den, siguen recibiendo recordatorio por email como hoy (D11).
7. **Clienta ocasional** — La genérica «CLIENTE OCASIONAL» nunca recibe WhatsApp.
8. **Cambio de celular** — Si el salón cambia el celular de una clienta, el consentimiento anterior **se invalida** (era para el otro número) y vuelve a pedirse.
9. **Visibilidad** — En la lista y la ficha de clientas se ve si tiene consentimiento. La profesional no ve teléfonos ni este dato (RT-10 y regla de datos personales vigente).

### Notas
- **Migración:** columnas en `clients`; los valores existentes quedan sin consentimiento.
- **Legal:** el texto exacto de la casilla y la retención del registro de consentimiento deben revisarse con asesoría legal; este documento no asume ninguna norma.
- **E2E:** `hu-wap-03-consentimiento.spec.ts` (alta, retiro, cambio de celular, aislamiento).

---

## HU-WAP-04 · Mensajes de la reserva: confirmación, pendiente, rechazo, propuesta y cancelación

**Como** clienta,
**quiero** recibir por WhatsApp el resultado de mi reserva,
**para** saber en qué quedó sin entrar a ninguna página.

### Criterios de aceptación
1. **Eventos y plantillas** — Cada evento envía su plantilla (HU-WAP-02): reserva confirmada, reserva pendiente de aprobación, solicitud rechazada o vencida, propuesta de otro horario y cancelación (por la clienta o por el salón).
2. **Destinatario** — Turno online: el **contacto propio del turno** (RSV-05, criterio 9). Turno del salón: el celular de la clienta. Solo si hay consentimiento vigente y el celular no está en `whatsapp_opt_outs` (RT-11).
3. **Una vez por evento** — Cada mensaje tiene una clave única (turno + tipo de evento + versión del horario): reintentos, doble clic o aprobaciones repetidas **no duplican** el envío.
4. **Después del commit** — Se encolan dentro de la transacción y salen tras confirmarse (HU-WAP-01, criterio 3).
5. **Reprogramación** — Genera una nueva confirmación para el nuevo horario y anula los mensajes aún en cola del horario anterior.
6. **Respaldo** — Sin consentimiento o con WhatsApp no disponible: email de texto plano con el mismo contenido si hay email; si no hay ningún canal, el turno se muestra en «Requiere atención» (RSV-07, criterio 8) para que el salón llame.
7. **Contenido mínimo** — Solo lo que lleva la plantilla (RT-13). Nunca montos, notas ni datos de salud.
8. **Turnos del salón** — Crear un turno desde la agenda **no** envía confirmación en esta fase. Solo reciben recordatorio (HU-WAP-05).
9. **Mensajes del salón sobre su propio rechazo** — El motivo que escribe la administradora al rechazar **no** se incluye en el mensaje (es texto libre y la plantilla no lo admite); queda visible solo en la app.

### Notas
- **E2E:** `hu-wap-04-mensajes-reserva.spec.ts` apoyado en el proveedor falso de HU-WAP-01.

---

## HU-WAP-05 · Recordatorio por WhatsApp para todos los turnos

**Como** administradora,
**quiero** que las clientas reciban el recordatorio por WhatsApp,
**para** reducir las ausencias, que hoy dependen de un email que casi no se lee.

### Criterios de aceptación
1. **Mismo disparador** — Se extiende `AppointmentReminderScheduler` (hoy solo email): mismas ventanas (≤ 25 h), mismo job horario, mismos estados recordables (`PENDING`, `CONFIRMED`) y mismo `reminder_sent_at`.
2. **Elección de canal (D11)** — WhatsApp si: el salón lo activó (RSV-02), hay consentimiento vigente, el celular es válido y no está en baja, y la plantilla está aprobada. Si no, **email como hoy**. Nunca los dos para el mismo recordatorio.
3. **Cuándo se considera enviado** — `reminder_sent_at` se completa al **encolar** el mensaje. Si luego Meta informa que no se entregó, se envía el email de respaldo **una sola vez** (HU-WAP-07).
4. **No recordar lo que no está aprobado** — Un turno online `PENDING` esperando aprobación **no** recibe recordatorio (no es todavía un turno del salón); sí lo reciben los turnos `PENDING` creados por el salón, como hoy. Con prueba para ambos casos.
5. **Horas de silencio** — No se envían recordatorios entre las 21:00 y las 08:00 (hora del salón, RT-06; configurable en la plataforma). Uno que caiga en esa franja sale a las 08:00, salvo que el turno empiece en menos de 12 horas, en cuyo caso se envía igual.
6. **Botones** — La plantilla lleva «Confirmo», «No puedo ir» y «Ver mi turno» (HU-WAP-06 define qué pasa al tocarlos). Con las respuestas por botón apagadas en RSV-02, se usa solo el enlace.
7. **Reprogramación y cancelación** — Reprogramar reinicia el recordatorio (como hoy) y anula el mensaje en cola del horario viejo; cancelar anula lo pendiente.
8. **Prueba de no duplicación** — Reiniciar el servicio o ejecutar el job dos veces seguidas no duplica ningún recordatorio.
9. **Compatibilidad** — Con `WHATSAPP_REMINDERS` apagado, el comportamiento y los textos de hoy no cambian.

### Notas
- **Código:** `AppointmentReminderPersistenceService.resolveReminderContext` hoy decide si hay algo para enviar mirando el email de la clienta; debe resolver el **destinatario** (WhatsApp, email o ninguno) con la lógica compartida de HU-WAP-04.
- **E2E:** `hu-wap-05-recordatorios.spec.ts`.

---

## HU-WAP-06 · Respuestas de la clienta: botones, baja y mensajes libres

**Como** clienta,
**quiero** confirmar, cancelar o darme de baja respondiendo el mensaje,
**para** no tener que abrir enlaces.

### Criterios de aceptación
1. **Firma del webhook** — Cada `POST` se valida con la firma `X-Hub-Signature-256` calculada con el secreto de la app sobre el **cuerpo sin modificar**, con comparación en tiempo constante. Firma ausente o inválida → `403` sin procesar ni registrar el contenido. Hoy el webhook acepta cualquier `POST`.
2. **Procesamiento idempotente** — Meta puede reenviar la misma notificación: se guarda el id de cada mensaje entrante y no se procesa dos veces. Se responde `200` rápido; un error interno no debe generar reintentos infinitos de Meta ni perder el evento (queda registrado para reproceso).
3. **Atribución al salón** — El botón de respuesta lleva un `payload` **firmado** que identifica el turno; el servidor lo verifica y recién entonces deduce tenant y turno. Para mensajes libres, se usa el último mensaje que el sistema envió a ese celular en las últimas 72 horas: si pertenece a un único salón se atribuye a ese; si no hay ninguno o son varios, se trata como «sin salón» (criterio 7). **Nunca** se confía en un tenant dicho por el cliente.
4. **«Confirmo»** — Registra la confirmación de la clienta (`appointments.client_confirmed_at`). Si el turno es `PENDING` **creado por el salón**, pasa a `CONFIRMED` (queda en `audit_log`). Si es un turno online que aún espera aprobación, **no cambia de estado**. Se responde con un texto de agradecimiento (la respuesta de la clienta abre una ventana de 24 h).
5. **«No puedo ir»** — No cancela de inmediato: responde con una pregunta de dos botones (**«Sí, cancelar»** / **«No, mantener»**) para evitar cancelaciones por toque accidental. Al confirmar, aplica la política de RSV-02: dentro del plazo, cancela y avisa al salón; fuera del plazo, responde con el teléfono del salón y **no** cancela.
6. **Baja y alta** — `BAJA`, `STOP`, `NO QUIERO` (sin distinguir mayúsculas ni tildes) registran la baja del celular (HU-WAP-03, criterio 5) y se responde una confirmación. `ALTA` la revierte. La baja es efectiva aunque la respuesta no se pueda atribuir a un salón.
7. **Sin salón o mensaje libre** — Se responde **una vez cada 24 horas por celular** con un texto fijo: este número envía avisos de turnos y no recibe consultas; si se pudo atribuir un salón, se agrega su enlace de gestión y su teléfono visible. No se mantienen conversaciones ni se reenvía el mensaje.
8. **Otros tipos de mensaje** — Audios, imágenes, ubicaciones y contactos se tratan como mensaje libre. No se descargan ni se guardan.
9. **Privacidad de logs** — No se registra el contenido de los mensajes recibidos ni los números completos (RT-13).
10. **Interruptor del salón** — Con «Respuestas por botón» apagado en RSV-02, los botones de respuesta rápida no se incluyen en la plantilla del salón y solo se atienden `BAJA`/`ALTA`.

### Notas
- **Código:** `WhatsAppWebhookController.receiveCallback` pasa de «solo 200» a delegar en un servicio que separa **mensajes** y **estados**; el comentario `tenantId=n/a` deja de ser cierto para los eventos atribuidos y debe actualizarse.
- **Seguridad:** el controlador sigue siendo `permitAll`; la firma es lo que lo protege. Probar con firma válida, inválida y ausente.
- **E2E:** `hu-wap-06-respuestas.spec.ts` simulando las notificaciones de Meta firmadas con un secreto de prueba.

---

## HU-WAP-07 · Seguimiento de entrega, reintentos y respaldo por email

**Como** administradora,
**quiero** saber si el aviso le llegó a la clienta y que haya un plan B automático,
**para** no descubrir una ausencia porque el WhatsApp nunca se entregó.

### Criterios de aceptación
1. **Registro de cada mensaje** — `whatsapp_messages`: salón, turno y clienta (si corresponde), finalidad, plantilla, destinatario, id de Meta, estado, código de error saneado, intentos, y marcas de tiempo de encolado, envío, entrega, lectura y falla. Clave única por evento (HU-WAP-04, criterio 3).
2. **Estados de Meta** — El webhook actualiza `SENT → DELIVERED → READ` o `FAILED`. Pueden llegar **desordenados** (lectura antes que entrega): el estado solo avanza, nunca retrocede.
3. **Reintentos** — Errores transitorios (red, límite momentáneo): hasta 3 intentos con esperas crecientes (1, 5 y 15 minutos). Errores definitivos no se reintentan.
4. **Número sin WhatsApp** — Si Meta informa que no se puede entregar por no tener WhatsApp, se marca el celular como **no alcanzable** para ese contacto y no se vuelve a intentar hasta que el celular cambie.
5. **Respaldo por email (D11)** — Para confirmaciones y recordatorios, una falla definitiva o un «no entregado» dispara **un** email con el mismo contenido si hay email; queda marcado en el mensaje para no repetirlo. El código de verificación **no** cae a email solo: la clienta elige (RSV-05, criterio 4).
6. **Sin ningún canal** — Si no hay forma de avisar, el turno aparece en «Requiere atención» con el motivo (RSV-07, criterio 8).
7. **Vista para el salón** — Detalle del turno: línea de estado del último aviso («Entregado», «Leído», «No entregado») para la administradora; la profesional ve solo si hubo aviso, sin celular.
8. **Plantilla caída** — Si la plantilla de un evento está pausada o rechazada, los mensajes de ese evento van directo al respaldo y se alerta a la plataforma (HU-WAP-02).
9. **Retención** — El número completo del destinatario se conserva por un plazo configurable (propuesta inicial: 90 días) y luego se enmascara, dejando los conteos para el control de costos.
10. **Aislamiento** — RT-02: un salón solo ve sus propios mensajes.

### Notas
- **Migración:** `whatsapp_messages` (índices por tenant y turno, por id de Meta y por estado para el job de reintentos).
- **Pruebas:** estados desordenados, falla definitiva con y sin email, plantilla pausada y reproceso.

---

## HU-WAP-08 · Control de costos y monitoreo del número

**Como** operador de la plataforma,
**quiero** ver cuánto consume cada salón y cortar el gasto si hay abuso,
**para** que un ataque o un error no se lleve el saldo del número compartido, y para poder fijar el precio del add-on.

### Criterios de aceptación
1. **Contadores** — Por salón, día y finalidad (`OTP`, confirmaciones, recordatorios, otros) se cuentan los mensajes enviados.
2. **Topes diarios (D4)** — Por salón y globales, configurables en la plataforma. Valores iniciales propuestos, a ajustar con datos reales: **códigos por salón por día** acotado y un tope global mayor; recordatorios sin tope bajo, pero con alerta al superar un umbral. Al alcanzar el tope: el código ofrece email (RSV-05, criterio 4), los recordatorios van por email, y se alerta a la plataforma.
3. **Corte de emergencia** — `WHATSAPP_ENABLED=false` (o un interruptor de plataforma) apaga **todo** el canal de inmediato, sin despliegue, y todo cae al respaldo por email.
4. **Salud del número** — Se registran los avisos de Meta sobre la calidad del número y su límite de mensajería, y se muestran en la vista de plataforma junto con el estado de las plantillas (HU-WAP-02).
5. **Informe de consumo** — Exportación mensual por salón (cantidades por finalidad). **No** se calcula ni se cobra el costo: el precio de Meta depende de su tarifa vigente y de la categoría, y cobrar el add-on es una decisión comercial fuera de este documento.
6. **Alertas** — Aviso a administradores de plataforma por: tope alcanzado, credencial vencida, plantilla pausada o rechazada, número con calidad baja y tasa de fallos anormal.
7. **Detección de abuso** — Si un mismo salón o una misma IP dispara muchos códigos a celulares distintos sin completar la reserva, se bloquea la solicitud de nuevos códigos por esa vía durante un tiempo y se alerta.

### Notas
- **Migración:** `whatsapp_usage_daily` y tabla de configuración de topes.
- **Dónde se ve:** la ubicación de la vista de plataforma debe confirmarse al implementar (no revisé el área de administración de plataforma).

---

# 7. Diseño técnico

## 7.1 Flags y acceso
- **Migraciones de flags** con el patrón de V105: `INSERT` condicional en `feature_flags`, **apagado globalmente**; un administrador de plataforma lo habilita por tier o tenant (resolución `global ∧ tier ∧ tenant`).
- `BookingAccess` y `TechnicalRecordAccess` calcan `AssistantAccess` (constante `FLAG`, `isEnabled(tenantId)`, `requireEnabled(principal)`). `WhatsAppAccess` exige `WHATSAPP_REMINDERS` **y** `ONLINE_BOOKING` **y** el interruptor global de WhatsApp.
- Las rutas públicas **no** usan `requireEnabled(principal)`: resuelven el tenant por slug y consultan `featureFlagService.isEnabled("ONLINE_BOOKING", tenantId)`.
- El **webhook de WhatsApp** no tiene tenant de entrada: lo deduce de datos firmados (HU-WAP-06, criterio 3) y recién entonces consulta los flags.

## 7.2 Migraciones (rangos reservados)
Última existente: **V106** (no existe V101). Flyway rechaza aplicar una versión menor que otra ya aplicada, así que las pistas en paralelo deben **coordinar el orden de merge** o renumerar al integrar.

| Rango | Contenido |
| ----- | --------- |
| **V107** | Flag `ONLINE_BOOKING` — **hecho en C0** (el canal WhatsApp exige ambos flags) |
| **V108** | Flag `WHATSAPP_REMINDERS` — **hecho en C0** |
| **V109** | `whatsapp_messages`, `whatsapp_template_status`, `whatsapp_processed_events`, `platform_alerts` — **hecho en C0** |
| **V110** | `clients`: consentimiento (`whatsapp_opt_in` y fecha, origen, celular y baja); `whatsapp_opt_outs`, `whatsapp_unreachable` — **hecho en C1** |
| **V111** | `whatsapp_messages`: `fallback_email`, `recipient_masked_at` — **hecho en C1** |
| **V112** | `professional_time_off`, `salon_closures` |
| **V113** | `booking_settings`, `bookable_online` en servicios y profesionales, `booking_professional_services` |
| **V114** | `appointments`: `source`, `manage_token_version`, `contact_phone`, `contact_email`, `contact_whatsapp_opt_in`, `client_confirmed_at` |
| **V115** | `booking_otp`, `booking_rate_events` |
| **V116** | Flag `TECHNICAL_RECORD` |
| **V117** | `service_categories.technical_template`, `technical_entries` |
| **V118** | `client_allergy_profile`, `client_patch_tests`, `salon_services.requires_patch_test`, `technical_settings` |
| **V123** | `whatsapp_usage_daily`, configuración de topes |
| **V124** | Columnas de WhatsApp en `booking_settings` (`wa_booking_confirmations`, `wa_reminders`, `wa_reply_buttons`, `wa_show_salon_phone`) |

*Renumeración (26–27/11/2026):* C0 tomó V107–V109 y C1 V110–V111 porque Flyway rechaza una versión menor que otra ya aplicada; los rangos de A y B se corrieron en consecuencia. V119–V122 quedan libres.

## 7.3 API (resumen)

| Método y ruta | Quién | Para |
| ------------- | ----- | ---- |
| `GET /api/public/booking/{slug}` | Público | Config, servicios y profesionales |
| `GET /api/public/booking/{slug}/availability` y `/availability/day` | Público | Días y horarios libres |
| `POST /api/public/booking/{slug}/otp` · `/confirm` | Público | Código (WhatsApp o email) y creación del turno |
| `GET/POST /api/public/booking/{slug}/appointments/{token}` y `/cancel`, `/reschedule` | Público (token) | Gestión del turno |
| `POST /api/public/booking/{slug}/whatsapp-consent/{token}` | Público (token) | Consentimiento desde el email (HU-WAP-03) |
| `GET/PUT /api/booking/settings` · `/api/booking/professional-services` | Administradora | Configuración |
| `CRUD /api/time-off` · `/api/salon-closures` | Administradora (lectura propia: profesional) | Bloqueos |
| `POST /api/appointments/{id}/approve` · `/reject` · `/propose` | Administradora | Solicitudes online |
| `PUT /api/clients/{id}/whatsapp-consent` | Administradora | Consentimiento desde la ficha |
| `GET /api/appointments/{id}/messages` | Administradora y profesional (sin celular) | Estado de los avisos |
| `GET/POST /api/whatsapp/webhook` | Meta (firma) | Verificación y notificaciones; **ya existe**, cambia el `POST` |
| `GET /api/platform/whatsapp/*` | Administrador de plataforma | Plantillas, salud, consumo (ubicación a confirmar) |
| `GET/PUT/DELETE /api/service-records/{id}/technical-entries` | Administradora y profesional (propios) | Registro técnico |
| `GET /api/clients/{id}/technical-entries` | Administradora y profesional | Historial |
| `GET/PUT /api/clients/{id}/allergies` · `POST …/patch-tests` | Administradora y profesional | Alergias y test |
| `GET/PUT /api/settings/technical-templates` | Administradora | Plantilla por categoría |

Todas las rutas autenticadas nuevas de la profesional se agregan a **`ProfessionalAccessPolicy` y, si corresponde, a `PIN_SESSION_ALLOWED`**; cualquier ruta no listada responde 403 por diseño.

## 7.4 Seguridad de lo público y del webhook
- Matchers `permitAll` solo para `/api/public/booking/**` y la ruta ya existente del webhook, **antes** de `anyRequest()`.
- **Webhook:** firma `X-Hub-Signature-256` obligatoria sobre el cuerpo sin modificar; sin firma válida no se procesa nada.
- Límite de tasa en base de datos (IP, celular, email, salón); no en memoria.
- Códigos y tokens: solo hash/HMAC; comparación en tiempo constante; sin registro en logs (RT-07, RT-13).
- Secretos desde Key Vault: `app.femme.booking.token-secret` y los de WhatsApp (HU-WAP-01). Sin el de enlaces, `BOOKING_NOT_CONFIGURED`.
- Respuestas idénticas ante slug inexistente, apagado o suspendido.
- **Costo como superficie de ataque:** el envío de códigos por WhatsApp se trata igual que un recurso facturable (topes y corte de HU-WAP-08).

## 7.5 Frontend
- Nueva ruta pública `/r/:slug` (+ `/r/:slug/turno/:token` y la página mínima de consentimiento) fuera de `ProtectedRoute` en `routes.tsx`; `api/publicBooking.ts` sin credenciales.
- Pantallas de configuración: Reservas online (con la sección de WhatsApp), Bloqueos, Plantillas técnicas; interruptor de consentimiento en la ficha de clienta; estado de avisos en el detalle del turno; extensión de `ServiceRecordEditor`, `ProfessionalServiceLines`, `ClientTechnicalSheetForm`, `AppointmentDetailModal` y calendario.
- Tours guiados y claves `femme.booking.*`, `femme.whatsapp.*` y `femme.technical.*` en `es.json` y `en.json`.

---

# 8. Plan de entrega (incrementos en `develop`)

Tres pistas. A y B son **independientes** y pueden avanzar en paralelo; C es la que desbloquea el canal WhatsApp de A. Las migraciones se coordinan por rangos (7.2).

### Paso 0 · Antes de escribir código (hoy)
1. Confirmar las decisiones D1–D12.
2. Confirmar que la línea conectada es el número compartido de recordatorios (D12) y revisar en Meta el nivel de verificación del negocio, el límite de conversaciones y que la cuenta esté lista para plantillas.
3. **Presentar a Meta las siete plantillas de HU-WAP-02**. Es el único plazo que no controlamos y no depende del código.

### Pista C · Canal WhatsApp
| Incremento | Contenido | Se puede demostrar |
| ---------- | --------- | ------------------ |
| **C0** | HU-WAP-01 y HU-WAP-02 — **implementado** (pendiente prueba manual contra el número real, ver `docs/whatsapp-channel.md`) | Envío real de una plantilla de prueba con botones y lectura de su estado |
| **C1** | HU-WAP-03 y HU-WAP-07 — **implementado, con criterios pendientes de A4/A5/A6/C4** (ver `docs/whatsapp-channel.md`) | Consentimiento en la ficha y seguimiento de entrega con respaldo por email |
| **C2** | HU-WAP-04 — **motor implementado**, sin conectar a flujos reales hasta A4, A5 y A6 (ver `docs/whatsapp-channel.md`) | Mensajes de la reserva (requiere A4 y A6) |
| **C3** | HU-WAP-05 — **implementado**, inerte en producción hasta A0/A5 (enlace de gestión); criterio 4 depende de A4 y los botones de respuesta de C4 (ver `docs/whatsapp-channel.md`) | Recordatorio por WhatsApp para todos los turnos, en un salón piloto |
| **C4** | HU-WAP-06 | Botones «Confirmo» / «No puedo ir», baja y alta, con webhook firmado |
| **C5** | HU-WAP-08 | Topes, corte de emergencia, salud del número e informe de consumo |

### Pista A · Reserva online
| Incremento | Contenido | Se puede demostrar |
| ---------- | --------- | ------------------ |
| **A0** | Flag, `BookingAccess`, `booking_settings`, matcher público, `publicBooking.ts` | Esqueleto detrás del flag |
| **A1** | HU-RSV-01 | Bloqueos y cierres en el calendario |
| **A2** | HU-RSV-02 | Configuración completa |
| **A3** | HU-RSV-03 y 04 | Página pública que **muestra** horarios reales (todavía no reserva) |
| **A4** | HU-RSV-05 | Reserva completa. **Puede salir con verificación por email** si las plantillas todavía no fueron aprobadas, y sumar WhatsApp al terminar C0 sin cambiar la historia |
| **A5** | HU-RSV-06 | Gestión del turno por enlace |
| **A6** | HU-RSV-07 y 10 | Aprobación, avisos al salón, QR y origen |

### Pista B · Ficha técnica
| Incremento | Contenido | Se puede demostrar |
| ---------- | --------- | ------------------ |
| **B0** | Flag, `TechnicalRecordAccess`, rutas en la lista blanca | Esqueleto detrás del flag |
| **B1** | HU-FTE-01 con plantillas **Color y Libre** | Registro técnico por visita |
| **B2** | HU-FTE-02 y 03 | Fórmula estructurada y repetir la anterior |
| **B3** | HU-FTE-04 | Historial en la ficha de la clienta |
| **B4** | HU-FTE-06 | Alergias y test de parche |
| **B5** | Plantillas Barbería, Uñas, Tratamiento y Spa | Otros rubros |

**Orden sugerido con un solo equipo:** Paso 0 → C0 → A0 → A1 → A2 → A3 → A4 → C1 → A5 → A6 → C2 → C3 → C4 → C5 → B0…B5.
**Con dos personas:** una en A/C en ese orden y otra en B0→B5; ninguna espera a la otra salvo por el orden de migraciones.

---

# 9. Definición de terminado (por historia)

1. Criterios de aceptación cubiertos por tests; los de seguridad y aislamiento, por E2E.
2. Tests unitarios/integración (`./gradlew test --no-daemon`) y E2E Playwright (`hu-…spec.ts`); un caso nuevo en `mt-isolation` si toca datos del tenant.
3. `./gradlew spotlessApply` y `spotlessCheck` (Java); `npx tsc --noEmit` y `npm run test` (front).
4. i18n es/en completo; tour guiado actualizado; sin texto fijo en componentes.
5. Con el flag apagado, la funcionalidad no existe (RT-01), verificado.
6. Migración probada en SQL Server local (no solo H2).
7. Documentación: `requirements/user_stories/` con la historia y su estado, y `docs/` con las decisiones de diseño relevantes.
8. **Para historias de WhatsApp además:** probadas contra el proveedor falso (sin enviar mensajes reales en CI); verificado que **ningún** log real imprime celulares completos, códigos ni contenido de mensajes; probada la no duplicación de cada mensaje; y una **prueba manual contra el número real** con una plantilla aprobada antes de habilitar a un salón.

---

# 10. Riesgos y puntos a vigilar

| Riesgo | Mitigación |
| ------ | ---------- |
| **Aprobación de plantillas por Meta** (plazo externo; puede rechazar o recategorizar) | Presentarlas en el Paso 0; A4 sale con email si hace falta; textos transaccionales y sin promociones |
| **Límite diario de conversaciones del número** (depende de la verificación del negocio) | Confirmarlo en Meta antes de habilitar salones; HU-WAP-08 muestra consumo y salud |
| **Costo de los códigos por WhatsApp** (cada uno se factura; abuso = pérdida de dinero) | D4: topes por salón y globales, corte de emergencia, límites por celular/IP, honeypot, aprobación manual |
| **Reputación compartida:** un solo número para todos los salones, así que el mal uso de uno baja la calidad del número de todos | Consentimiento explícito, baja con `BAJA`, textos mínimos, topes por salón y alerta de calidad |
| **Mensaje a un número equivocado** (celular mal cargado por el salón) | Consentimiento registrado por el salón, contenido mínimo sin datos sensibles; el código de verificación sí confirma que el celular es de quien reserva |
| **Pocas clientas existentes con consentimiento** | Enlace «Recibir por WhatsApp» en el email de recordatorio e interruptor en la ficha; el email sigue funcionando |
| **Atribuir mal una respuesta a un salón** (número compartido) | Botones con `payload` firmado, última conversación única en 72 h, ante duda respuesta genérica sin ejecutar acciones |
| **Webhook sin firma** (hoy acepta cualquier `POST`) | HU-WAP-06, criterio 1, con secreto de la app; es el primer cambio de C4 si se adelanta cualquier procesamiento |
| **Token de acceso vencido o revocado** (los de prueba duran poco) | Token permanente de usuario del sistema, alerta por credencial inválida y respaldo a email |
| **Carrera al reservar** | Bloqueo por profesional en la transacción y prueba de concurrencia (RSV-05, crit. 6) |
| **Abuso de la página pública** sin captcha | Verificación de contacto, límites en base de datos, honeypot y aprobación manual por defecto; medir y, si hace falta, sumar captcha |
| **Orden de migraciones entre ramas** | Rangos reservados y renumerar al integrar; `scripts/flyway-repair.sh` existe para checksums |
| **Rendimiento del calendario** con el indicador de alertas de test de parche | Consulta agregada por lote y medición previa |
| **Datos de salud de clientas** (alergias, test de parche) | Auditoría, acceso restringido, nunca en mensajes (RT-13) y revisión legal del consentimiento |
| **Datos personales en mensajes y consentimiento** | Revisión legal del texto de la casilla, de la retención y de la baja a nivel de plataforma |
| **Nuevo valor de canal `RESERVA_ONLINE`** | Revisar selectores del front, traducciones e importaciones de clientas que validen el canal |

---

# 11. Lo que no verifiqué

- **Meta:** el estado real de la cuenta de WhatsApp Business, el nivel de verificación, el límite de conversaciones, las tarifas vigentes y si Meta aceptará los textos de las plantillas. Esta especificación asume que la línea conectada es la compartida de recordatorios (D12).
- **Meta, comportamiento de la API:** los detalles de formato de botones, variables y notificaciones los escribí según mi conocimiento de la API de WhatsApp Cloud sin consultar la documentación vigente en esta sesión; hay que contrastarlos con la versión de la API que use el proyecto (hoy `v21.0` por defecto).
- **`AppointmentReminderPersistenceService`:** leí el encabezado del job y la consulta de recordatorios, pero **no** el servicio de persistencia que resuelve el contexto; HU-WAP-05 asume que ahí se decide el destinatario.
- **Significado de `PENDING` → `CONFIRMED` hoy:** asumo que así confirma el salón un turno cargado por el personal (HU-WAP-06, criterio 4); no leí el flujo de confirmación del calendario.
- **Área de administración de plataforma:** no revisé dónde se gestionan hoy los flags ni si hay una pantalla donde sumar la vista de WhatsApp.
- **Historial de git:** la copia de trabajo era superficial (1 commit); no pude ver la evolución de ningún archivo.
- **Código del calendario y de `AppointmentResponse`**: no los leí completos; las historias que los extienden (RSV-07, FTE-06) necesitan una revisión técnica antes de estimar.
- **`ServiceRecordEditor` y `ProfessionalServiceLines`**: asumo por su nombre y por el servicio que los alimenta que ahí va el botón de registro técnico; confirmar al implementar.
- **Azure Communication Email** (remitente, dominio verificado) y **Terraform del Key Vault**: no los revisé.
- **Esfuerzos**: no están estimados.
- **Pruebas**: no ejecuté ningún test ni levanté el sistema; todo es lectura de código.
