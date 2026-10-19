# Femme — Historias de usuario · MVP (Etapa 1)

> **Alcance:** Módulos de Agendamiento, Facturación y Cliente básico.  
> **Rol único en esta etapa:** Administrador (Admin).  
> **Formato:** Como [rol], quiero [acción], para [beneficio].  
> **Criterios de aceptación** listados por historia.

---

## Definiciones transversales

| Tema | Decisión |
|------|----------|
| **Multi-tenant** | Toda la solución es **multi-tenant**. Cada **negocio** configurado en HU-02 es un **tenant**. Todas las historias de usuario y datos deben estar **aislados por tenant** (sin cruce de información entre negocios). |
| **Zona horaria** | Todos los cálculos de “día”, rangos de fecha y timestamps de negocio usan la **zona horaria configurada en el servidor**. Se asume que todos los clientes del producto operan en **el mismo huso** que el servidor (no hay selector de timezone por usuario en esta etapa). |
| **Sesión (HU-01)** | El límite de sesión (p. ej. 8 horas) aplica por **inactividad**: ante actividad del usuario, el temporizador se reinicia; al vencer el inactivo, redirige al login. |
| **Ingresos / métricas (HU-03)** | “Ingresos” se desdobla en dos métricas: **facturado** (total de comprobantes emitidos según reglas definidas, excluyendo anulados salvo que se indique lo contrario) y **cobrado** (pagos efectivamente registrados en comprobantes). Ambas deben mostrarse donde el dashboard refiera ingresos del día o de la semana. |
| **Unicidad de clientes (HU-10, HU-12)** | Las comprobaciones de duplicado por teléfono, email o RUC consideran **solo valores no vacíos** (cadenas vacías o nulas no participan en la unicidad). |
| **Cliente ocasional** | Se representa mediante un **identificador genérico** del sistema (por tenant), no como fila de cliente con datos obligatorios. |
| **Actualización “en tiempo real” (HU-03)** | El refresco de datos del dashboard es por **polling cada 1 minuto** (no WebSockets en esta definición). |
| **Categorías de servicio (HU-04)** | El administrador del negocio puede **crear, editar y desactivar** su propia lista de categorías. En servicios y filtros, la categoría es siempre una **lista cerrada** definida por ese negocio. |
| **Caja (HU-13, HU-18)** | No se exige cerrar la caja para continuar operando en general; **no se puede abrir una nueva caja** si ya existe una caja **abierta** para el mismo tenant. El flujo de “saltear” la apertura de caja **no está en alcance** por ahora: sin caja abierta no se emiten comprobantes, según HU-13. |

---

## Módulo 0 — Autenticación & configuración inicial

---

### HU-01 · Iniciar sesión en el sistema

**Como** administrador,  
**quiero** iniciar sesión con mi email y contraseña,  
**para** acceder de forma segura al panel de gestión de Femme.

**Criterios de aceptación:**
- [ ] El sistema muestra un formulario de login con campos email y contraseña.
- [ ] Si las credenciales son incorrectas, muestra un mensaje de error claro sin revelar cuál campo falló.
- [ ] Al ingresar correctamente, redirige al dashboard principal.
- [ ] La sesión se mantiene activa por hasta 8 horas desde la última actividad (inactividad); al vencer por inactividad, redirige al login.
- [ ] Existe opción de "olvidé mi contraseña" que envía un link de recuperación al email.

---

### HU-02 · Configurar datos del negocio

> **Tenant:** Los datos configurados aquí identifican al **negocio (tenant)** en el sistema multi-tenant.

**Como** administrador,  
**quiero** cargar el nombre, logo, dirección, teléfono y RUC de la peluquería,  
**para** que aparezcan correctamente en los comprobantes fiscales y en el sistema.

