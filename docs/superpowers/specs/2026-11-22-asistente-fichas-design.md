# Diseño · Asistente: crear y editar fichas de servicio desde el chat

Rama `feat/asistente_chat` (PR #444). Complementa `requirements/asistente/plan_asistente.md` y las historias HU-AST-*.

## 1. Intención y por qué

El asistente ya consulta datos y prepara borradores de factura y de turno. Falta el paso del medio, la **ficha de servicio**: el documento que se abre cuando la clienta llega y se va completando mientras se la atiende. Hoy hay que salir del chat para abrirla o cambiarla.

Se piden dos cosas:

1. **Crear la ficha** de una clienta que no tiene una abierta, o **editar** la que ya tiene abierta, hablando con el asistente.
2. **Preparar la factura a partir de la ficha** («facturemos los servicios a Juan Talavera»), con los datos ya cargados.

Quienes lo usan son la administradora y la profesional, y **cada una ve solo lo que su rol autoriza**. Para la profesional eso incluye no ver ningún monto de las fichas, también en el chat.

## 2. Estado de cada parte

- **Parte 2 (factura desde la ficha):** ya existía en el backend (`proponer_factura` sin ítems toma la ficha abierta del cliente; HU-AST-03 AC2). Lo que fallaba era que el modelo no lo hacía de entrada: preguntaba qué cobrar. Se corrigió en el prompt (regla 10/11) y en la descripción de la herramienta. Está hecho y probado con tests de prompt, **sin commit**. No requiere más diseño, salvo el cruce con los borradores de ficha (sección 6.8).
- **Parte 1 (crear y editar fichas):** es el objeto de este diseño.

## 3. Metas, no metas y anti-metas

**Metas**
- Crear la ficha de una clienta y editar la abierta (agregar o quitar servicios y productos, cambiar cantidad, profesional y, solo para la administradora, precio) conversando.
- Que siga el principio del asistente: **el modelo propone, la persona confirma con un botón**.
- Que los permisos por rol los haga el servidor, no el prompt.
- Que el resultado sea idéntico a lo que hubiera dejado la pantalla de Fichas (mismas reglas, mismos servicios, misma auditoría con origen `ASSISTANT`).

**No metas (esta versión)**
- Propinas, anular fichas, y ligar una ficha ya existente a un turno (eso sigue en la agenda).
- Editar líneas desde la tarjeta con campos o botones: los cambios se piden por el chat.
- Fichas de «cliente ocasional» (sin cliente registrado): el chat exige una clienta registrada.
- Dar a la profesional acceso a facturar o a ver montos.

**Anti-metas** (sería un fracaso aunque funcione)
- Que el modelo escriba una ficha sin que nadie toque el botón.
- Que un monto de una ficha llegue a la profesional por cualquier vía: herramienta, tarjeta, borrador guardado, respuesta del confirmar o texto del modelo.
- Que la ficha creada por el chat se comporte distinto a la creada desde la agenda (turno que se queda «Pendiente», ficha huérfana).

## 4. Restricciones (lo que ya hace la app)

- Una ficha se **guarda completa**: crear y editar reemplazan todas sus líneas (`ServiceRecordRequest`). Al editar, las líneas se recrean, así que **sus ids no son estables**.
- **Administradora:** crea fichas con o sin turno, edita cualquier ficha abierta, fija precios.
- **Profesional:** no crea fichas sueltas. Solo las crea **desde un turno propio** (`POST /api/appointments/{id}/service-record`) y edita las fichas **abiertas de hoy** de cualquier profesional, solo servicios y cantidades. No ve ni fija montos: una línea nueva toma el precio del catálogo y una línea que se conserva mantiene su precio (`updateServicesAsProfessional`). Una línea sin profesional queda a su nombre.
- Crear desde un turno (`createFromAppointment`) sirve para turnos Pendiente, Confirmado o En curso sin ficha; el turno pasa a «En curso» y la ficha arranca con el servicio y la profesional del turno.
- Una clienta puede tener varias fichas abiertas.
- El asistente guarda un solo borrador activo por conversación: una propuesta nueva reemplaza la anterior (de cualquier tipo). Los borradores viven 24 h.
- `assistant_draft.type` es `VARCHAR(16)`: `SERVICE_RECORD` (14) entra sin migración de esquema.
- `proponer_factura` sigue siendo solo para administración.
- Toda cadena visible va por i18n (en + es); cada criterio de aceptación necesita su prueba de Playwright (CLAUDE.md).

## 5. Aproximaciones consideradas

| | Qué es | Pros | Contras |
|---|---|---|---|
| **A. Tarjeta de ficha que la persona guarda** (elegida) | Tercer tipo de borrador, con su tarjeta y su botón «Guardar ficha» | Respeta que el modelo no escribe. Reutiliza reemplazar, descartar y vencimiento. Permisos en el servidor | Más trabajo: tipo de borrador, tarjeta y confirmación. Un toque extra por cambio |
| B. Guardado directo con «Deshacer» | El modelo cambia la ficha y el chat ofrece deshacer | Más rápido; se parece a la pantalla de Fichas | Rompe «ninguna herramienta escribe»; un texto malicioso en un dato podría tocar fichas; deshacer es lógica frágil |
| C. Abrir la ficha ya armada en la pantalla | Un enlace del chat | Barato y seguro | No es conversacional; no es lo pedido |

La persona eligió **A**.

## 6. Diseño

Lo que decidió la persona está marcado **(decidido)**; lo demás son mis llamadas, para que las revise.

### 6.1 Herramientas (ambos roles)

- **`ver_ficha_abierta(clientId)`** (lectura). Devuelve las fichas abiertas de la clienta y sus turnos de hoy:
  - Por ficha: `id`, fecha, y por línea `position`, nombre, cantidad, profesional.
  - Por turno de hoy: `id`, hora, servicio, profesional, si ya tiene ficha.
  - **Administradora:** todas las fichas abiertas de la clienta, con monto por línea y total (`Gs. 50.000`).
  - **Profesional:** solo las abiertas de hoy y **sin ningún monto**: ni campos vacíos, simplemente ausentes.
- **`proponer_ficha(clientId, appointmentId?, recordId?, newRecord?, agregar[], quitar[], cambiar[])`** (escribe un borrador, nunca la ficha). Recibe **solo los cambios**; el servidor los aplica sobre el estado actual y arma la tarjeta con el resultado.
  - `agregar`: `{id, quantity, professionalId?, unitPrice?}` (ids de `listar_servicios` / `listar_productos`).
  - `quitar`: posiciones de línea tal como las devolvió `ver_ficha_abierta`. **Las posiciones siempre se refieren a la lista que ve la persona en ese momento:** si hay una tarjeta de ficha pendiente de esa clienta, `ver_ficha_abierta` devuelve **esa lista resultante** (con la marca de cada línea y `pending: true`); si no, la ficha guardada. En una creación ligada a un turno, la línea del turno ya es la posición 1 del borrador; el modelo solo puede quitarla o cambiarla en una propuesta posterior, cuando ya aparece en la lista.
  - `cambiar`: `{position, quantity?, professionalId?, unitPrice?}`.
  - `unitPrice` existe **solo para la administradora** y solo si la persona dijo el precio (misma regla que la factura: nunca se inventa). Para la profesional se rechaza.
- `proponer_factura`, `agregar_item_a_borrador` y `descartar_borrador` no cambian. `descartar_borrador` también descarta la tarjeta de ficha.

### 6.2 Crear o editar: cómo decide el servidor

1. Si la clienta tiene **una** ficha abierta **de hoy** (la profesional solo ve de hoy), es una **edición** de esa ficha. Si tiene **varias**, error `MULTIPLE_RECORDS` con un resumen por ficha (fecha y servicios) para que el asistente pregunte cuál. Si la única ficha abierta es **de un día anterior** (la administradora sí la ve), no se asume nada: error `STALE_RECORD` con su fecha y servicios, y el asistente pregunta si se edita esa o se abre una nueva para hoy; la persona contesta y se vuelve a llamar con `recordId` (editar esa) o `newRecord: true` (crear una nueva, ligada al turno de hoy si lo hay). Así una ficha vieja olvidada no impide abrir la de hoy, y la ficha de hoy nunca queda sin ligar por error.
2. Si **no tiene**, es una **creación**:
   - **(decidido)** La ficha se **liga al turno** de hoy de la clienta, como el botón de la agenda: el turno pasa a «En curso» y la ficha arranca con el servicio y la profesional del turno; lo que se pidió se suma encima. Con un solo turno de hoy se liga a ese; con varios, `MULTIPLE_APPOINTMENTS` para que el asistente pregunte (o se pasa `appointmentId`); un turno que ya tiene ficha o no es ligable no se ofrece.
   - **Sin turno hoy:** la administradora crea una ficha **suelta** (solo con lo pedido). La profesional recibe `NO_APPOINTMENT_TODAY`: no puede crear una ficha sin turno propio.
   - **Profesional:** solo turnos **propios** (como `requireOwnAppointment`); otro turno devuelve `APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL`.
3. Una ficha siempre termina con al menos una línea, como en la app. Si lo pedido no deja ninguna (crear sin nada que agregar y sin turno del que partir, o quitar todas las líneas de una edición), el servidor responde `NOTHING_TO_SAVE` y el asistente lo explica.

### 6.3 La tarjeta (`ServiceRecordDraftCard`)

Muestra la ficha **resultante**, marcando lo agregado (+), lo quitado (tachado) y lo modificado, el turno al que queda ligada (si corresponde) y los botones «Guardar ficha» y «Descartar». Estados atenuados como los otros borradores: Reemplazado, Descartado, Vencido, Guardado (verde, «Ficha guardada»).

```
Administradora                           Profesional
Ficha de Juan Talavera · turno 15:00     Ficha de Juan Talavera · turno 15:00
   Corte ×1 · Hugo        Gs. 50.000        Corte ×1 · Hugo
+  Tinte ×1 · Hugo        Gs. 120.000    +  Tinte ×1 · Hugo
   Total                  Gs. 170.000    [Guardar ficha] [Descartar]
[Guardar ficha] [Descartar]
```

La tarjeta de la profesional **no tiene columna de montos ni total**; el DTO que recibe tampoco los trae.

### 6.4 Payload y permisos de rol (servidor)

- Nuevo tipo `AssistantDraftType.SERVICE_RECORD` y payload `ServiceRecordDraftPayload`: clienta, ficha de origen (o null si es nueva), turno a ligar (o null), líneas resultantes con su marca (`NEW`/`KEPT`/`CHANGED`/`REMOVED`), el **conjunto de cambios pedidos** (con claves estables de línea, ver 6.5) y una **huella del estado de la ficha** al proponer.
- Para la profesional el payload **se guarda sin montos**; los montos se resuelven al guardar con las reglas existentes (línea conservada mantiene su precio; nueva toma el catálogo).
- El rol se valida en **tres lugares**: al ofrecer las herramientas, al ejecutarlas (rechazan parámetros que su rol no puede usar, como `unitPrice`) y al confirmar (`principal`), nunca solo por lo que diga el modelo.

### 6.5 Guardar (confirmar)

`POST /api/assistant/drafts/{id}/confirm` ya existe; se agrega la rama `SERVICE_RECORD`, que **no llama a un endpoint REST sino a los servicios de siempre**:

| Rol | Crear | Editar |
|---|---|---|
| Administradora | `ServiceRecordService.createServiceRecord` (+ ligar al turno con `AppointmentServiceRecordService`) | `updateServiceRecord` |
| Profesional | `AppointmentServiceRecordService.createFromAppointment` y luego `updateServicesAsProfessional` para lo agregado | `updateServicesAsProfessional` |

- Mismo patrón de `claim` atómico que factura y turno (doble toque = un solo guardado; la segunda respuesta es 409 `ASSISTANT_DRAFT_ALREADY_CONFIRMED`).
- **Si la ficha cambió desde la propuesta** (huella distinta): no se guarda. El borrador **conserva el conjunto de cambios pedidos** (no solo las líneas resultantes) y, al detectar el cambio, los **vuelve a aplicar sobre el estado actual**; la tarjeta se rehace y se pide confirmar de nuevo (409 `ASSISTANT_RECORD_CHANGED` con el borrador, análogo a `ASSISTANT_PRICE_CHANGED`). Para que eso sea posible, cada cambio se guarda con una **clave estable de línea** (servicio + profesional + n.º de ocurrencia) resuelta al proponer, no con la posición. Un cambio que ya no encuentra su línea (alguien la quitó mientras tanto) **no se aplica** y la tarjeta lo muestra como «no aplicado»; el resto se conserva.
- Si el turno ya no es ligable o ya tiene ficha, o la ficha ya no está abierta: 409 con el código del servicio (`APPOINTMENT_ALREADY_HAS_SERVICE_RECORD`, `SERVICE_RECORD_NOT_OPEN`, …), traducido en la tarjeta; el borrador sigue vivo.
- Auditoría: `service-records`/`create|update` con origen `ASSISTANT`, como las otras confirmaciones.

### 6.6 Varias propuestas seguidas

Si hay una tarjeta de ficha activa de la misma clienta y llega otro `proponer_ficha`, los cambios nuevos **se aplican sobre el borrador pendiente** (no sobre la ficha guardada; las posiciones son las de la lista que `ver_ficha_abierta` muestra con `pending: true`): la tarjeta nueva reemplaza a la anterior y no se pierde lo ya pedido. Con otra clienta, reemplaza sin más.

### 6.7 Prompt

Regla nueva para fichas: «Para abrir o cambiar una ficha, primero `ver_ficha_abierta`; después `proponer_ficha` con solo los cambios. Nunca digas que la ficha ya está guardada. La profesional nunca ve montos: no los menciones, ni los pidas». Se ajusta la regla 1 (borradores de ficha) y la regla de los datos de herramientas. Las respuestas de `ver_ficha_abierta` para la profesional no traen montos, así que el modelo no tiene qué filtrar.

### 6.8 Cruce con la factura

Como hay un solo borrador activo, pedir «facturemos» con una tarjeta de ficha **sin guardar** reemplazaría esa tarjeta y la factura saldría de la ficha **sin** lo propuesto. **Mi llamada:** `proponer_factura` responde `FICHA_DRAFT_PENDING` mientras haya un borrador de ficha activo de esa clienta, y el asistente pide guardarlo o descartarlo antes. La parte 2 sigue sin cambios para quien no tiene un borrador de ficha pendiente.

### 6.9 Datos fuera del contrato

- Un cliente de otro salón o un turno ajeno no se ofrece ni se acepta (aislamiento por salón y por persona, como las demás tarjetas).
- Los textos de las herramientas siguen siendo datos, nunca instrucciones; no se devuelven notas libres de la ficha.
- Nada del contenido de la conversación va a los logs.

## 7. Pruebas

- **Backend:** unitarias del armado (crear con turno, crear suelta, editar, varias fichas, varios turnos, turno ajeno, ficha cambiada, línea final), del enmascarado de montos de la profesional y de cada rama de `confirm`; integración con el flujo completo y auditoría.
- **Seguridad de rol:** la profesional no obtiene un monto en `ver_ficha_abierta`, en el DTO del borrador, en el resultado de confirmar ni en el SSE; `unitPrice` se rechaza para ella.
- **Playwright (inglés, modelo guionado):** un spec por criterio nuevo en una historia nueva (HU-AST-08); además el aislamiento entre salones en `mt-asistente`. El modelo guionado gana palabras clave para ver y proponer fichas (por ejemplo `record <client>` y `record <client> add <service>`).
- **Vitest:** tarjeta de ficha (ambos roles, estados, i18n paridad).

## 8. Fuera de este diseño

- Evaluaciones con el modelo real y el flag en producción (fase 5 del plan).
- Cambios en la pantalla de Fichas.

## 9. Lo que se deja al constructor

- Nombre exacto de los códigos de error y de las claves i18n (siguiendo el patrón existente).
- Cómo calcular la huella de la ficha y cómo identificar líneas pese a que sus ids cambian al guardar.
- Si la ficha acepta hoy productos además de servicios (el catálogo ya los separa): las líneas deben aceptar lo que acepta la app.
- Nombres de los keywords del modelo guionado.
- Orden de las herramientas en el catálogo del modelo y redacción final del prompt.

## 10. Llamadas del diseñador a revisar

Resueltas sin consultar, después de la revisión del constructor; la persona puede cambiarlas:

1. **Posiciones de línea** (6.1): siempre sobre la lista que se ve en ese momento, incluido el borrador pendiente.
2. **Ficha abierta de un día anterior** (6.2.1): no se edita sola; el asistente pregunta si se edita esa o se abre una nueva para hoy.
3. **Ficha que cambió antes de guardar** (6.5): se vuelven a aplicar los cambios pedidos sobre el estado actual; los que ya no tienen su línea se muestran como «no aplicados».
4. **Factura con ficha sin guardar** (6.8): `FICHA_DRAFT_PENDING`, pide guardar o descartar antes.
5. **Sin «cliente ocasional»** en el chat (sección 3).