**Criterios de aceptación:**
- [ ] Existe una pantalla de "Configuración del negocio" accesible desde el menú.
- [ ] Puedo cargar nombre del negocio, RUC, dirección, teléfono, email de contacto y logo (imagen).
- [ ] El campo RUC acepta el formato paraguayo (ej. `80012345-6`) y valida que el dígito verificador sea correcto.
- [ ] El RUC es obligatorio para poder emitir facturas; el sistema advierte si no está cargado al intentar facturar.
- [ ] Los datos guardados (incluyendo RUC) aparecen en el encabezado de los comprobantes PDF.
- [ ] Los cambios se guardan con un botón explícito; no se guardan solos al escribir.

---

### HU-02b · Configurar timbrado fiscal

**Como** administrador,  
**quiero** registrar el timbrado habilitado por la SET y definir desde qué número comenzar a emitir facturas,  
**para** que el sistema genere la numeración correlativa correcta conforme a la resolución vigente.

> **Contexto:** En Paraguay, la SET (Subsecretaría de Estado de Tributación) asigna a cada contribuyente un número de timbrado con un rango de numeración habilitado y una fecha de vencimiento. Las facturas deben respetar ese rango y ese timbrado.

**Criterios de aceptación:**
- [ ] Existe una sección "Timbrado" dentro de Configuración, accesible solo para el administrador.
- [ ] Puedo registrar un timbrado con los siguientes campos:
  - Número de timbrado (asignado por la SET, numérico)
  - Fecha de inicio de vigencia
  - Fecha de vencimiento
  - Número desde (inicio del rango habilitado por la SET, ej. `0000001`)
  - Número hasta (fin del rango habilitado, ej. `0999999`)
  - Número de inicio de emisión (desde qué número comenzar en Femme, para continuar la numeración del sistema anterior)
- [ ] El "Número de inicio de emisión" debe estar dentro del rango habilitado (entre "Número desde" y "Número hasta"); si no lo está, el sistema bloquea el guardado con un mensaje de error.
- [ ] El sistema valida que la fecha de vencimiento sea posterior a la fecha de inicio de vigencia.
- [ ] Una vez emitida al menos una factura con el timbrado, no se puede modificar el número de timbrado ni el rango; solo se puede desactivar y crear uno nuevo.
- [ ] Puedo tener más de un timbrado registrado, pero solo uno puede estar activo a la vez.
- [ ] El sistema muestra una alerta en el dashboard cuando el timbrado activo vence en menos de 30 días.
- [ ] El sistema muestra una alerta cuando queda menos del 10% del rango de numeración disponible.
- [ ] Si el timbrado está vencido o el rango está agotado, el sistema bloquea la emisión de nuevas facturas y muestra un mensaje explicativo con instrucciones para cargar un nuevo timbrado.

---

### HU-03 · Ver el dashboard principal

**Como** administrador,  
**quiero** ver un resumen del día al ingresar al sistema,  
**para** tener una visión rápida del estado del negocio sin necesidad de navegar.

**Criterios de aceptación:**
- [ ] El dashboard muestra: turnos del día (total, confirmados, pendientes); **ingresos facturados** e **ingresos cobrados** del día y de la semana (definiciones en “Definiciones transversales”).
- [ ] Muestra un acceso rápido al calendario y a emitir un comprobante.
- [ ] Los datos del dashboard se refrescan automáticamente por **polling cada 1 minuto** (sin recargar manualmente la página para ese refresco).
- [ ] Si no hay datos aún (día sin turnos), muestra un estado vacío con mensaje amigable.

---

## Módulo 1 — Agendamiento

---

### HU-04 · Crear y gestionar servicios

**Como** administrador,  
**quiero** definir los servicios que ofrece la peluquería con su nombre, precio y duración,  
**para** poder usarlos al agendar turnos y al emitir comprobantes.

**Criterios de aceptación:**
- [ ] Puedo gestionar las **categorías de servicio** del negocio: crear, editar y desactivar ítems en una lista propia (por tenant).
- [ ] Puedo crear un servicio con: nombre, **categoría elegida de la lista cerrada** del negocio, precio y duración en minutos.
- [ ] Puedo editar cualquier servicio existente.
- [ ] Puedo desactivar un servicio sin eliminarlo (no aparece en nuevos turnos pero mantiene historial).
- [ ] La lista de servicios es buscable y filtrable por categoría.

---

### HU-05 · Crear y gestionar profesionales

**Como** administrador,  
**quiero** registrar a las profesionales del salón con su nombre y datos de contacto,  
**para** asignarlas a los turnos y calcular sus comisiones en el futuro.

**Criterios de aceptación:**
- [ ] Puedo crear una profesional con: nombre completo, teléfono, email y foto (opcional).
- [ ] Puedo definir los días y horarios de trabajo de cada profesional.
- [ ] Puedo editar o desactivar una profesional sin perder su historial.
- [ ] La lista de profesionales se muestra con su estado (activa / inactiva).

---

### HU-06 · Ver el calendario de turnos

**Como** administrador,  
**quiero** ver un calendario semanal con todos los turnos agendados,  
**para** tener una visión clara de la ocupación del salón.

**Criterios de aceptación:**
- [ ] El calendario muestra la semana actual con columnas por día y franjas horarias.
- [ ] Cada turno se muestra con: nombre del cliente, servicio y profesional asignada.
- [ ] Puedo navegar hacia semanas anteriores y siguientes.
- [ ] Puedo filtrar el calendario por profesional.
- [ ] Al hacer clic en un turno, veo su detalle completo.

---

### HU-07 · Agendar un turno

**Como** administrador,  
**quiero** crear un turno nuevo desde el calendario,  
**para** registrar la cita de una cliente con la profesional y el servicio correspondiente.

**Criterios de aceptación:**
- [ ] Puedo crear un turno seleccionando: fecha, hora, profesional, servicio y cliente (o "cliente ocasional").
- [ ] El sistema valida que no exista otro turno en ese mismo horario para esa profesional.
- [ ] El turno creado aparece de inmediato en el calendario.
- [ ] El estado inicial del turno es "Pendiente".
- [ ] Si selecciono un servicio con duración de 90 min, el turno bloquea ese tiempo en el calendario.

---

### HU-08 · Cambiar el estado de un turno

**Como** administrador,  
**quiero** actualizar el estado de un turno,  
**para** reflejar si la cliente confirmó, llegó, no asistió o se canceló.

**Criterios de aceptación:**
- [ ] Los estados disponibles son: Pendiente, Confirmado, En curso, Completado, Cancelado, No asistió.
- [ ] Puedo cambiar el estado desde la vista de detalle del turno.
- [ ] Al marcar un turno como "Cancelado", el sistema me pide una razón (opcional).
- [ ] Los turnos "Completado" quedan visualmente diferenciados en el calendario (color o ícono).
- [ ] No puedo eliminar un turno, solo cancelarlo, para mantener el historial.

---

### HU-09 · Editar o reagendar un turno

**Como** administrador,  
**quiero** modificar la fecha, hora o profesional de un turno existente,  
**para** adaptarme a cambios de último momento.

**Criterios de aceptación:**
- [ ] Puedo editar fecha, hora, profesional y servicio de un turno desde su detalle.
- [ ] Al cambiar la fecha u hora, el sistema vuelve a validar disponibilidad.
- [ ] El turno actualizado se refleja en el calendario de inmediato.
- [ ] Solo se pueden editar turnos en estado Pendiente o Confirmado.

---

## Módulo 2 — Cliente básico

---

### HU-10 · Crear un cliente

**Como** administrador,  
**quiero** registrar los datos básicos de una cliente incluyendo su RUC si corresponde,  
**para** vincularla a sus turnos y poder emitir facturas fiscales a su nombre.

**Criterios de aceptación:**
- [ ] Puedo crear una cliente con: nombre completo, teléfono, email y RUC (todos opcionales salvo el nombre).
- [ ] El campo RUC acepta el formato paraguayo (`XXXXXXXX-D`) y valida el dígito verificador al guardar.
- [ ] El sistema verifica que no exista ya una cliente con el mismo teléfono, email o RUC **cuando esos campos tienen valor** (no se consideran duplicados los vacíos); muestra un mensaje indicando cuál campo está duplicado.
- [ ] La cliente creada queda disponible inmediatamente para buscar al agendar o facturar.
- [ ] Existe la opción de **cliente ocasional**, representada por un **identificador genérico** del sistema (sin alta de cliente con datos obligatorios).

---

### HU-11 · Buscar una cliente existente

**Como** administrador,  
**quiero** buscar una cliente por nombre, teléfono o RUC desde el formulario de turno o de factura,  
**para** vincularla rápidamente sin salir de lo que estoy haciendo.

**Criterios de aceptación:**
- [ ] El buscador aparece inline en el formulario de turno y en el de factura.
- [ ] Busca mientras escribo (desde 2 caracteres) por nombre, teléfono o RUC.
- [ ] Los resultados muestran nombre, teléfono y RUC (si existe) para facilitar la identificación.
- [ ] Si no la encuentro, puedo crear una nueva desde el mismo lugar sin perder lo que estaba haciendo.
- [ ] Al seleccionarla, sus datos (incluyendo RUC si tiene) se autocompletan en el formulario de factura.

---

### HU-12 · Ver y editar el perfil de una cliente

**Como** administrador,  
**quiero** ver y editar los datos de una cliente,  
**para** mantener la información actualizada.

**Criterios de aceptación:**
- [ ] Existe una pantalla de listado de clientes con búsqueda por nombre, teléfono o RUC.
- [ ] El listado muestra columnas: nombre, teléfono, RUC (si tiene) y cantidad de visitas.
- [ ] Al entrar al perfil de una cliente, veo sus datos básicos y un historial simple de sus turnos y comprobantes.
- [ ] Puedo editar nombre, teléfono, email y RUC.
- [ ] Si edito el RUC, el sistema vuelve a validar el formato y que no esté duplicado con otra cliente **para valores no vacíos** (misma regla que en alta).
- [ ] No puedo eliminar una cliente que tenga historial asociado; solo desactivarla.

---

## Módulo 3 — Facturación

---

### HU-13 · Abrir la caja del día

**Como** administrador,  
**quiero** registrar la apertura de caja con el monto inicial en efectivo,  
**para** tener un control del flujo de dinero del día.

**Criterios de aceptación:**
- [ ] Al iniciar el día (o al intentar operar sin caja abierta), el sistema solicita abrir la caja con un monto inicial.
- [ ] No puedo emitir comprobantes hasta abrir la caja (no hay flujo de “saltear” apertura en esta etapa).
- [ ] Solo puede haber una caja abierta a la vez por negocio; **no se puede abrir** una nueva caja si ya existe una abierta. No se obliga a cerrar la caja para seguir operando.
- [ ] La apertura queda registrada con fecha, hora y usuario.

---

### HU-14 · Emitir un comprobante

**Como** administrador,  
**quiero** generar un comprobante de pago al finalizar un servicio,  
**para** registrar la venta y entregar un recibo fiscal a la cliente.

**Criterios de aceptación:**
- [ ] Puedo iniciar un comprobante desde un turno completado o de forma independiente.
- [ ] Puedo agregar uno o varios servicios (o productos en el futuro) como ítems.
- [ ] Puedo vincular la factura a una cliente existente o dejarla como "cliente ocasional".
- [ ] Si la cliente tiene RUC cargado, este se muestra automáticamente en el comprobante; puede editarse para esa factura en particular sin modificar el perfil.
- [ ] Puedo aplicar un descuento en monto fijo o porcentaje sobre el total.
- [ ] Selecciono el método de pago: efectivo, tarjeta débito, tarjeta crédito, transferencia u otro.
- [ ] Al confirmar, el sistema asigna el siguiente número disponible dentro del rango del timbrado activo. El número se muestra con el formato de 7 dígitos con ceros a la izquierda (ej. `0000043`).
- [ ] Si no hay timbrado activo vigente, el sistema bloquea la emisión y muestra el mensaje de error correspondiente.
- [ ] El comprobante emitido es descargable en PDF e incluye: datos del negocio, número de timbrado, número de factura, RUC del negocio, datos de la cliente (con RUC si tiene), ítems, subtotal, descuento, total y método de pago.

---

### HU-15 · Registrar pagos con múltiples métodos

**Como** administrador,  
**quiero** dividir el pago de un comprobante entre más de un método,  
**para** registrar correctamente cuando la cliente paga parte en efectivo y parte con tarjeta.

**Criterios de aceptación:**
- [ ] Al facturar puedo agregar más de un método de pago con su monto.
- [ ] La suma de los métodos de pago debe coincidir con el total del comprobante para poder confirmar.
- [ ] El sistema me muestra el monto restante por asignar mientras cargo los métodos.

---

### HU-16 · Ver el historial de comprobantes

**Como** administrador,  
**quiero** ver todos los comprobantes emitidos con filtros por fecha y cliente,  
**para** consultar el historial de ventas rápidamente.

**Criterios de aceptación:**
- [ ] Existe una pantalla de historial con todos los comprobantes ordenados por fecha descendente.
- [ ] Puedo filtrar por rango de fechas, cliente y estado.
- [ ] Cada fila muestra: número, fecha, cliente, total y estado.
- [ ] Puedo abrir el detalle de cualquier comprobante y descargarlo en PDF.

---

### HU-17 · Anular un comprobante

**Como** administrador,  
**quiero** anular un comprobante emitido por error,  
**para** corregir el registro sin eliminar el historial.

**Criterios de aceptación:**
- [ ] Puedo anular un comprobante desde su vista de detalle.
- [ ] El sistema me solicita una razón de anulación (campo de texto, obligatorio).
- [ ] El comprobante anulado cambia su estado a "Anulado" y queda visible en el historial.
- [ ] No se puede anular un comprobante de un día anterior al cierre de caja del mismo día.

---

### HU-18 · Cerrar la caja del día

**Como** administrador,  
**quiero** cerrar la caja al finalizar el día con un resumen de ingresos por método de pago,  
**para** controlar si los montos reales coinciden con lo registrado en el sistema.

**Criterios de aceptación:**
- [ ] Al cerrar la caja, el sistema muestra un resumen: total facturado, subtotales por método de pago y cantidad de comprobantes.
- [ ] Puedo ingresar el monto real contado en efectivo para compararlo con el esperado.
- [ ] El sistema calcula y muestra la diferencia (sobrante o faltante).
- [ ] El cierre queda registrado con fecha, hora, usuario y el resumen completo.
- [ ] No se pueden emitir comprobantes con la caja cerrada.

---

## Consideraciones generales del MVP

| Tema | Decisión |
|---|---|
| Multi-tenant | Toda la solución es multi-tenant; cada negocio (HU-02) es un tenant; ver **Definiciones transversales**. |
| Zona horaria | Cálculos de día/fecha con timezone del servidor; clientes asumidos en el mismo huso. |
| Rol único | Solo Admin en esta etapa |
| Cliente opcional | El comprobante permite "cliente ocasional" mediante identificador genérico (sin alta obligatoria de cliente) |
| Eliminación de datos | Ningún registro se elimina; solo se desactiva o anula |
| Acceso | Web responsive (funciona en tablet en el salón) |
| Notificaciones | No incluidas en MVP; se suman en E2 |
| Multi-profesional | Soportado desde el inicio en la agenda |
| RUC del negocio | Obligatorio para emitir facturas; se configura en HU-02 |
| RUC del cliente | Opcional; validado con dígito verificador paraguayo |
| Timbrado | Un timbrado activo a la vez; bloqueo automático al vencer o agotar rango |
| Numeración de factura | Asignada por timbrado activo; configurable el número de inicio para migrar desde sistema anterior |
| Caja | Una caja abierta por tenant a la vez; cierre no obligatorio; sin “saltear” apertura (ver Definiciones transversales) |
| Dashboard | Ingresos como facturado + cobrado; refresco automático cada 1 minuto |
| Categorías de servicio | Lista definida por el admin del negocio; uso cerrado en servicios y filtros |

---

*Femme SaaS · Documento generado para Etapa 1 · MVP*
