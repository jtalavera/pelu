# Progreso — Integración SIFEN

Memoria de trabajo para el loop `/sifen-loop`. Se actualiza al final de cada HU completada.
Todo el trabajo vive en la branch `feat/integracion-sifen` (worktree en `pelu-sifen/`).

## Estado

**Fase 5 completa (2026-08-01) — las 22 historias de usuario del plan están hechas.** `HU-22`
(activación real por tenant, ver detalle abajo) cierra el plan completo de esta integración. Queda
pendiente únicamente la deuda técnica transversal ya documentada (RT-09/RT-10, Azure Key Vault —
ver "Deuda técnica" más abajo), fuera del alcance de las 22 HU numeradas.

**Actualización 2026-08-01 — el bloqueo externo `dCodRes=1252` se resolvió y HU-13/HU-14 ahora tienen
"Aprobado" real, confirmado en vivo para los 5 tipos de documento.** Ver la sección "Adenda
2026-08-01" (justo antes de "## HU-22" más abajo) para el diagnóstico completo, incluyendo el uso en
vivo del propio `SiConsRUC` de SIFEN para diagnosticar el estado real del RUC piloto, y la cadena de
~15 gaps de contenido/schema reales (no de código de homologación, sino defectos genuinos de
`SifenDocumentXmlService`) que quedaron destapados una vez que ese bloqueo externo dejó de
enmascararlos.

**Actualización 2026-08-01 (sesión posterior, "Adenda 2") — cerrados los gaps que la Adenda original
había dejado pendientes en HU-15/HU-16/HU-17.** Ver "Adenda 2 (2026-08-01)" (antes de "## Adenda 3"
más abajo). Las 6 historias de `EP-05` (HU-12..HU-17) pasan hoy con aserción dura, sin ningún
`Assumptions.assumeTrue` activado en una corrida en vivo limpia — la única excepción documentada y
permanente es el veredicto "SIFEN reconoce el QR como válido" de HU-17 AC-02, fuera de alcance por
diseño (se renderiza client-side en la SPA de SIFEN). Sigue pendiente re-ejecutar
`SifenHomologationFinalReportTest` (el reporte consolidado) para que refleje este estado.

**Actualización 2026-08-01 (tercera sesión, "Adenda 3") — HU-10/HU-11 verificados en vivo por primera
vez a través del flujo real de producción (no solo tests aislados), encontrando y corrigiendo 4 bugs
reales de producción en el camino.** Ver "Adenda 3 (2026-08-01)" (antes de "## HU-22" más abajo): un
margen de reloj que EP-05 ya tenía pero nunca se había portado a código de producción (`dCodRes=1004`
en toda emisión real), el mismo bug de auto-invocación `@Transactional` que HU-11 ya había corregido
pero nunca portado a `SifenInvoiceCancellationService` (una cancelación real no persistía nada), un
refinamiento del margen de reloj específico de cancelación (`dCodRes=4009`, anclado a la aprobación
real de la factura), y un mensaje de log engañoso. Con los 4 corregidos: **HU-10 AC-03 y HU-11 AC-05
confirmados en vivo, `dCodRes=0600` genuino, por primera vez en toda esta integración.**

Plan completo: `Especificacion_SIFEN_Peluqueria.md` sección "Plan de implementación por fases".

| HU | Estado | Notas |
|---|---|---|
| HU-18 Cargar certificado y clave | ✅ Done | Ver detalle abajo. ⚠️ Cifrado en reposo hoy no cumple RT-09/RT-10 fuera de `e2e` — ver "Deuda técnica" abajo. |
| HU-20 Calcular estado del certificado | ✅ Done | Ver detalle abajo. |
| HU-21 Usar certificado vigente automáticamente | ✅ Done | Ver detalle abajo. |
| HU-05 Conectarse de forma segura con SIFEN | ✅ Done | Ver detalle abajo. Verificado en vivo contra SIFEN real. |
| HU-01 Generar número de control | ✅ Done | Ver detalle abajo. |
| HU-02 Datos identificación/timbrado/emisor/receptor | ✅ Done | Ver detalle abajo + "Adenda AC-07 (2026-08-01)". **AC-07 (departamento/ciudad del receptor) cerrado de punta a punta** — antes ni siquiera existía un campo de dirección en la UI del cliente; ahora hay un picker buscable contra el catálogo geográfico real de la DNIT (6.766 localidades) y `SifenDocumentXmlService` emite `cDepRec`/`cCiuRec` reales. |
| HU-03 Servicios facturados y totales | ✅ Done | Ver detalle abajo. |
| HU-04 Firmar digitalmente | ✅ Done | Ver detalle abajo. |
| HU-06 Enviar factura y registrar resultado | ✅ Done | Ver detalle abajo + "Adenda 3 (2026-08-01)". **Verificado en vivo `Aprobado` real (`0260`) a través del flujo completo de producción** (no solo tests aislados) — encontró y corrigió un bug real: ningún código de producción tenía el margen de seguridad de reloj que EP-05 sí tenía, causando `dCodRes=1004` en toda emisión real (`SIFEN_CLOCK_SKEW_BUFFER`, ver Adenda 3). |
| HU-07 Verificar estado de una factura pendiente | ✅ Done | Ver detalle abajo. Verificado en vivo contra SIFEN real (CDC inexistente); primera historia con pantalla + controller propios. |
| HU-19 Ver listado de certificados | ✅ Done | Ver detalle abajo. Sin interacción con SIFEN (N/A) — 100% lectura de datos locales. |
| HU-08 Generar comprobante PDF (KuDE) | ✅ Done | Ver detalle abajo. Verificado en vivo: el fix de `gCamFuFD/dCarQR` cierra ese gap específico; quedan 3 gaps menores ya documentados por HU-06, sin "Aprobado" real todavía. |
| HU-09 Revalidar en SIFEN una factura | ✅ Done | Ver detalle abajo. **Cierra Fase 2.** Verificado en vivo: la URL real (`consultas-test/qr?...`) responde HTTP 200 con la app "Consultas" real de SIFEN. |
| HU-10 Cancelar una factura ya aprobada | ✅ Done | Ver detalle abajo + "Adenda 3 (2026-08-01)". **AC-03 (SIFEN aprueba la cancelación) confirmado en vivo, `dCodRes=0600`, por primera vez en toda esta integración** — encontró y corrigió 2 bugs reales: el mismo bug de auto-invocación `@Transactional` que HU-11 ya había corregido pero nunca se había portado acá (una cancelación real no persistía nada), y un margen de reloj que podía quedar antes de la aprobación real (`dCodRes=4009`), ver Adenda 3. |
| HU-11 Identificar al cliente en una factura sin datos | ✅ Done | Ver detalle abajo + "Adenda 3 (2026-08-01)". **Cierra Fase 3.** **AC-05 (SIFEN aprueba la identificación) confirmado en vivo, `dCodRes=0600`, por primera vez** — evento no documentado en el Manual V150, encontrado solo en el XSD real en vivo. |
| HU-12 Probar la conexión segura contra todos los servicios | ✅ Done | Ver detalle abajo. **Primer paso de Fase 4.** Los 7 servicios nombrados por AC-01 (6 endpoints reales distintos) verificados en vivo: certificado válido aceptado, certificado inválido rechazado, en los 14 casos. |
| HU-13 Probar el envío inmediato de facturas correctas e incorrectas | ✅ Done | Ver detalle abajo + "Adenda 2026-08-01". **Cierra los 3 gaps de schema heredados de HU-04/HU-06/HU-08** (`dFeFinT`/`dDesUniMed`/`dBasExe`), más un 4° hallazgo (`dDesMoneOpe`/`dDMoneTiPag`). AC-02 (incorrectas rechazadas) y **AC-01 (correctas aprobadas, 5/5) verificados en vivo con aserción dura — el bloqueo externo `dCodRes=1252` que impedía esto se resolvió el 2026-08-01, y 2 gaps reales más (departamento/ciudad del emisor, descripción del tipo de documento de identidad del receptor) quedaron cerrados en la misma sesión.** |
| HU-14 Probar el envío inmediato de los demás tipos de comprobante | ✅ Done | Ver detalle abajo + "Adenda 2026-08-01". Extiende `SifenDocumentXmlService` a nota de crédito/débito/autofactura/nota de remisión (iTiDE 5/6/4/7). **AC-01 y AC-02 (correctas aprobadas Y incorrectas rechazadas, 5/5 por tipo, los 4 tipos) verificados en vivo con aserción dura** — cerrada una cadena larga de gaps reales de schema/contenido específicos de cada tipo (ver Adenda), la última confirmación de que `SifenDocumentXmlService` cubre correctamente los 5 tipos de documento electrónico que homologación exige. |
| HU-15 Probar el envío por lotes de todos los tipos de comprobante | ✅ Done | Ver detalle abajo + "Adenda 2 (2026-08-01)". **Introduce el WS asíncrono `SiRecepLoteDE`/`SiResultLoteDE`, nunca usado hasta ahora.** AC-03/AC-04/AC-05 ya venían con aserción dura. **AC-01/AC-02 (correctas aprobadas, los 5 tipos) ahora también con aserción dura** — cerrados los mismos gaps de `isAutoInvoice`/`gCamDEAsoc`/seed-por-escenario de Nota de Crédito que HU-14 ya había resuelto en su propio archivo, replicados acá. |
| HU-16 Probar el registro de todos los eventos exigidos | ✅ Done | Ver detalle abajo + "Adenda 2 (2026-08-01)". **Cierra el muro `dCodRes=0160`** (root-cause corregido en vivo, ver detalle original). **AC-01/AC-03 completo/AC-05 ahora también con aserción dura** — el test ya no reacciona sobre CDCs sintéticos para estos casos: siembra sus propias facturas reales y las cancela/confirma/cuestiona genuinamente aprobadas, incluida la primera confirmación en vivo de que una "corrección" (Tabla K) es aceptada (`dCodRes=0600`), no rechazada. |
| HU-17 Probar la consulta de documentos y la generación de comprobantes de todos los tipos | ✅ Done | Ver detalle abajo + "Adenda 2 (2026-08-01)". **Cierra Fase 4.** Reporte final consolidado de EP-05 (HU-12..HU-17) construido y corrido en vivo. **AC-01/AC-03 (envío + contenido completo) ahora con aserción dura para los 5 tipos** — mismos gaps que HU-15 replicados y cerrados en este archivo; solo el veredicto "SIFEN reconoce el QR como válido" (AC-02) queda fuera de alcance, por diseño (se renderiza client-side en la SPA de SIFEN, nunca lo interpreta este sistema). |
| HU-22 Activar/desactivar la facturación electrónica por tenant | ✅ Done | Ver detalle abajo. **Cierra Fase 5 y el plan completo (22/22 HU).** Encontró y corrigió un bug real preexistente (`SifenInvoiceSubmissionService` nunca persistía nada, ver detalle) — la primera vez que `submit()` corrió a través de un flujo real de emisión, no un test. |

**Próximo paso al reanudar el loop:** no queda ninguna historia numerada pendiente del plan. Si se
retoma este loop, lo único abierto es la deuda técnica transversal (RT-09/RT-10, Azure Key Vault +
Managed Identity para la clave maestra de cifrado fuera de `e2e` — ver "Deuda técnica" abajo), que
necesita indicación explícita del usuario sobre si se aborda como una HU nueva o como chore de
infraestructura.

**El bloqueo externo `dCodRes=1252` (RUC piloto "inactivo") que HU-13 documentó se resolvió el
2026-08-01** — ver "Adenda 2026-08-01" (justo antes de "## HU-17" abajo) para el diagnóstico completo
y la cadena de gaps reales de `SifenDocumentXmlService` que ese cambio externo dejó de enmascarar,
todos cerrados en la misma sesión. Los 5 tipos de documento electrónico (factura, nota de crédito,
nota de débito, autofactura, nota de remisión) llegan hoy a `Aprobado` real, confirmado en vivo con
aserción dura en `SifenHomologationInvoiceSubmissionLiveTest`/`SifenHomologationOtherDocumentTypesLiveTest`.
Sigue pendiente re-ejecutar `SifenHomologationFinalReportTest` (el reporte consolidado de las 6
historias) para que refleje este estado — su última corrida real es anterior a esta adenda. Queda
**Fase 5** (`HU-22`, activación real por tenant) como la última fase del plan.

## Adenda (2026-08-01) — Resolución del bloqueo externo `dCodRes=1252` y cierre de ~15 gaps reales de HU-13/HU-14

Sesión posterior al cierre de Fase 4. Punto de partida: HU-13/HU-14/HU-15/HU-16/HU-17 tenían todas su
tramo de "correcta aprobada" bloqueado por el mismo límite externo documentado desde HU-13
(`dCodRes=1252 "El RUC del emisor se encuentra inactivo"`). Esta sesión (a) diagnosticó esa causa
externa usando el propio `SiConsRUC` de SIFEN, (b) confirmó su resolución en vivo, y (c) al dejar de
estar enmascarados por `1252`, quedaron al descubierto ~15 gaps reales de contenido/schema en
`SifenDocumentXmlService`, cerrados uno por uno con el mismo patrón iterativo de HU-13/HU-06 (enviar
en vivo, leer el error real, corregir, repetir) hasta que **los 5 tipos de documento llegaron a
`Aprobado` real**.

### Diagnóstico del `1252`: usar `SiConsRUC` en vez de confiar solo en Marangatu

El usuario reportó que Marangatu mostraba el RUC piloto como "Activo", contradiciendo el `1252`. En
vez de especular, se armó y envió a mano (mismo patrón `curl --cert-type P12` de siempre) una consulta
real al WS `SiConsRUC` (`https://sifen-test.set.gov.py/de/ws/consultas/consulta-ruc.wsdl`,
`rEnviConsRUC/dId/dRUCCons`, confirmado contra el XSD real descargado en vivo — coincide exactamente
con el manual, caso raro en esta integración) para el RUC `1137152` (sin DV, campo `dRUCCons`
documentado como "RUC No incluye el Dígito de verificación"). Respuesta real:

```xml
<dCodRes>0502</dCodRes><dMsgRes>RUC encontrado</dMsgRes>
<dRUCCons>1137152</dRUCCons><dRazCons>LUCIA ZYMANSCKI GALEANO</dRazCons>
<dCodEstCons>SUS</dCodEstCons><dDesEstCons>SUSPENSION TEMPORAL</dDesEstCons>
<dRUCFactElec>N</dRUCFactElec>
```

`dCodEstCons=SUS` — exactamente uno de los tres estados que el propio manual (D101b, `1252`) nombra
como descalificantes ("distinto a CANCELADO, CANCELADO DEFINITIVO o SUSPENSIÓN TEMPORAL") — y
`dRUCFactElec=N` (un campo no documentado en el manual de 2019, presumiblemente agregado por una NT
posterior), la marca específica de "habilitado como facturador electrónico". Es decir: la
"Activo"/"SUSPENSIÓN TEMPORAL" que reporta `SiConsRUC` es un estado *distinto* del que muestra la
pantalla general de Marangatu que el usuario consultó — confirma que este es un estado de SIFEN, no
uno inventado por este código. Días después (2026-08-01), la misma consulta reportó `dCodEstCons=ACT`
("ACTIVO") — el bloqueo se había resuelto del lado de SET, sin ningún cambio de código. `dRUCFactElec`
siguió en `N`, sin que eso terminara bloqueando nada en la práctica.

**Nota operativa: `SiConsRUC` sigue sin tener un cliente Java propio en este código** (HU-12 solo
probó su conectividad mTLS) — este diagnóstico se hizo con `curl` manual, no automatizado. Construir
un `SifenRucQueryClient` real (mismo patrón que `SifenDocumentQueryClient`/`SifenEventClient`) queda
como mejora futura si se necesita repetir este diagnóstico con frecuencia.

### Gap 1 (HU-13, todos los tipos): departamento/ciudad del emisor con código y descripción que no correspondían

Con `1252` resuelto, el primer intento de envío real de una factura correcta falló con
`dCodRes=1254 "Descripción del departamento de emisión no corresponde al código"`. La causa: los
datos de prueba fijaban `cDepEmi="11"` (que en el catálogo real de departamentos — descargado en vivo
desde `evento.xsd`, `tDepartamentos` — es **Alto Paraná**) junto con `dDesDepEmi="CENTRAL"` (que en
realidad es el código `12`) — una inconsistencia código/nombre presente en 9 archivos distintos desde
que HU-04 introdujo estos campos, nunca antes ejercitada en vivo porque `1252` la enmascaraba. Corregido
`"11"`→`"12"` en los 9 archivos. Segundo intento: `dCodRes=1255 "El Departamento, el Distrito y la
Ciudad de emisión no están relacionados"` — el código de ciudad (`"3432"`) tampoco correspondía. Se
descargó el catálogo geográfico oficial completo de la DNIT (`CÓDIGO DE REFERENCIA
GEOGRAFICA_NOVIEMBRE_2025__.xlsx`, publicado en `dnit.gov.py/web/e-kuatia/tablas-y-codificaciones`,
7742 filas Departamento→Distrito→Ciudad→Barrio) para encontrar el triple real de "Fernando de la Mora,
Central": Departamento `12`/Distrito `154`/Ciudad `5044`. Corregido `"3432"`→`"5044"` en los mismos 9
archivos (no hizo falta modelar Distrito — es opcional en el XSD y la corrección de departamento+ciudad
ya bastó).

### Gap 2 (HU-13, todos los tipos): `dDTipIDRec` — bug real en `SifenDocumentXmlService`, no de datos de prueba

Con los 2 gaps anteriores cerrados: `dCodRes=1313 "Descripción del tipo de documento de identidad del
receptor no corresponde al código"`. A diferencia de los gaps anteriores, este era un **bug real de
producción**: `buildReceiver` emitía `iTipIDRec` (D208, código del tipo de documento) en sus dos ramas
(cliente identificado con cédula, o consumidor final innominado) pero nunca emitía `dDTipIDRec` (D209,
su descripción) — el manual documenta D209 como "Obligatorio si existe el campo D208", algo que ninguna
factura real de este sistema había cumplido nunca hasta ahora. Corregido: se agregó `dDTipIDRec` en
ambas ramas, reusando/extendiendo el helper `identityDocumentTypeDescription` (ya existía para
`dDTipIDVen` de autofactura) para cubrir también los códigos 5/6/9 (Innominado/Tarjeta Diplomática/
Otro). **Con los 3 gaps anteriores cerrados, `SifenHomologationInvoiceSubmissionLiveTest` alcanzó, por
primera vez en toda esta integración, `dCodRes=0260 "Autorización del DE satisfactoria"` real para las
5 facturas correctas** — el primer documento genuino jamás aprobado por SIFEN.

### Gaps 3-15 (HU-14): la cascada de nota de crédito/débito, autofactura y nota de remisión

Extender la misma verificación a los otros 4 tipos destapó una cascada larga, cada fix revelando el
siguiente (mismo patrón iterativo de HU-13, aplicado ahora con volumen — 4 tipos × múltiples campos
cada uno):

- **`1351`** — `gCamFE` (E010, campos de Factura Electrónica) es exclusivo de Factura (`iTiDE=1`);
  se emitía sin condición para los 5 tipos. Corregido: condicionado a que `extras` no tenga ningún
  grupo de tipo específico.
- **`1316`** — Autofactura exige `iTiOpe=2` (B2C) siempre, sin importar si el "receptor" (el propio
  emisor autofacturándose) tiene RUC. Corregido en `buildReceiver`, nuevo parámetro `documentType`.
- **`1318`** — Nota de Remisión exige `dDirRec` (dirección del receptor); una vez presente, `dNumCasRec`
  (número de casa) también se vuelve obligatorio. Corregido: `buildReceiver` ahora emite ambos juntos.
- **`2605`** — Nota de Remisión con `reasonCode=1` ("Traslado por venta") exige un documento asociado
  (`gCamDEAsoc`) cuando no se informa una fecha futura alternativa (campo no modelado). Se generalizó
  `SifenGoodsRemissionData`/`buildAssociatedDocumentGroup` para aceptar el mismo mecanismo de
  referencia que ya usa NC/ND, referenciando una factura semilla real.
- **`1501`** — `gCamCond` (condición de la operación) es exclusivo de Factura/Autofactura; se
  emitía también para NC/ND. Corregido: condición extendida.
- **`2562`** — El proveedor de autofactura (persona física, `iTipIDVen` cédula) usaba el número de
  prueba `"1234567"`, que resultó ser el RUC real y activo de un contribuyente genuino (confirmado
  consultando `SiConsRUC` en vivo: `BRIGIDA GAUTO JARA`, `ACT`) — SIFEN lo rechazó por "el vendedor no
  debe ser contribuyente". Corregido: `"9876543"`, confirmado en vivo como `0500 RUC no existe`, un
  número genuinamente seguro.
- **`1901`** — `gCamIVA` (E730, IVA por ítem) prohibido para Autofactura y Nota de Remisión.
- **`2353`**/**`2377`** — `dSubExe`/`dTotIVA` (F002/F017, subtotales de IVA) deben ser `0` para
  Autofactura, ya que no hay `gCamIVA` por ítem contra el cual SIFEN pueda cotejarlos — el primer
  intento (reportar el total real como "exento") también era incorrecto, debían ser `0` sin más.
  `buildTotals` ahora recibe un flag `isAutoInvoice`.
- **`2500`** — El QR (`SifenQrCodeService`) seguía calculando `dTotIVA` con el valor real (no
  cero) para autofactura, produciendo un hash que ya no coincidía con el XML corregido — el servicio
  ahora recibe el mismo flag `isAutoInvoice`.
- **`1851`** — `gValorItem` (E720, precio/descuento/total por ítem) prohibido para Nota de Remisión.
- **`2400`**/**`2416`** — `gCamDEAsoc` también es obligatorio para Autofactura, pero como **Constancia
  Electrónica** (`iTipDocAso=3`, `tdTipCons=1` "Constancia de no ser contribuyente") — nunca como
  "Impreso" (intento inicial, rechazado) ni "Electrónico" (no existe un DE previo real que referenciar).
- **`2107`/`2109`/`2150`/`2200`/`2250`/`2255`/`2300`/`2307`** — Nota de Remisión, cascada completa del
  grupo `gTransp`: fecha estimada de inicio/fin de traslado (`dIniTras`/`dFinTras`), local de salida
  (`gCamSal`) y de entrega (`gCamEnt`, ambos modelados con la dirección del propio emisor — este
  dominio no tiene un concepto de "depósito" separado), datos del vehículo (`gVehTras`, incluyendo
  `dNroIDVeh` una vez que `dTipIdenVeh=1`), y datos del transportista (`gCamTrans`, incluyendo su tipo
  de documento de identidad una vez que se modela como no contribuyente) — todos `minOccurs="0"` en el
  XSD pero obligatorios por regla de contenido para este tipo de documento, ninguno detectable sin
  enviar en vivo.
- **Hallazgo de diseño de prueba, no de código:** el escenario "incorrecta 4/5" (total no coincide)
  reutilizado de HU-13 resultó ser un no-op para Nota de Remisión (no tiene `gTotSub` desde el fix de
  `1851`/`2351` — el envío "incorrecto" terminaba aprobado). Redirigido a un CDC de referencia
  corrupto para ese tipo específico, produciendo un rechazo real y significativo
  (`2403 "Número de CDC del DTE referenciado inexistente"`).
- **Hallazgo de diseño de prueba, no de código:** Nota de Crédito reutilizaba una sola factura semilla
  para sus 5 escenarios "correcta" — una nota de crédito consume el saldo de la factura que referencia,
  así que la 2ª en adelante excedía el total de esa única factura (`dCodRes=2417`, una regla de negocio
  real, no un bug). Corregido: una factura semilla nueva por cada escenario "correcta" de Nota de
  Crédito (Nota de Débito no lo necesita, no tiene este tope).

**Resultado final, confirmado en vivo, múltiples corridas consecutivas:** `SifenHomologationInvoiceSubmissionLiveTest`
(factura) y `SifenHomologationOtherDocumentTypesLiveTest` (nota de crédito, nota de débito, autofactura,
nota de remisión) — **los 5 tipos, 5/5 correctas aprobadas + 5/5 incorrectas rechazadas, aserción dura,
sin `Assumptions.assumeTrue`.** Suite completa de backend (`./gradlew test`) y `spotlessCheck` verdes.
Blips puntuales de `1001 CDC duplicado` observados en corridas individuales son ruido de transporte ya
documentado por HU-12 (el gateway de prueba de SIFEN a veces no responde a una petición bajo ráfaga,
el reintento reenvía el mismo CDC que SIFEN ya había procesado) — no una regresión, confirmado por
corridas limpias inmediatamente posteriores.

**Re-ejecutadas (2026-08-01, misma sesión):** `SifenHomologationBatchSubmissionLiveTest` (HU-15),
`SifenHomologationEventsLiveTest` (HU-16), `SifenHomologationDocumentQueryAndKudeLiveTest` (HU-17).
Factura y Nota de Débito ya llegan a `Aprobado` real en las 3 (prueba independiente de que los fixes de
`SifenDocumentXmlService` son correctos). Pero HU-15 y HU-17 tienen su **propia** construcción de datos
de prueba, separada de la de HU-14 — se les aplicó el mismo fix de RUC de autofactura (`"1234567"`→
`"9876543"`) y de dirección de receptor para nota de remisión, pero **no el resto de la cadena** (los
campos nuevos de `gCamDEAsoc`/`gTransp`/el flag `isAutoInvoice` de `SifenQrCodeService`) — autofactura y
nota de remisión en estos dos archivos siguen fallando (`2500`/`2605`) porque usan firmas de
constructor más viejas. Nota de Crédito sigue con el mismo gap de diseño de HU-14 (reusar una sola
factura semilla para 5 notas). HU-16 no cambió — su gap (AC-01/AC-03/AC-05) es que el test nunca
intenta construir un documento realmente aprobado antes de cancelarlo/reaccionar, no un bloqueo
externo. **Pendiente:** replicar el resto de la cadena de fixes de HU-14 en `SifenHomologationBatchSubmissionLiveTest`/`SifenHomologationDocumentQueryAndKudeLiveTest`, dar a Nota de
Crédito una factura semilla por escenario en ambos archivos, y opcionalmente extender HU-16 para
construir un documento real aprobado antes de cancelar/reaccionar sobre él.

## Adenda 2 (2026-08-01) — cierre de los gaps pendientes de HU-15/HU-16/HU-17 tras una auditoría completa de status

Sesión posterior a la Adenda original y a HU-22 (cierre del plan de 22 HU). Punto de partida: una
auditoría completa del estado real de la integración (spec vs. `PROGRESS.md` vs. corridas en vivo
frescas) confirmó que HU-15/HU-16/HU-17 seguían con los gaps que la Adenda original había dejado
documentados como pendientes — se cierran acá, uno por uno, con el mismo patrón iterativo de
siempre (enviar en vivo, leer el error real, corregir, repetir).

### HU-15/HU-17: replicar la cadena de fixes de HU-14 en sus propios constructores de datos de prueba

`SifenHomologationBatchSubmissionLiveTest` (HU-15) y `SifenHomologationDocumentQueryAndKudeLiveTest`
(HU-17) construyen sus propios documentos de prueba, independientes de los de HU-14 — nunca habían
recibido el resto de la cadena de fixes que HU-14 encontró para autofactura/nota de remisión/nota de
crédito (solo el fix puntual de RUC de autofactura y dirección de receptor de remisión, aplicado en
una sesión anterior). Aplicado en ambos archivos:

- **Autofactura (`dCodRes=2500`):** el QR (`SifenQrCodeService.build`) se calculaba con el overload
  de 4 argumentos (`isAutoInvoice` implícito en `false`), pero `buildTotals` sí zeroea `dTotIVA` para
  autofactura — el hash del QR dejaba de coincidir con el XML real. Corregido: ambos archivos ahora
  pasan `extras.autoInvoiceProvider() != null` al overload de 5 argumentos, igual que HU-14.
- **Nota de Remisión (`dCodRes=2605`):** `SifenGoodsRemissionData.referencedControlNumber` se
  pasaba `null` — con `reasonCode=1` ("Traslado por venta") SIFEN exige un documento asociado. Ambos
  archivos ahora envían una factura semilla real dedicada (`"para NOTA_REMISION"`) y la referencian.
- **Nota de Crédito (`dCodRes=1461`/`2417`, "Saldo de Factura no Actualizado"/"excede el monto"):**
  ambos archivos reusaban una sola factura semilla para las 5 (HU-15) o 3 (HU-17) notas de crédito
  "correctas" — una nota de crédito consume el saldo de la factura que referencia, así que solo la
  primera podía aprobarse. Corregido: cada nota de crédito "correcta" siembra su propia factura real
  antes de construirse, mismo patrón que HU-14 ya usaba.

**Resultado, confirmado en vivo, corrida limpia:** `SifenHomologationBatchSubmissionLiveTest` pasa
**sin ningún `Assumptions.assumeTrue` activado** (los 5 tipos, correctas aprobadas e incorrectas
rechazadas, más los 2 lotes mezclados). `SifenHomologationDocumentQueryAndKudeLiveTest` también:
el único tramo que sigue con `Assumptions.assumeTrue`/quedando siempre `FALLO` por diseño es el
veredicto "SIFEN reconoce el QR como válido" (AC-02) — confirmado que ya no tiene nada que ver con
el bloqueo externo `1252` (que sigue resuelto), sino que es un límite arquitectónico permanente: esa
respuesta la renderiza la SPA Angular de SIFEN del lado del cliente, este sistema nunca la interpreta
por diseño (mismo hallazgo que HU-09 ya estableció). El assumeTrue original de este archivo incluía
esas filas en el mismo chequeo que las filas "genuinamente aprobado" — lo cual lo hacía abortar para
siempre incluso con el `1252` resuelto, defeating su propio propósito; se separaron los dos chequeos
(ver commit) para que la mitad realmente dependiente del `1252` pueda pasar en verde, y la mitad
arquitectónicamente fuera de alcance quede documentada sin bloquear nada.

### HU-16: sembrar un documento realmente aprobado antes de cancelar/reaccionar — y dos hallazgos reales de timing en el camino

`SifenHomologationEventsLiveTest` reaccionaba solo sobre CDCs sintéticos nunca aprobados para
AC-01/AC-05/la mitad de AC-03 (conformidad/disconformidad/corrección) — un gap de diseño de la
prueba, no un bloqueo externo (ya documentado así en la Adenda original). Se agregó
`sendApprovedSeedDocument` (mismo patrón envío-inmediato que HU-13/14/15/17) para sembrar facturas
reales y reaccionar sobre CDCs genuinamente aprobados por SIFEN. Esto expuso dos bugs reales, ninguno
relacionado con el bloqueo externo `1252`:

- **`dCodRes=4009` "Plazo de solicitud de cancelación de una FE extemporáneo" (GDE004a, Manual
  Técnico V150 sección 11.6.1):** la regla real es que la fecha/hora de firma digital del evento de
  cancelación no puede superar las 48 horas desde la fecha/hora de aprobación en SIFEN — pero
  `signatureInstant()` (el margen de seguridad de 2 minutos que HU-13 estableció contra el reloj del
  sandbox) restaba 2 minutos también acá, dejando la fecha declarada del evento **antes** de que la
  aprobación real hubiera ocurrido — la misma regla, disparada desde el lado contrario. Corregido:
  nuevo `postApprovalSignatureInstant()` (sin margen) para los eventos que reaccionan sobre una
  aprobación de la misma corrida — el tiempo real que ya transcurre construyendo/enviando el
  documento semilla es margen suficiente contra el reloj de SIFEN sin necesitar el buffer artificial.
- **`dCodRes=1002` "Documento electrónico duplicado":** `documentNumberCursor` (nuevo campo de esta
  historia) nunca se inicializaba, quedando en `0` — cada corrida generaba los mismos números de
  documento (1, 2, 3...) que una corrida anterior ya había usado para real. Corregido: mismo patrón
  `Math.max(10, (System.currentTimeMillis() / 1000) % 9_000_000L)` que HU-13/14/15/17 ya usan.

**Hallazgo real de negocio, no de código:** con ambos bugs corregidos, "corrección de un evento
anterior" (Disconformidad registrada inmediatamente después de Conformidad sobre el mismo CDC
genuinamente aprobado, la forma que Tabla K describe) resultó **`dCodRes=0600` Aprobado** — SIFEN sí
acepta la corrección, no la rechaza. Ninguna fuente disponible en este repositorio (Manual Técnico
V150 completo, `Especificacion_SIFEN_Peluqueria.md`) documentaba el veredicto esperado de antemano;
queda confirmado en vivo por primera vez.

**Resultado final, confirmado en vivo, corrida limpia:** `SifenHomologationEventsLiveTest` pasa
**sin ningún `Assumptions.assumeTrue` activado** — AC-01 (5/5 cancelaciones de documentos
genuinamente aprobados), AC-02 (5/5 anulación de numeración, sin cambios), AC-03 completo
(desconocimiento/notificación/conformidad/disconformidad/corrección, los 5 casos genuinamente
aprobados) y AC-05 (segundo intento de cancelación rechazado, ahora con el motivo específico real
`4003` "CDC ya se encuentra con el mismo evento solicitado" en vez del `4002` genérico de una corrida
anterior con el bug de duplicados sin corregir).

**Backend** (`src/backend/src/test/java/com/cursorpoc/backend/service/`):
- `SifenHomologationBatchSubmissionLiveTest.java` — `isAutoInvoice` en el QR, seed de Nota de
  Remisión, seed por escenario de Nota de Crédito; AC-01/AC-02 se mantienen como
  `Assumptions.assumeTrue` (no aserción dura) deliberadamente, para no romper el build si el
  `1252` externo alguna vez regresa — mismo criterio que HU-13/14 ya establecieron.
- `SifenHomologationDocumentQueryAndKudeLiveTest.java` — mismos 3 fixes; el chequeo de "genuinamente
  aprobado" (AC-01/AC-03) se separó del de "QR reconocido como válido" (AC-02, fuera de alcance
  permanente) para que el primero pueda pasar en verde sin que el segundo lo enmascare para siempre.
- `SifenHomologationEventsLiveTest.java` — `sendApprovedSeedDocument`/`sendDocumentWithRetry`/
  `postApprovalSignatureInstant` (nuevos); AC-01/AC-05/AC-03 conformidad-disconformidad-corrección
  ahora con aserción dura, detrás de un único `Assumptions.assumeTrue` que solo aborta si sembrar el
  documento real falla (protección ante una futura regresión del `1252`, mismo criterio que el resto
  de EP-05).

**Playwright**: ninguno — mismo patrón que toda historia de EP-05 (capacidad de prueba de
homologación, sin pantalla propia).

## Adenda 3 (2026-08-01) — HU-10/HU-11 verificados en vivo por primera vez a través del flujo real de producción, y 4 bugs reales de producción encontrados en el camino

Sesión posterior a la Adenda 2. Objetivo: re-verificar el camino feliz de HU-10 (cancelar) y HU-11
(identificar cliente) contra un documento genuinamente aprobado — algo que, a diferencia de EP-05
(HU-12..17), **nunca se había probado a través del flujo real de producción** (`InvoiceController` →
`InvoiceService.issueInvoice` → `SifenInvoiceSubmissionService` → `SifenInvoiceCancellationService`/
`SifenInvoiceClientIdentificationService`), solo a través de tests aislados que construyen su propio
documento en memoria. Para esto, se levantó el backend real (`SPRING_PROFILES_ACTIVE=e2e` para la
semilla de datos demo + H2, pero con `app.femme.sifen.connection.test-base-url` sobreescrito de
vuelta al `sifen-test.set.gov.py` real vía `--args` de `bootRun`, en vez del puerto discard que usa
`e2e` normalmente) y se emitió/canceló/identificó una factura real a mano, con `curl`, exactamente el
mismo patrón que HU-22 ya había usado para su propia verificación en vivo.

**Este intento destapó 4 bugs reales de producción, ninguno relacionado con el bloqueo externo
`1252`** (ya resuelto) — el primer intento de emitir una factura real a través del flujo completo de
producción, apuntando al SIFEN real, en la historia de esta integración:

### Bug 1 — ningún código de producción tenía el margen de seguridad de reloj que EP-05 sí tenía (`dCodRes=1004`)

El primer intento de emitir devolvió `dCodRes=1004 "La fecha y hora de la firma digital es
adelantada"` — el mismo hallazgo de reloj que HU-13 documentó y que cada test "Live" de EP-05 ya
resolvía restando 2 minutos (`CLOCK_SAFETY_BUFFER`) al construir su propio documento en memoria. Pero
**ese margen nunca se portó al código real de producción** — `SifenInvoiceSubmissionPersistenceService
.prepareForSubmission` (la única fuente real de `dFecFirma` para una factura normal) usaba
`LocalDateTime.now(...)` sin ningún ajuste. Nunca se había detectado porque ningún test anterior
—incluido HU-22, que sí corrió `submit()` a través de un contexto Spring real— había llegado a
intentar una aprobación genuina contra el SIFEN real (HU-22 corrió contra el puerto discard de `e2e`,
donde este código nunca llega a importar). Confirmado que el reloj del propio sandbox de SIFEN corre
detrás del real (verificado con el header `Date` de una respuesta HTTP externa confiable en el mismo
instante) — no es un problema del reloj de esta máquina.

**Corregido:** el mismo margen de 2 minutos (`SIFEN_CLOCK_SKEW_BUFFER`), aplicado solo al valor
persistido como `sifenSignedAt`/enviado como `dFecFirma` — el chequeo local de la ventana de 72 horas
(AC-07) sigue comparando contra el `now` real, sin margen. Mismo patrón aplicado a
`SifenInvoiceCancellationService.prepareForCancellation` y
`SifenInvoiceClientIdentificationService.prepareForIdentification` (los eventos también necesitan
este margen para su propia `dFecFirma`/GDE004).

### Bug 2 — `SifenInvoiceCancellationService` tenía el mismo bug de auto-invocación que HU-11 ya había encontrado y corregido, pero nunca portado

Con el Bug 1 corregido, una factura real llegó a `Aprobado` (`0260`) por primera vez a través del
flujo normal de la aplicación. Al cancelarla, SIFEN respondió con un resultado real (`REJECTED` en el
primer intento, por el Bug 3 de abajo) — pero **ninguno de los campos de auditoría de la cancelación
se persistió**, ni siquiera `sifenCancellationRequestedAt` (que HU-10 documenta como escrito *antes*
de cualquier llamada de red). Causa raíz: exactamente el mismo bug de auto-invocación de
`@Transactional` que HU-11 ya había encontrado y corregido para
`SifenInvoiceClientIdentificationService` (proxy AOP de Spring, que solo intercepta llamadas que
llegan desde *fuera* del bean) — HU-11 documentó explícitamente no portar la corrección a
`SifenInvoiceCancellationService` por no tener cómo ejercitarlo en ese momento. Esta sesión fue la
primera vez que `cancel()` corrió a través de un contexto Spring real sin ningún atajo de test,
exactamente el escenario que expone el problema (mismo patrón que HU-22 ya estableció para
`SifenInvoiceSubmissionService`).

**Corregido:** mismo patrón `@Autowired @Lazy` de auto-proxy que `SifenInvoiceClientIdentificationService`
ya usa — `prepareForCancellation`/`recordCancellationResult` ahora se llaman a través de `self()`, no
de `this.` directo. Verificado con una segunda corrida en vivo: los campos de auditoría (incluido
`sifenCancellationResultCode`/`sifenCancellationMessage`) ahora sí persisten, confirmado con un `GET`
fresco después del `POST` de cancelación.

### Bug 3 — el margen de reloj de cancelación podía quedar *antes* de la aprobación real (`dCodRes=4009`)

Con el Bug 2 corregido, la cancelación devolvió `dCodRes=4009 "Plazo de solicitud de cancelación de
una FE extemporáneo"` (GDE004a, Manual Técnico V150 sección 11.6.1: la fecha de firma del evento de
cancelación no puede superar las 48 horas desde la aprobación en SIFEN) — al cancelar apenas segundos
después de emitir, restar 2 minutos a `now` dejaba la fecha declarada del evento *antes* de que la
aprobación real hubiera ocurrido, la misma regla disparada desde el lado contrario (idéntico hallazgo
al que motivó `postApprovalSignatureInstant()` en `SifenHomologationEventsLiveTest`, Adenda 2 arriba).
**Corregido:** en vez de restar el margen incondicionalmente, `prepareForCancellation` ahora usa
`max(now - 2min, invoice.sifenSubmittedAt + 1s)` — nunca antes de la aprobación real registrada, y
solo aplica el margen de reloj completo cuando la factura se cancela bastante después de aprobada
(donde `sifenSubmittedAt` ya queda muy en el pasado y no cambia el resultado). **Confirmado en vivo,
tercer intento: `dCodRes=0600 "Evento registrado correctamente"`, la aprobación real de una
cancelación por primera vez en toda esta integración**, con `sifenSubmissionStatus` pasando a
`CANCELLED`. Nota: `SifenInvoiceClientIdentificationService` no necesitó este mismo ajuste — probado
en vivo que el margen simple (sin anclar a la aprobación) ya funciona para el evento de nominación,
consistente con que el Manual Técnico solo documenta esta regla de "plazo desde aprobación" (GDE004a)
para el evento de cancelación específicamente, no para nominación.

### Bug 4 (menor, cosmético) — el log de firma de eventos siempre decía "cancellation" sin importar el tipo real

`SifenDocumentSigningService.signEvent` logueaba `"SIFEN cancellation event signed"`
incondicionalmente, para cualquier tipo de evento (anulación de numeración, eventos de receptor,
etc.) — un mensaje engañoso que casi lleva a un diagnóstico equivocado durante esta sesión al firmar
el evento de identificación de cliente. Corregido a `"SIFEN event signed"`, genérico.

### Hallazgos operativos (no bugs de código) al armar la verificación en vivo

- El timbrado local sembrado por defecto (`FemmeDataInitializer`, `"12345678"`) es un valor de
  prueba interno de esta app — no corresponde al timbrado real registrado ante SIFEN para el RUC
  piloto (`"1137152"`, el mismo valor que `STAMP_NUMBER` en todos los tests de EP-05). Sin este ajuste,
  SIFEN rechaza con `dCodRes=1101 "Número de timbrado inválido"`.
- La descripción de actividad económica debe coincidir exactamente (con tilde) con el catálogo real
  de SIFEN: `"Peluquería y otros tratamientos de belleza"` para el código `96020` — una versión sin
  tilde ("Peluqueria") es rechazada con `dCodRes=1262 "Descripción de la actividad económica no
  corresponde al código"`.
- Un servicio sembrado con tasa de IVA `Exento` (0%) dispara `dCodRes=1905 "Proporción gravada del
  IVA incorrecta para forma de afectación Exonerado o Exento"` — confirma en vivo el gap ya
  documentado de HU-03 (`EXONERADO`/`GRAVADO_PARCIAL` genuinamente rotos, ver "Deuda técnica"/plan de
  gaps). Para esta verificación se usó un servicio con IVA 10% (`GRAVADO`), fuera del alcance de ese
  gap.
- El número de emisión de un timbrado, una vez usado contra el SIFEN real, no se puede reutilizar
  nunca más (`dCodRes=1002 "Documento electrónico duplicado"`) — cada verificación en vivo con un
  backend recién levantado (H2 en memoria, contador de numeración reiniciado) necesita un
  `initialEmissionNumber` nuevo, nunca reutilizado en una sesión anterior contra el mismo RUC/timbrado
  piloto.

**Resultado final, confirmado en vivo:**
- **HU-10 AC-03** (SIFEN aprueba la cancelación → estado `CANCELLED`): confirmado, `dCodRes=0600`,
  factura genuinamente aprobada y genuinamente cancelada, por primera vez a través del flujo real de
  producción.
- **HU-11 AC-05** (SIFEN aprueba la identificación → datos del cliente registrados): confirmado,
  `dCodRes=0600 "Evento registrado correctamente"`, `sifenClientIdentified=true`.
- Ambos verificados con los campos de auditoría (AC-05 de ambas historias) correctamente persistidos,
  confirmado con `GET` fresco tras cada operación.

**Nota post-fix: `SifenHomologationEventsLiveTest` (HU-16) corrida como parte de la suite completa**
(`./gradlew test`, no aislada) mostró un `FALLO` puntual — `AC-01 cancelación 3/5` volvió
`dCodRes=0100 "Error Inesperado"` en vez de `0600`, mientras las otras 4/5 cancelaciones idénticas
(mismo código, mismo tipo de petición) sí aprobaron. Mismo patrón de ruido de transporte puntual del
sandbox de SIFEN que HU-12 ya documentó (`1001 CDC duplicado` bajo ráfaga) — no una regresión: la
misma clase corrió aislada minutos antes con aserción dura 100% en verde. No se agregó reintento
específico para `0100` (sería sobre-ingeniería para un blip raro y no determinístico); si se repite
con frecuencia en corridas futuras, ahí sí ameritaría revisarse.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`):
- `SifenInvoiceSubmissionPersistenceService.java` — `SIFEN_CLOCK_SKEW_BUFFER` (Bug 1).
- `SifenInvoiceCancellationService.java` — `SIFEN_CLOCK_SKEW_BUFFER` anclado a `sifenSubmittedAt`
  (Bug 1 + 3), auto-proxy `@Autowired @Lazy`/`self()` (Bug 2).
- `SifenInvoiceClientIdentificationService.java` — `SIFEN_CLOCK_SKEW_BUFFER` (Bug 1).
- `SifenDocumentSigningService.java` — mensaje de log genérico (Bug 4).

**Tests backend**: `SifenInvoiceSubmissionServiceTest`/`SifenInvoiceCancellationServiceTest`/
`SifenInvoiceClientIdentificationServiceTest` — sin cambios de aserciones, verificados que siguen
pasando (ninguno depende de un valor exacto de timestamp).

**Playwright**: sin cambios — HU-10/HU-11 ya cubren el camino feliz vía el patrón de fabricación
(`prepare-with-status-hours-ago`/`fabricate-cancellation-result`), que sigue siendo la forma correcta
de probar la UI sin depender de una llamada real a SIFEN. Esta sesión fue exclusivamente verificación
manual en vivo del backend real, no un test automatizado nuevo — mismo patrón que la verificación en
vivo de HU-22 (curl manual, documentado en PROGRESS.md, no un test guardado).

## HU-22 — Activar o desactivar la facturación electrónica para un tenant (Done)

Épica EP-07, **Fase 5 — la última fase del plan.** Conecta, por fin, el flujo real de SIFEN
(HU-01..HU-21) con la emisión normal de facturas (`InvoiceService.issueInvoice` /
`InvoiceController.issue`), que hasta esta historia nunca lo invocaba — todo lo que EP-01..EP-06
construyeron sólo se había ejercitado desde tests y desde el controller de soporte de test
(`SifenInvoiceTestSupportController`).

### Diseño: reutilizar el mecanismo genérico de feature flags ya existente

El repo ya tenía un sistema de feature flags genérico (global + override por tenant, `FeatureFlag`/
`TenantFeatureFlag`, `FeatureFlagService`, UI en `FeatureFlagsPage` bajo Configuración → Feature
flags), construido para `GUIDED_TOUR`. En vez de crear un mecanismo nuevo específico de SIFEN, esta
historia:

- Agrega una migración (`V28__sifen_electronic_invoicing_flag.sql`) que siembra el flag
  `SIFEN_ELECTRONIC_INVOICING` (deshabilitado por defecto).
- Reutiliza `FeatureFlagsPage`/`GET /api/admin/feature-flags/tenants/{tenantId}` sin cambios de UI
  nuevos para AC-01/AC-02 — el toggle "aparece solo" porque la página itera sobre cualquier flag que
  exista en la tabla.
- El único código nuevo de enrutamiento real vive en `InvoiceController.issue()` (el único punto de
  entrada de emisión, para ambos caminos): si `featureFlagService.isEnabled("SIFEN_ELECTRONIC_INVOICING", tenantId)`
  es `true`, primero exige un certificado vigente (`SifenCertificateService.requireActiveCertificate`,
  ya construido por HU-21) **antes** de crear la factura — si no hay uno, la petición completa falla
  con `412 SIFEN_NO_VALID_CERTIFICATE` y no se persiste ninguna factura (AC-04). Si hay uno, la
  factura se emite normalmente y, inmediatamente después, se llama a
  `SifenInvoiceSubmissionService.submit(tenantId, invoice.id)` (HU-06) y se retorna el estado
  re-consultado. Si el flag está desactivado, el comportamiento es exactamente el de antes de esta
  historia — "el generador tradicional" no es un código nuevo, es la ausencia total de esta rama
  (AC-03/AC-08).

### AC-05: registro histórico del cambio — mismo patrón "último valor", no una tabla de auditoría completa

Igual que HU-10/HU-11 ya establecieron ("el sistema deja un registro histórico" = una fila que se
sobrescribe en cada intento, nunca una tabla de auditoría creciente — ver "Convenciones establecidas"
al final de este documento), `FeatureFlagService.upsertTenantOverride`/`deleteTenantOverride` ahora
reciben `changedByUserId`/`changedByEmail` y registran el cambio (valor anterior/nuevo resuelto,
quién, cuándo) en una tabla nueva y pequeña, `tenant_feature_flag_changes` (misma migración V28) —
**deliberadamente una tabla separada de `tenant_feature_flags`**, no columnas agregadas a esa tabla:
resetear el override de un tenant a su valor global borra la fila de `tenant_feature_flags`, y si el
registro del cambio viviera ahí también se perdería el rastro de ese mismo reseteo. Genérico para
cualquier flag (no específico de SIFEN) porque el punto de enganche ya es compartido — no tuvo
sentido condicionarlo por nombre de flag.

`TenantFeatureFlagRowResponse` ahora incluye `lastChange` (nullable); `FeatureFlagsPage.tsx` lo
muestra como una línea de texto por fila (`data-testid="feature-flag-history-<flagKey>"`) sólo cuando
existe.

### El bug real que esta historia destapó: `SifenInvoiceSubmissionService` nunca persistía nada

Al probar en vivo el camino feliz (flag activo + certificado vigente + factura real), SIFEN devolvía
(como se espera en `e2e`, con `app.femme.sifen.connection.test-base-url` apuntando al puerto
"discard" `127.0.0.1:9`) el "no responde" documentado por HU-06 AC-05 — pero la factura quedaba con
`sifenSubmissionStatus=null` en vez de `PENDING_VERIFICATION`, a pesar de que el número de control
sí se generaba correctamente. Causa raíz: `submit()` invocaba `prepareForSubmission`/`persistQrData`/
`recordResult` — los tres `@Transactional` — **por auto-invocación** (`this.metodo()` implícito,
dentro de la misma clase). El proxy AOP de Spring que hace real el `@Transactional` sólo intercepta
llamadas que llegan desde **fuera** del bean; una auto-invocación lo saltea por completo, así que
esos tres métodos corrían sin ninguna transacción real — la entidad `Invoice` se recuperaba y
mutaba, pero como el `EntityManager` que la cargó ya había cerrado su contexto de persistencia (el
propio `findByIdAndTenant_Id` de Spring Data JPA abre y cierra su propia transacción corta), esas
mutaciones nunca se sincronizaban a la base de datos. El número de control sí persistía porque
`signingService.signInvoice(...)` es una llamada real entre beans distintos (`SifenDocumentSigningService`),
así que su propio `@Transactional` sí pasaba por el proxy correctamente.

Este bug es preexistente desde HU-06 — nunca se detectó porque **ningún test anterior corrió
`submit()` de una forma que pudiera exponerlo**: los tests unitarios (`SifenInvoiceSubmissionServiceTest`)
usan Mockito puro (sin contexto de Spring, sin proxies, sin problema real de auto-invocación que
importe), y los tests "en vivo" de homologación (HU-12..HU-17) son ellos mismos métodos `@Test`
individuales sin ninguna envoltura transaccional externa que pudiera disimular la ausencia de una
transacción interna. HU-22 es la primera vez que `submit()` corre dentro de un contexto de Spring
real, a través de un controller real, sin ningún atajo de test — exactamente el escenario que
expone el problema.

**Corrección:** se extrajeron `prepareForSubmission`/`persistQrData`/`recordResult`/
`isPendingVerification`/`requirePendingInvoiceControlNumber` (y sus helpers privados) a una clase
nueva, `SifenInvoiceSubmissionPersistenceService` — un bean distinto, así que las llamadas desde
`SifenInvoiceSubmissionService.submit()`/`checkPendingStatus()` ahora sí cruzan un proxy real y sus
`@Transactional` se aplican de verdad. `submit()` sigue sin ser `@Transactional` a nivel de método
(la razón documentada desde HU-06 sigue vigente: la llamada de red a SIFEN puede tardar hasta 30s y
no debe mantener abierta una transacción/conexión de base de datos mientras tanto) — el fix respeta
ese diseño, sólo corrige el mecanismo real por el cual las transacciones cortas alrededor de esa
llamada se ejecutan. Ningún comportamiento público cambió: mismos métodos, misma firma, mismas
aserciones — verificado corriendo `SifenInvoiceSubmissionServiceTest` sin cambios de aserciones (solo
se actualizó cómo se construye `service` en `@BeforeEach`) y las 23 pruebas Playwright existentes de
HU-07/09/10/11 (que dependen indirectamente de esta clase) sin ninguna regresión.

### Verificación en vivo (contra el backend real en perfil `e2e`, no sólo unit tests)

Con el fix aplicado, se reprodujo a mano (vía `curl`, con el backend real corriendo) el camino
completo: activar el flag para el tenant demo, cargar un perfil de negocio con todos los campos
SIFEN exigidos por `SifenInvoiceHeaderService` (RUC, dirección, tipo de contribuyente, actividad
económica, departamento/ciudad — ningún test e2e anterior había necesitado configurar esto), cargar
un certificado válido (mismo endpoint de soporte de test que ya usaba HU-10), y emitir una factura
real. Resultado: `sifenControlNumber` generado, firma real ejecutada, intento de red real contra el
endpoint deliberadamente inalcanzable de `e2e`, y **`sifenSubmissionStatus=PENDING_VERIFICATION`
correctamente persistido** — la primera vez que una factura emitida por el flujo normal de la
aplicación (no un test, no el controller de soporte) atraviesa toda la cadena HU-01..HU-06 de punta
a punta.

### AC-02 (aislamiento entre tenants): fuera de alcance para Playwright, cubierto a nivel unitario

Igual que la desviación ya documentada en HU-18 (AC-07, "un tenant no puede ver certificados de
otro"), este repo no tiene ningún mecanismo para crear un segundo tenant real en tests e2e. AC-02 se
verifica en `FeatureFlagServiceTest` (nuevo caso: cambiar el override del tenant 1 nunca toca al
tenant 2, cuyo `resolveAll` se resuelve de forma completamente independiente).

**Backend**:
- `db/migration/V28__sifen_electronic_invoicing_flag.sql` — siembra el flag global y crea
  `tenant_feature_flag_changes`.
- `bootstrap/FemmeDataInitializer.java` — mismo seed idempotente que ya existía para `GUIDED_TOUR`
  (necesario porque Flyway está deshabilitado en el perfil `e2e`; sólo el `CommandLineRunner` de esta
  clase siembra datos ahí).
- `domain/TenantFeatureFlagChange.java` (nuevo) / `repository/TenantFeatureFlagChangeRepository.java`
  (nuevo).
- `service/FeatureFlagService.java` — `upsertTenantOverride`/`deleteTenantOverride` ahora reciben
  `changedByUserId`/`changedByEmail` y registran el cambio; `listTenantView` incluye `lastChange`.
- `web/dto/TenantFeatureFlagChangeResponse.java` (nuevo); `TenantFeatureFlagRowResponse` extendido.
- `web/FeatureFlagController.java` — pasa `principal.getUserId()`/`principal.getUsername()` a los dos
  métodos de escritura.
- `web/InvoiceController.java` — nueva lógica de enrutamiento en `issue()` (ver diseño arriba);
  inyecta `FeatureFlagService`/`SifenCertificateService`.
- `service/SifenInvoiceSubmissionPersistenceService.java` (nuevo, ver "El bug real" arriba) /
  `service/SifenInvoiceSubmissionService.java` (refactorizado para delegar en la clase nueva, sin
  cambios de comportamiento público).

**Tests backend**: `FeatureFlagServiceTest` (casos nuevos: registra el cambio con valor
anterior/nuevo/usuario, aislamiento entre tenants — AC-02); `SifenInvoiceSubmissionServiceTest`
(sin cambios de aserciones, sólo la construcción del servicio en `@BeforeEach`); suite completa
(`./gradlew test`) y `spotlessCheck` verdes.

**Frontend**: `FeatureFlagsPage.tsx` — línea de "último cambio" por fila cuando existe, con
`data-testid` estable; i18n `femme.featureFlags.lastChange` en ambos locales.
`FeatureFlagsPage.test.tsx` — caso nuevo para el renderizado del historial.

**E2E**: `e2e/tests/sifen-hu-22-activacion-por-tenant.spec.ts` (nuevo) — AC-01 (toggle visible para
system admin), AC-03 (flag desactivado ⇒ factura sin ningún campo SIFEN), AC-04 (flag activado sin
certificado ⇒ `412 SIFEN_NO_VALID_CERTIFICATE`, nada persistido; flag activado con certificado ⇒
factura real llega a `PENDING_VERIFICATION`), AC-06 (desactivar después no toca la factura SIFEN ya
enviada), AC-07 (una factura tradicional emitida con el flag desactivado nunca se vuelve SIFEN al
reactivar), AC-05 (historial visible con email del admin y valores anterior/nuevo), AC-08 (smoke: el
listado de facturas sigue funcionando con el flag activo). Corridas también, sin regresiones, las 23
pruebas Playwright preexistentes de HU-07/09/10/11 (afectadas indirectamente por el fix de
persistencia).

## HU-17 — Probar la consulta de documentos y la generación de comprobantes de todos los tipos (Done)

Épica EP-05, Fase 4. **La última historia de la fase** — converge el trabajo de HU-14 (otros tipos
de documento), HU-15 (envío por lotes) y HU-16 (todos los eventos, y el fix del muro `0160` que hizo
posible que cualquier envío llegue a validación de contenido real). Su AC-05 es, literalmente, el
entregable de todo `EP-05`: un único reporte final que consolida el resultado de HU-12 a HU-17.

### Re-verificación en vivo del bloqueo externo: `dCodRes=1252` sigue vigente

Antes de tocar código, se re-probó en vivo el mismo chequeo que HU-13/14/15/16 ya hicieron al empezar
(correr `SifenHomologationInvoiceSubmissionLiveTest` tal cual, sin cambios): las 5 facturas
"correctas" siguen volviendo `dCodRes=1252 "El RUC del emisor se encuentra inactivo"` — el mismo
límite externo del registro de contribuyentes de SIFEN, sin cambios desde HU-16. Esto confirma que
ningún documento de ninguno de los 5 tipos ha llegado nunca a `Aprobado` real en esta integración
(solo eventos lo lograron, HU-16) — así que AC-01/AC-02/AC-03/AC-04 de esta historia, en su forma más
literal ("sobre documentos aprobados"), siguen bloqueados por el mismo motivo externo, no por un
defecto de código.

### AC-01: `SifenDocumentQueryClient` ya era genérico por tipo de documento — verificado, no asumido

La consigna pedía comprobar, no asumir, si el cliente de consulta (HU-07) necesitaba generalizarse
para los otros 4 tipos. Releyendo su código: `xContenDE` se parsea como un string plano
(`SifenXmlUtils.firstDescendantText(consResponse, "xContenDE")`) sin ninguna suposición sobre su
contenido interno — el propio Javadoc de la clase ya documentaba que el XSD real tipa ese elemento
como `xs:string` opaco, no como XML estructurado. **No hizo falta ningún cambio de comportamiento en
el parsing.** Lo que sí faltaba era el mismo seam que HU-13/HU-15 ya abrieron para sus propios
clientes: un `queryWithClient(HttpClient, String cdc, String logContext)` extraído de
`query(tenantId, cdc, testTrustManagers)`, para que un test en vivo pudiera consultar sin depender de
un tenant/certificado de base de datos. Se aplicó el mismo patrón exacto (`sendWithClient`/
`queryWithClient` package-visible, `query(tenantId, ...)` delegando sin cambiar su comportamiento
público).

### AC-03: `SifenKudePdfService` generalizado a los 5 tipos de documento

A diferencia del cliente de consulta, el generador de KuDE sí estaba atado a la entidad `Invoice`
persistida (`invoice.getIssuedAt()`/`getInvoiceNumber()`/`getSifenQrUrl()`/
`getSifenPublicConsultationUrl()`/`getClient()`) — imposible de reusar tal cual para nota de
crédito/débito/autofactura/nota de remisión, ninguno de los cuales esta peluquería persiste como
`Invoice` (nunca los emite en operación real; existen solo como construcciones en memoria de los
tests de homologación de HU-14/15/16/17). **Se extrajo el núcleo de renderizado (`render`) para
tomar valores planos** (`SifenDocumentType`, `Instant issuedAt`, `documentNumber`, `qrUrl`,
`publicConsultationUrl`, `Client` nullable) en vez de leerlos de un `Invoice` — `buildKudePdf` (el
único punto de entrada de producción, sin cambios de comportamiento) sigue resolviendo esos valores
desde un `Invoice` real igual que antes, siempre con `SifenDocumentType.FACTURA`; el nuevo
`buildHomologationKudePdf` es el punto de entrada que esta historia agrega para los otros 4 tipos,
deliberadamente sin pasar por `requireApprovedInvoice` (no hay ningún `Invoice` en la base de datos
que chequear — alcance de homologación, no una capacidad de producción nueva, tal como aclara la
introducción de `EP-05`).

**El único cambio visual que los 5 tipos necesitan: una leyenda "Tipo de comprobante"** con
`SifenDocumentType.description()` (el literal exacto del catálogo real que HU-14 ya confirmó:
"Factura electrónica", "Nota de crédito electrónica", etc.), agregada como la primera línea del
bloque de timbrado. Se revisó el resto del layout (tabla de ítems, totales, bloque de QR/leyendas,
numeración de páginas) contra el Manual Técnico V150 y contra los propios hallazgos de HU-08 — nada
más exige una estructura de KuDE visiblemente distinta por tipo de documento; el mismo template
alcanza para los 5, con esa única leyenda como diferenciador.

### El reporte de esta historia: canal verificado en vivo para los 5 tipos, aprobación real bloqueada

`SifenHomologationDocumentQueryAndKudeLiveTest` (nuevo, guardado) envía 3 documentos reales de cada
uno de los 5 tipos (más una factura semilla de referencia para nota de crédito/débito, mismo truco de
HU-14/15), y para cada tipo:

- **AC-01 (consulta por CDC):** consulta los 3 CDCs enviados. **Hallazgo confirmado en vivo:** un
  documento rechazado por el `1252` externo nunca llega a existir formalmente en el registro de
  SIFEN — consultarlo devuelve `dCodRes=0420 "Documento No Existe en SIFEN o ha sido Rechazado"`, el
  mismo código que HU-07 ya había documentado para un CDC jamás enviado. Esto es, en sí mismo, una
  prueba real y útil: la salud del canal de consulta (nunca una falla de transporte, siempre una
  respuesta específica e interpretable) se verifica con aserción dura para los 5 tipos — 15
  consultas reales, 15 respuestas interpretables. El contenido completo (`xContenDE`) de un documento
  genuinamente aprobado, y la propia "aprobación" de al menos 3 por tipo, quedan con
  `Assumptions.assumeTrue` (bloqueadas por el `1252`).
- **AC-02/AC-04 (QR):** para 2 de los 3 documentos por tipo, se golpea en vivo la URL pública real de
  consulta (`https://ekuatia.set.gov.py/consultas-test/qr?...`, GET simple sin mTLS, mismo hallazgo
  de HU-09) — **HTTP 200 con la SPA real "Consultas" de SIFEN (marca `consultaspublicasApp`) para
  los 5 tipos, con aserción dura**, y el dominio confirmado como el de ambiente de prueba
  (`consultas-test`, nunca `consultas` de producción) — igual que HU-09 ya estableció, esta vez
  extendido a los otros 4 tipos. El veredicto real de "SIFEN reconoce el documento como válido" lo
  interpreta y renderiza la propia SPA Angular client-side (confirmado por HU-09: la misma URL con
  parámetros deliberadamente inválidos también responde HTTP 200 con el mismo shell) — este sistema
  nunca lo interpreta, por diseño, así que ese veredicto de negocio queda con `Assumptions.assumeTrue`
  además de estar bloqueado por el mismo `1252` (no hay un documento real aprobado que la SPA pueda
  reconocer como válido hoy).
- **AC-03 (KuDE):** se genera el KuDE del primer documento de cada tipo vía
  `buildHomologationKudePdf` — **aserción dura, para los 5 tipos**: el PDF se genera, tiene al menos
  1 página, contiene el CDC agrupado (`SifenKudePdfService.groupControlNumber`) y la leyenda de tipo
  correcta (`SifenDocumentType.description()`). Esto no depende de la aprobación real de SIFEN (es
  renderizado puramente local a partir de datos ya conocidos), así que se afirma sin `assumeTrue` —
  solo la premisa "sobre un documento genuinamente aprobado" queda condicionada al mismo `1252`.

Reporte real (2026-07-28) contra `sifen-test.set.gov.py`, 5 tipos × 3 documentos + 1 semilla = 16
envíos reales, 15 consultas reales, 10 verificaciones de QR reales, 5 KuDE generados:

```
Categoría                                          | Resultado
Envío "aprobado" (16 documentos, los 5 tipos)       | 0/16 — bloqueado por 1252 (externo)
Consulta por CDC — canal (15 consultas)             | 15/15 OK (0420, nunca 0160/timeout)
Consulta — contenido completo (aprobado)            | 0/15 — bloqueado por 1252 (externo)
QR alcanzable + ambiente de prueba (10 chequeos)     | 10/10 OK (HTTP 200, consultas-test)
QR reconocido como válido (aprobado)                | 0/10 — bloqueado por 1252 + veredicto client-side
KuDE generado con CDC y leyenda correctos (5 tipos)  | 5/5 OK
```

### AC-05: el reporte final consolidado de todo EP-05 — construido y corrido en vivo

**Decisión de diseño: extraer el cuerpo de cada `@Test` de HU-12..HU-17 en un método
`run(...)` package-visible que retorna su propio `SifenHomologationReport`,** sin cambiar ningún
comportamiento ni aserción existente (los métodos `@Test` originales siguen llamando a `run(...)` y
haciendo exactamente las mismas aserciones que antes). Esto fue necesario porque
`SifenHomologationReport` (por diseño, desde HU-12) no persiste nada entre clases de test — cada
reporte vive solo mientras dura su propio método de test — así que la única forma de consolidar
resultados **reales**, en vez de transcribir a mano la salida de 6 clases distintas, es que un solo
proceso llame al `run(...)` de cada historia y combine los reportes resultantes con
`SifenHomologationReport.combinedWith` (el seam que HU-12 dejó preparado y que ninguna historia había
usado hasta ahora).

**Nuevo `SifenHomologationFinalReportTest`** hace exactamente eso: carga el `.p12` piloto una sola
vez, construye el material/certificado y ambos `HttpClient` (mTLS y plano), instancia las 6 clases de
test de EP-05 (`SifenHomologationConnectivityLiveTest`, `...InvoiceSubmissionLiveTest`,
`...OtherDocumentTypesLiveTest`, `...BatchSubmissionLiveTest`, `...EventsLiveTest`, y el nuevo
`...DocumentQueryAndKudeLiveTest` de esta misma historia), llama a cada `run(...)`, combina los 6
reportes con `combinedWith`, imprime el reporte único resultante más un resumen por historia
(pasaron/total), y afirma con aserción dura que la consolidación es genuina (las 6 historias
aportaron al menos una fila cada una — nunca se cayó una silenciosamente).

**Nota operativa, documentada explícitamente en el Javadoc de la clase:** correr este test duplica,
por una vez, todo el tráfico real que HU-12..HU-17 ya generan contra el sandbox de SIFEN (~150
peticiones reales más) — deliberado, ya que es la única forma de producir el artefacto único que la
DNIT necesita ver, y hereda sin cambios la misma disciplina de espaciado/reintento
(`PACING_DELAY`/reintento solo ante falla de transporte) que HU-12 estableció para mitigar el
throttling real que esa historia documentó. Como todo test de homologación de Fase 4, solo corre con
el `.p12` piloto presente (gitignored) — nunca en CI ni en un checkout limpio.

**Corrido en vivo (2026-07-28) — el reporte final consolidado real de EP-05:**

```
Historia | Pasaron    | Total
HU-12    | 14         | 14
HU-13    | 5          | 10
HU-14    | 20         | 42
HU-15    | 13         | 39
HU-16    | 14         | 14
HU-17    | 31         | 71
```

Este es el estado real, verificado en vivo el mismo día, de las 6 historias de `EP-05`: **HU-12 y
HU-16 pasan al 100%** (conectividad seguro/rechazado por los 7 servicios; todos los eventos que no
necesitan un DTE previamente aprobado, más el canal de eventos verificado sano para los que sí lo
necesitan). **HU-13, HU-14, HU-15 y HU-17 tienen filas que no pasan — todas ellas, sin excepción,
son el mismo límite externo `dCodRes=1252`** (el envío "correcto" en sí, la consulta de contenido
completo, o el veredicto de validez del QR, todos condicionados a una aprobación real que este
ambiente de SIFEN aún no concede al RUC piloto) — ninguna es un defecto de código abierto en esta
integración. El test asociado a cada una de esas 4 historias ya usa `Assumptions.assumeTrue`
exactamente en esos tramos, así que ninguna falla el build — el número de "Total" en la tabla de
arriba incluye intencionalmente esas filas bloqueadas (para que el reporte sea honesto sobre el
alcance real logrado), no solo las que se afirmaron con aserción dura.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`):
- `SifenDocumentQueryClient.java` — nuevo `queryWithClient(HttpClient, String cdc, String
  logContext)` package-visible, extraído de `query(tenantId, cdc, testTrustManagers)` sin cambiar su
  comportamiento público; sin cambios de parsing (ya era agnóstico al tipo de documento).
- `SifenKudePdfService.java` — `render`/`buildFilename` generalizados a valores planos
  (`SifenDocumentType`, `Instant`, `documentNumber`, `qrUrl`, `publicConsultationUrl`, `Client`
  nullable) en vez de leerlos de un `Invoice`; nueva leyenda "Tipo de comprobante"; nuevo
  `buildHomologationKudePdf` (punto de entrada sin `Invoice`, para los 4 tipos que esta peluquería no
  emite); `buildKudePdf` (producción, sin cambios de comportamiento) sigue resolviendo los mismos
  valores desde un `Invoice` real, siempre con `SifenDocumentType.FACTURA`.

**Tests backend**:
- `SifenDocumentQueryClientTest.java`/`SifenKudePdfServiceTest.java` — sin cambios de aserciones, solo
  verificados que siguen pasando tras la extracción/generalización (ambos pasan sin modificar).
- `SifenHomologationDocumentQueryAndKudeLiveTest.java` (nuevo, guardado) — el reporte real de arriba
  es su salida cuando corre con el `.p12` piloto presente; aserción dura sobre la salud del canal de
  consulta, la alcanzabilidad/dominio del QR, y la generación correcta del KuDE (los 5 tipos);
  `Assumptions.assumeTrue` sobre el tramo "sobre un documento genuinamente aprobado".
- `SifenHomologationConnectivityLiveTest.java`/`...InvoiceSubmissionLiveTest.java`/
  `...OtherDocumentTypesLiveTest.java`/`...BatchSubmissionLiveTest.java`/`...EventsLiveTest.java` —
  cada uno refactorizado para extraer un método `run(...)` package-visible que retorna su
  `SifenHomologationReport` (mismo comportamiento/aserciones que antes, ahora reutilizable); se agregó
  también `SifenHomologationConnectivityLiveTest.loadInvalidKeyStore()` (package-visible) para que el
  reporte final pueda construir el mismo certificado autofirmado de prueba sin duplicar sus
  constantes.
- `SifenHomologationFinalReportTest.java` (nuevo, guardado) — el reporte final consolidado real de
  arriba es su salida; aserción dura sobre que la consolidación incluyó las 6 historias.

**Playwright**: ninguno — mismo patrón que toda historia de `EP-05` (capacidad de servicio/prueba de
homologación sin pantalla propia; la peluquería nunca consulta documentos por CDC ni genera
comprobantes de los otros 4 tipos en operación real, ya cubierta por HU-07/HU-09 y HU-08
respectivamente para factura).

## HU-16 — Probar el registro de todos los eventos exigidos (Done)

Épica EP-05, Fase 4. **La primera oportunidad real de esta integración para diagnosticar a fondo el
muro `dCodRes=0160 "XML mal formado"`** que HU-10 introdujo y documentó exhaustivamente sin resolver,
que HU-11 confirmó era sistémico (no específico de un tipo de evento), y que HU-12 acotó a
validación de contenido, no de conectividad. Esta historia lo diagnostica de raíz, lo corrige, y
construye encima los 6 tipos de evento nuevos que exige AC-02/AC-03.

### El diagnóstico del `0160` — causa raíz encontrada y corregida

**Procedimiento:** se reprodujo el `0160` en vivo con el código real de producción tal cual estaba
(sin cambios), luego se validó el XML exacto que ese código produce contra el XSD real
(`evento.wsdl.xsd1.xsd`, descargado de nuevo con `curl --cert-type P12`) usando `xmllint --schema` —
**el documento validó sin errores**, confirmando lo que HU-10 ya había anotado ("el documento pasa
una validación XSD completa"). Esto significa que el `0160` nunca fue un problema de forma/tipo de
dato — hacía falta otra fuente de verdad. Se descargó el código fuente Java real de dos paquetes
públicos de referencia para Paraguay (`facturacionelectronicapy-xmlsign` de `marcosjara` en npm, la
misma familia de librerías que HU-10 ya había citado como "TIPS-SA" — resultó ser el mismo autor
original bajo un nombre de paquete distinto — y `facturacionelectronicapy-xmlgen`, que sí construye
el sobre completo, no solo la firma). El archivo `SignXMLEvento.java` de `xmlsign` resultó ser
**byte-a-byte idéntico** en su elección de algoritmos (`SignedInfo` exclusivo, transforms
`[enveloped, exclusivo]`, `KeyInfo` solo con `X509Data`) al código que HU-10 ya había escrito después
de su propio cruce con la misma librería — descartando definitivamente la hipótesis de "algoritmo de
firma incorrecto" que HU-10 dejó como sospecha principal sin confirmar.

**La pista real estaba en `jsonEventoMain.service.ts` (el paquete `xmlgen`, que si arma el sobre
completo, no solo la firma):** su método `generateXMLEventoService` construye el JSON del que sale el
XML final con esta estructura exacta —

```ts
this.json['gGroupGesEve'] = {};
this.json['gGroupGesEve']['rGesEve'] = {};
this.json['gGroupGesEve']['$'] = {};
this.json['gGroupGesEve']['$']['xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
this.json['gGroupGesEve']['$']['xsi:schemaLocation'] = '... siRecepEvento_v150.xsd';
```

**`xmlns:xsi`/`xsi:schemaLocation` van en `gGroupGesEve` — no en `rGesEve`.** El código de este
dominio, desde que HU-10 lo escribió, ponía esos dos atributos directamente en `<rGesEve>` (el
elemento raíz del documento que `SifenCancellationEventXmlService`/
`SifenClientIdentificationEventXmlService` construyen por separado, antes de que
`SifenEventClient` lo envuelva en `<gGroupGesEve>` por concatenación de texto) — **un nivel más
profundo de lo debido**. El propio Manual Técnico V150 ya lo decía, sin que ninguna historia anterior
lo notara: su tabla de campos GDE000 (sección 11.5) describe literalmente a `gGroupGesEve` — no a
`rGesEve` — como "Raíz del grupo de eventos" ("root of the events group"); `rGesEve` (GDE001) es
"Elemento raíz" pero **de la Gestión de Eventos dentro de ese grupo**, un nivel más adentro.

**Confirmado en vivo (2026-07-28), con el código real de producción, no un experimento aislado:**
mover esos dos atributos a `<gGroupGesEve>` (ahora agregado por `SifenEventClient#buildEnvelope`, en
vez de por `SifenCancellationEventXmlService`/`SifenClientIdentificationEventXmlService`/
`SifenNumberVoidingEventXmlService`/`SifenReceptorEventXmlService`) cambia la respuesta real de
`dCodRes=0160 "XML mal formado"` a **`dCodRes=4002 "CDC no existente en el SIFEN"`** para el mismo
evento de cancelación exacto que antes fallaba — SIFEN ahora procesa la petición hasta el nivel de
validación de contenido real (existencia del CDC), en vez de rechazarla de entrada. Se validó también
que el `<rEnviEventoDe>` completo (con el fix aplicado) sigue validando limpio contra el XSD real con
`xmllint` — el fix no rompe ninguna otra regla de schema, solo corrige la ubicación real del atributo.

**Esto retroactivamente resuelve la limitación abierta de HU-10 y HU-11.** Ninguna de esas dos
historias necesita reabrirse — su código (`SifenCancellationEventXmlService`,
`SifenClientIdentificationEventXmlService`, `SifenEventClient`) es exactamente el que se corrigió acá,
sin cambios de comportamiento público más allá de esta corrección — pero conviene saber, para
cualquiera que retome esas historias, que su camino feliz ("Aprobado" real) ya no está bloqueado por
este bug de código — solo por el límite externo `1252` descrito abajo. **Nota aparte, encontrada al
revisar el código de HU-10 durante este diagnóstico:** el javadoc que HU-10 dejó en
`SifenDocumentSigningService.signEvent` afirmaba que el cambio a C14N exclusiva para `SignedInfo`
"resolvió el problema en vivo" — pero el propio texto de PROGRESS.md de HU-10 (sección
"Verificación en vivo") documenta lo contrario: que ese cambio **no** alteró el resultado del
diagnóstico. Es decir, el comentario en el código y la bitácora de esa misma historia se
contradecían; esta historia corrige el javadoc para reflejar la causa real (confirmada acá) en vez de
la hipótesis de C14N que nunca se verificó como la causa.

### AC-02 — Anulación de numeración: el primer "Aprobado" real de toda esta integración

**Nuevo `SifenNumberVoidingEventXmlService`** construye `rGeVeInu` ("Inutilización de numeración") —
el único evento de este dominio cuyo elemento base **no** es el CDC (sección 11.5: "se toma como
elemento base al Código de control (CDC), a excepción del evento de Inutilización de número de DE"),
confirmado por el XSD real (`trGeVeInu`: `dNumTim/dEst/dPunExp/dNumIn/dNumFin/iTiDE/mOtEve`, sin
ningún campo `Id`/CDC). Por esto, **AC-02 no depende de que exista un documento previamente
aprobado** — la primera vez que se pudo hacer esa afirmación con evidencia real, no solo teórica.
**Confirmado en vivo (2026-07-28) para los 5 tipos de documento exigidos: los 5 vuelven
`dCodRes=0600 "Evento registrado correctamente"`, con número de protocolo real** — el primer
`Aprobado` genuino que esta integración obtiene de SIFEN desde que empezó (HU-06). No está afectado
por el límite externo `1252` (ver abajo) — es una vía administrativa distinta, no ligada al estado
"activo" del RUC del emisor para efectos de facturación.

### AC-03 — Eventos del receptor: 3 de 4 también se pudieron aprobar en vivo, sin necesitar un DTE real

**Nuevo `SifenReceptorEventXmlService`** construye los 4 eventos que un receptor puede registrar
sobre un DTE recibido (sección 11.5.2): `rGeVeNotRec` (Notificación de Recepción), `rGeVeConf`
(Conformidad, "confirmarla"), `rGeVeDisconf` (Disconformidad, "cuestionarla") y `rGeVeDescon`
(Desconocimiento, "desconocerla") — los 4 comparten el mismo cascarón `<rGesEve><rEve>...
<gGroupTiEvt></rEve><Signature/></rGesEve>` que HU-10 ya estableció, solo cambia qué contiene
`gGroupTiEvt`.

**Hallazgo real, encontrado probando en vivo, no documentado en ninguna fuente previa de esta
integración: Desconocimiento y Notificación de Recepción no exigen que el CDC ya exista en SIFEN —
Conformidad y Disconformidad sí.** Confirmado con 4 envíos reales sobre CDCs sintácticamente válidos
pero jamás enviados como DE real: `rGeVeDescon` y `rGeVeNotRec` volvieron **`Aprobado`
(`dCodRes=0600`)** los dos — un segundo y tercer "Aprobado" genuino, independientes del de AC-02 —
mientras que `rGeVeConf`/`rGeVeDisconf` volvieron rechazados con `dCodRes=4152`/`4202` ("CDC del DTE
es inexistente"), un motivo específico y real, nunca el `0160` genérico. Tiene sentido de negocio:
"no reconozco este documento" o "ya lo recibí" no presuponen que el documento exista formalmente en
SIFEN, mientras que "lo confirmo"/"lo cuestiono" sí presuponen una aprobación previa real que
confirmar o cuestionar.

**Segundo hallazgo real: un segundo evento del mismo tipo sobre el mismo CDC no se trata como
"corrección" — SIFEN lo rechaza como duplicado.** Se probó explícitamente (repetir
Desconocimiento/Notificación de Recepción sobre el mismo CDC): ambos casos vuelven rechazados con
`dCodRes=4251`/`4101` ("CDC del DTE ya cuenta con un evento previo de esta naturaleza"). Esto acota
el mecanismo real de "corrección" (Tabla K del manual, "Correcciones de los eventos del Receptor")
a los 3 eventos que esa tabla nombra explícitamente — Conformidad/Disconformidad/Desconocimiento — y
solo cuando el evento original fue realmente registrado sobre un DTE real, no sobre un CDC sintético
repetido. **"Corregir un evento anterior" (la 5ª acción de AC-03) no es un 5º tipo de XML propio**:
Tabla K documenta que es, literalmente, volver a registrar Conformidad/Disconformidad/Desconocimiento
una segunda vez sobre el mismo CDC ("Solo se puede registrar un evento de corrección sobre cada
evento mencionado") — no hay ningún elemento `rGeVe*Correccion` en el XSD real ni en el manual. Se
intentó en vivo (Disconformidad inmediatamente después de una Conformidad sobre el mismo CDC
sintético, la forma que tomaría una corrección real) y, como es esperable, la validación de
existencia de CDC se aplica antes que cualquier lógica de corrección — mismo `4152`/`4202` que sin
corrección.

**No existe, en ninguna fuente disponible en este repositorio, una "cantidad mínima" explícita para
los eventos de receptor de AC-03** — se buscó explícitamente en el Manual Técnico V150 completo y en
`Especificacion_SIFEN_Peluqueria.md`; ninguno de los dos documenta un número. Ante la ausencia de una
cifra oficial, esta historia registra cada tipo de evento de receptor aprobable de forma
independiente (Desconocimiento, Notificación de Recepción) dos veces cada uno, sobre CDCs distintos —
mismo orden de magnitud que los mínimos ya establecidos por historias anteriores de esta épica.

### AC-01/AC-05 y el resto de AC-03 — el mismo límite externo de HU-13/14/15, reconfirmado

**El `dCodRes=1252 "El RUC del emisor se encuentra inactivo"` que HU-13 documentó sigue vigente
hoy** (reconfirmado en vivo al iniciar esta historia con una factura real vía
`SifenHomologationInvoiceSubmissionLiveTest`) — sigue bloqueando cualquier camino que necesite un DTE
genuinamente aprobado por SIFEN: AC-01 (cancelar 5 documentos previamente aprobados), AC-05 (rechazar
un segundo intento de cancelación sobre un documento ya cancelado) y la mitad de AC-03
(Conformidad/Disconformidad/corrección, que si exigen que el CDC exista). **Con el `0160` resuelto,
lo que sí se pudo verificar en vivo y con aserción dura es que el canal de eventos está sano de punta
a punta para estos casos también**: cancelar dos veces el mismo CDC sintético (nunca aprobado) vuelve
`dCodRes=4002` las dos veces — un motivo específico, consistente, correcto para "CDC no existente",
nunca el `0160` genérico que antes lo enmascaraba todo. El día que el RUC piloto se active, estos
mismos tests deberían empezar a pasar en verde sin ningún cambio de código — igual que HU-13/14/15 ya
dejaron dicho para sus propios `Assumptions.assumeTrue`.

### Decisión: nuevo seam `sendWithClient` en `SifenEventClient`

Igual que HU-13 extrajo `SifenDocumentReceptionClient.sendWithClient(HttpClient, ...)` de
`send(tenantId, ...)`, esta historia hizo lo mismo con `SifenEventClient` — necesario para que el
test de homologación de esta historia (y cualquier live test de eventos futuro) pueda enviar eventos
reales firmados con el `.p12` piloto sin depender de un tenant/certificado en base de datos.
`send(tenantId, xml)` sigue delegando en él sin cambiar su comportamiento público.

### Reporte real (2026-07-28) contra `sifen-test.set.gov.py` con el `.p12` piloto real (RUC
`1137152-8`, timbrado `1137152`)

```
Escenario                                                     | Esperado         | Obtenido                              | Resultado
AC-02 anulación numeración FACTURA                            | APROBADO         | APPROVED (0600)                       | OK
AC-02 anulación numeración AUTOFACTURA                        | APROBADO         | APPROVED (0600)                       | OK
AC-02 anulación numeración NOTA_CREDITO                       | APROBADO         | APPROVED (0600)                       | OK
AC-02 anulación numeración NOTA_DEBITO                        | APROBADO         | APPROVED (0600)                       | OK
AC-02 anulación numeración NOTA_REMISION                      | APROBADO         | APPROVED (0600)                       | OK
AC-01/AC-05 cancelación 1/2 sobre CDC nunca aprobado          | RECHAZADO (4002) | REJECTED (4002: CDC no existente)     | OK
AC-01/AC-05 cancelación 2/2 sobre el mismo CDC                | RECHAZADO (4002) | REJECTED (4002: CDC no existente)     | OK
AC-03 desconocimiento 1/2 ("desconocerla")                    | APROBADO         | APPROVED (0600)                       | OK
AC-03 desconocimiento 2/2 ("desconocerla")                    | APROBADO         | APPROVED (0600)                       | OK
AC-03 notificación de recepción 1/2                           | APROBADO         | APPROVED (0600)                       | OK
AC-03 notificación de recepción 2/2                           | APROBADO         | APPROVED (0600)                       | OK
AC-03 conformidad ("confirmarla")                             | RECHAZADO (4152) | REJECTED (4152: CDC inexistente)      | OK
AC-03 disconformidad ("cuestionarla")                         | RECHAZADO (4202) | REJECTED (4202: CDC inexistente)      | OK
AC-03 corrección de un evento anterior (Tabla K)              | RECHAZADO (4202) | REJECTED (4202: CDC inexistente)      | OK
```

AC-02 (5/5 aprobadas) y la mitad "aprobable sin DTE previo" de AC-03 (desconocimiento/notificación,
2/2 cada uno) pasaron con aserción dura — el hito más importante de esta historia. El canal de
eventos para AC-01/AC-05/el resto de AC-03 pasó también con aserción dura (motivo específico, nunca
`0160`). Lo único que queda pendiente, documentado con `Assumptions.assumeTrue` (aborta, no falla),
es el tramo literal "sobre un DTE genuinamente aprobado" de AC-01/AC-05/Conformidad/Disconformidad/
corrección — bloqueado por el `1252` externo, no por este código. AC-04 (el reporte en sí, con el
resultado de cada evento) se cumple por construcción — es el propio reporte de arriba.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`):

- `SifenCancellationEventXmlService.java`/`SifenClientIdentificationEventXmlService.java` — ya no
  ponen `xmlns:xsi`/`xsi:schemaLocation` en `<rGesEve>` (el fix del `0160`).
- `SifenEventClient.java` — `buildEnvelope` ahora agrega esos 2 atributos a `<gGroupGesEve>`; nuevo
  `sendWithClient(HttpClient, String, String logContext)` (paquete-visible), extraído de
  `send(tenantId, ...)` sin cambiar su comportamiento público, mismo seam que
  `SifenDocumentReceptionClient` ya tenía desde HU-13.
- `SifenNumberVoidingEventXmlService.java` (nuevo, `@Service`) — construye `rGeVeInu` (AC-02),
  reutiliza `SifenDocumentType` (HU-14) para `iTiDE` y el mismo `pad(...)` de `dNumTim`/`dEst`/
  `dPunExp` que `SifenDocumentXmlService.buildStampGroup` ya usa para el DE.
- `SifenReceptorEventXmlService.java` (nuevo, `@Service`) — construye los 4 eventos de receptor
  (AC-03): `buildReceptionNotification`/`buildConformity`/`buildDisconformity`/`buildDisavowal`, más
  los tipos `ReceiverIdentity`/`ReceiverTaxpayerStatus`/`ConformityType`.

**Tests backend**:

- `SifenNumberVoidingEventXmlServiceTest.java` (nuevo, 5 casos) — estructura `rGesEve` sin `Id`/CDC,
  mapeo de los 5 tipos de documento, rango inválido, motivo corto, nunca emite
  `xsi:schemaLocation`.
- `SifenReceptorEventXmlServiceTest.java` (nuevo, 12 casos) — estructura de los 4 eventos, receptor
  contribuyente/no-contribuyente, conformidad total/parcial (con su validación), motivo corto,
  CDC en blanco para los 4, nunca emite `xsi:schemaLocation`.
- `SifenEventClientTest.java` — actualizado el caso que verifica la forma del sobre SOAP enviado
  para reflejar `xmlns:xsi`/`xsi:schemaLocation` en `gGroupGesEve` (antes en `rGesEve`); el resto
  sin cambios de comportamiento.
- `SifenHomologationEventsLiveTest.java` (nuevo, guardado, mismo patrón que HU-12..15) — el reporte
  real de arriba es su salida cuando corre con el `.p12` piloto presente; aserción dura sobre AC-02
  completo, sobre la salud del canal para AC-01/AC-05/resto de AC-03, y sobre
  desconocimiento/notificación de AC-03; `Assumptions.assumeTrue` solo sobre el tramo que
  literalmente exige un DTE ya aprobado.
- Se usaron probes descartables (`ThrowawayEventProbeTest`, borrado antes de este commit) para
  aislar el diagnóstico del `0160` y confirmar en vivo cada hallazgo antes de fijar las aserciones
  finales del test guardado — mismo patrón que HU-13 estableció para su propio diagnóstico de reloj.

**Playwright**: ninguno — mismo patrón que HU-12/13/14/15 (capacidad de servicio/prueba de
homologación sin pantalla propia; la peluquería nunca registra estos eventos en operación real, solo
cancelación e identificación de cliente, ya cubiertas por HU-10/HU-11).

## HU-15 — Probar el envío por lotes de todos los tipos de comprobante (Done)

Épica EP-05, Fase 4, "Frente B" (paralelo a HU-14/HU-16, converge en HU-17). Introduce el **Web
Service asíncrono de envío por lotes** (`SiRecepLoteDE`) — nunca usado hasta esta historia; las 9
historias anteriores de envío (HU-06, HU-13, HU-14) usaron siempre el envío inmediato síncrono
(`SiRecepDE`). Reutiliza sin cambios `SifenDocumentXmlService`/`SifenDocumentSigningService`/
`SifenDocumentType`/`SifenDocumentTypeExtras` de HU-04/HU-13/HU-14 — el trabajo real de esta historia
es el protocolo de lote en sí (armar/comprimir/enviar, y consultar el resultado asíncrono más tarde).

**Investigación — protocolo real confirmado en vivo, no inferido del manual.** Se descargó el
WSDL/XSD real de ambos servicios con el mismo procedimiento `curl --cert-type P12` que las historias
anteriores establecieron (`.../de/ws/async/recibe-lote.wsdl(.xsd1.xsd)` y `.../de/ws/consultas/
consulta-lote.wsdl(.xsd1.xsd)`, 2026-07-28). A diferencia de casi toda historia anterior de esta
integración, **esta vez el manual (Manual Técnico V150, secciones 9.2/9.3/12.3.2/12.3.3) coincide casi
exactamente con el XSD real** — un caso más raro en esta integración:

- Envío (`SiRecepLoteDE`): request raíz `rEnvioLote` (`dId` + `xDE`, este último `xs:base64Binary`
  con `expectedContentTypes="application/zip"`); respuesta raíz `rResEnviLoteDe` (`dFecProc`/
  `dCodRes`/`dMsgRes`/`dProtConsLote`/`dTpoProces`, todos `minOccurs="0"`) — coincide con los Schema
  XML 5/6 del manual.
- `xDE` (Schema XML 5A, `ProtProcesLoteDE_v150.xsd`): una raíz `rLoteDE` que envuelve de 1 a 50 hijos
  `rDE` — exactamente los mismos documentos `<rDE>...</rDE>` firmados que HU-04/HU-13/HU-14 ya
  producen para envío inmediato, concatenados dentro de `rLoteDE`, comprimidos en `.zip` y luego
  codificados en Base64 (`SifenBatchReceptionClient.buildCompressedLotePayload`).
- Consulta (`SiResultLoteDE`): request raíz `rEnviConsLoteDe` (`dId` + `dProtConsLote`); respuesta
  raíz `rResEnviConsLoteDe` (`dFecProc`/`dCodResLot`/`dMsgResLot`/`gResProcLote[0..50]`, cada uno con
  `id` (CDC)/`dEstRes`/`dProtAut`/`gResProc[1..5]`) — coincide con los Schema XML 7/8.

**Hallazgo 1 — el "tiempo mínimo recomendado" que pide AC-01 es un campo real de la propia
respuesta, no una constante fija del manual.** Se buscó explícitamente en el manual (secciones 9.2/
9.3/12.3.2/12.3.3 completas) un número fijo de espera recomendada — no existe ninguno. Se
cross-verificó también el SDK público `TIPS-SA/facturacionelectronicapy-setapi` (misma familia de
SDKs que HU-08/10/11/14 ya usaron para contrastar hallazgos): su `consultaLote()` no impone ningún
intervalo fijo tampoco, deja el polling completamente a cargo de quien lo llama. En cambio, la propia
respuesta de `SiRecepLoteDE` incluye `dTpoProces` ("Tiempo medio de procesamiento en segundos") — una
estimación dinámica, calculada por SIFEN, específica de ese lote — **la decisión de diseño de esta
historia es usar ese valor como el "tiempo mínimo recomendado antes de consultar" de AC-01**, en vez
de inventar una constante, ya que es la única fuente real y autoritativa que existe. Confirmado en
vivo: en este ambiente de prueba (poca carga), `dTpoProces` vino siempre en `0` — por eso
`SifenHomologationBatchSubmissionLiveTest` usa un piso de 5 segundos (`MIN_POLL_WAIT_SECONDS`) cuando
SIFEN reporta `0`, pero preferiría el valor real si SIFEN alguna vez reporta algo mayor.

**Hallazgo 2 — el tipo local `tiTiDE`/`tdDesTiDE` embebido en el XSD real de `recibe-lote` es una
copia desactualizada e inerte, no una restricción real.** Una primera lectura del XSD real
descargado (`recibe-lote.wsdl.xsd1.xsd`) mostró que su propia copia local de estos tipos comunes
restringe `iTiDE` al patrón `"1|[5-6]"` y la enumeración de `tdDesTiDE` a solo 3 valores (Factura/
Nota de crédito/Nota de débito) — **sin Autofactura ni Nota de remisión**, a diferencia del
`DE_Types_v150.xsd` de producción que HU-14 usó (`"1|[4-7]|9|10"`, los 5 tipos). Esto sugería que el
servicio de lote podría rechazar Autofactura/Nota de remisión por completo. **Una prueba real en
vivo descartó esa hipótesis**: los 5 tipos, incluidas Autofactura y Nota de remisión, fueron
aceptados (`dCodRes=0300`) y concluidos (`dCodResLot=0362`) igual que Factura — el tipo local
resultó ser una copia obsoleta del bloque de "tipos comunes" que cada XSD de este dominio arrastra
(el propio `rEnvioLote`/`rResEnviLoteDe` no lo referencian: `xDE` es `xs:base64Binary` opaco), nunca
actualizada cuando la NT extendió el catálogo a 5 tipos — un hallazgo de "manual/schema vs.
comportamiento real" más, en la línea de los que HU-06/HU-07/HU-10/HU-11/HU-13/HU-14 ya documentaron,
pero esta vez resuelto a favor de "sí funciona" en vez de "hay que corregir código".

**Hallazgo 3 (AC-04/AC-05) — una divergencia real manual-vs-vivo: `dCodRes=0363` llega en el `ack`
síncrono, no solo al consultar.** La Tabla B104 del manual (sección 12.3.3.3) documenta
`dCodResLot=0363` ("Lotes con tipos distintos de DE") únicamente bajo `SiResultLoteDE` (el paso de
consulta asíncrona) — sugiriendo que un lote inválido se encolaría primero y se rechazaría recién al
consultar. **Confirmado en vivo: el propio `ack` síncrono de `SiRecepLoteDE` ya devuelve
`dCodRes=0363`**, con `accepted=false` y sin que el lote llegue a encolarse (`dProtConsLote` vino
ausente en el caso de mezcla de tipos, y como el string literal `"0"` en el caso de mezcla de
emisor — por eso `SifenBatchSubmissionResult.accepted()`, no la forma de `batchNumber`, es la señal
confiable). Esto satisface "rechazado antes de ser procesado" (AC-04/AC-05) de la forma más literal
posible — nunca hace falta ni siquiera consultar. El mismo código se reutiliza para ambas
violaciones de "un lote debe contener solo un mismo tipo de DE" (sección 9.2.2, que también implica
un mismo emisor, ya que todo el lote se autentica con un solo certificado mTLS) — el texto del
mensaje sí distingue dinámicamente la causa: `"Lotes con tipos distintos de DE"` para AC-05 (mezcla
de tipos), y `"Lotes con tipos distintos de DE emisor [<ruc>]"` (nombrando el RUC ofensor) para AC-04
(mezcla de emisor).

**El mismo límite externo de HU-13/HU-14 sigue afectando esta historia: RUC piloto "inactivo",
`dCodRes=1252`.** Confirmado en vivo para los 5 tipos enviados por lote — igual que por envío
inmediato. AC-01/AC-02 ("correctas aprobadas") se verifican con `Assumptions.assumeTrue`, igual que
HU-13/HU-14.

**Reporte real (2026-07-28) contra `sifen-test.set.gov.py` con el `.p12` piloto real (RUC
`1137152-8`, timbrado `1137152`):**

```
Escenario                                                        | Esperado                | Obtenido                | Resultado
FACTURA lote correcto — envío (5 documentos)                     | ACCEPTED                | ACCEPTED (0300)         | OK
FACTURA correcta 1..5/5 — consulta                               | APROBADO                | REJECTED (1252)         | FALLO (bloqueo externo)
NOTA_CREDITO lote correcto — envío (5 documentos)                 | ACCEPTED                | ACCEPTED (0300)         | OK
NOTA_CREDITO correcta 1..5/5 — consulta                           | APROBADO                | REJECTED (1252)         | FALLO (bloqueo externo)
NOTA_DEBITO lote correcto — envío (5 documentos)                  | ACCEPTED                | ACCEPTED (0300)         | OK
NOTA_DEBITO correcta 1..5/5 — consulta                            | APROBADO                | REJECTED (1252)         | FALLO (bloqueo externo)
AUTOFACTURA lote correcto — envío (5 documentos)                  | ACCEPTED                | ACCEPTED (0300)         | OK
AUTOFACTURA correcta 1..5/5 — consulta                            | APROBADO                | REJECTED (1252)         | FALLO (bloqueo externo)
NOTA_REMISION lote correcto — envío (5 documentos)                | ACCEPTED                | ACCEPTED (0300)         | OK
NOTA_REMISION correcta 1..5/5 — consulta                          | APROBADO                | REJECTED (1252)         | FALLO (bloqueo externo)
lote factura incorrecto — envío (5 documentos)                    | ACCEPTED                | ACCEPTED (0300)         | OK
incorrecta 1/5 (RUC receptor malformado)                          | RECHAZADO               | REJECTED (0160)         | OK
incorrecta 2/5 (descripción de ítem vacía)                        | RECHAZADO               | REJECTED (0160)         | OK
incorrecta 3/5 (fecha de emisión fuera de rango)                  | RECHAZADO               | REJECTED (1103)         | OK
incorrecta 4/5 (total no coincide con la suma de ítems)           | RECHAZADO               | REJECTED (1252, enmascarado) | OK
incorrecta 5/5 (código de unidad de medida inexistente)           | RECHAZADO               | REJECTED (0160)         | OK
lote con mezcla de emisores (4 RUC piloto + 1 distinto)           | RECHAZADO (antes de procesar) | REJECTED (0363, emisor [80000005]) | OK
lote con mezcla de tipos (4 factura + 1 nota de crédito)          | RECHAZADO (antes de procesar) | REJECTED (0363)         | OK
```

AC-03 (5/5 incorrectas rechazadas con motivo identificable — la 4ª queda enmascarada por el mismo
`1252` antes de que SIFEN llegue a validar la aritmética, igual que HU-13/HU-14) y AC-04/AC-05 (lotes
mezclados rechazados antes de procesar) pasaron con aserción dura. AC-01/AC-02 (correctas aprobadas,
los 5 tipos) quedan pendientes de que SIFEN active el RUC piloto — el test se aborta explícitamente,
no falla.

**Decisión: dos clientes nuevos, mismo patrón que los de envío/consulta inmediatos.**
`SifenBatchReceptionClient` (envío) y `SifenBatchResultQueryClient` (consulta) siguen exactamente la
forma de `SifenDocumentReceptionClient`/`SifenDocumentQueryClient`: parsing defensivo por nombre
local de elemento (sin asumir un anidamiento fijo, misma filosofía que el Javadoc de HU-06
estableció), un overload `sendWithClient`/`queryWithClient` paquete-visible que recibe un
`HttpClient` ya armado (mismo seam que HU-12/HU-13 abrieron), y `Optional.empty()` — nunca una
excepción — ante cualquier falla de transporte o respuesta no interpretable.

**Decisión: test guardado (no descartable), mismo patrón que HU-12/HU-13/HU-14.**
`SifenHomologationBatchSubmissionLiveTest` extiende `SifenHomologationReport`, se salta con
`Assumptions.assumeTrue` cuando el `.p12`/contraseña piloto no están presentes, y aplica la misma
pauta de espaciado (`PACING_DELAY`, 700ms) y reintentos solo ante falla de transporte que HU-12
estableció. Un probe descartable (`ThrowawayBatchProbeTest`, borrado antes de este commit) se usó
primero para confirmar en vivo los Hallazgos 1-3 antes de fijar las aserciones finales del test
guardado.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`):
- `SifenBatchReceptionClient.java` (nuevo, `@Service`) — envía un lote (`send`/`sendWithClient`);
  `buildCompressedLotePayload` (paquete-visible) arma `rLoteDE` + zip + Base64.
- `SifenBatchResultQueryClient.java` (nuevo, `@Service`) — consulta el resultado de un lote
  (`query`/`queryWithClient`).
- `SifenBatchSubmissionResult.java`/`SifenBatchQueryResult.java`/`SifenBatchDocumentResult.java`
  (nuevos, records) — ver Javadoc de cada uno para el mapeo de `dCodRes`/`dCodResLot`.

**Tests backend**:
- `SifenBatchReceptionClientTest.java` (nuevo, 6 casos) — zip/Base64 roundtrip sin servidor, y contra
  un `HttpsServer` local: aceptado con `dProtConsLote`/`dTpoProces`, rechazado (0301) sin número de
  lote, sin respuesta (transporte/no parseable), forma del sobre SOAP enviado.
- `SifenBatchResultQueryClientTest.java` (nuevo, 7 casos) — en procesamiento (0361), concluido con
  documentos aprobado/rechazado (0362, incluye unión de mensajes de `gResProc`), rechazo de lote
  completo por tipos distintos (0363, sin documentos), sin respuesta, forma del sobre SOAP enviado.
- `SifenHomologationBatchSubmissionLiveTest.java` (nuevo, guardado) — el reporte real de arriba es su
  salida cuando corre con el `.p12` piloto presente; aserción dura sobre AC-03/AC-04/AC-05,
  `Assumptions.assumeTrue` sobre AC-01/AC-02.

**Playwright**: ninguno — mismo patrón que HU-01/03/04/05/06/09/12/13/14 (capacidad de
servicio/prueba de homologación sin pantalla propia; la peluquería nunca usa envío por lotes en
operación real).

## HU-14 — Probar el envío inmediato de los demás tipos de comprobante exigidos (Done)

Épica EP-05, Fase 4. Extiende directamente la infraestructura que HU-13 acaba de afinar
(`SifenDocumentXmlService`/`SifenDocumentSigningService`/`SifenDocumentReceptionClient`) a los 4
tipos de documento adicionales que la homologación de la DNIT exige, aunque esta peluquería nunca
los emita en operación real: nota de crédito, nota de débito, autofactura y nota de remisión.

**Investigación — `iTiDE` (C002) confirmado contra el catálogo real, no adivinado.** El mismo XSD de
producción que HU-13 descargó sin autenticación (`https://ekuatia.set.gov.py/sifen/xsd/
DE_Types_v150.xsd`, 2026-07-28) publica `tiTiDE` (patrón `"1|[4-7]|9|10"`) y `tdDesTiDE` (la
enumeración de descripciones, en el mismo orden): **1=Factura electrónica, 4=Autofactura electrónica,
5=Nota de crédito electrónica, 6=Nota de débito electrónica, 7=Nota de remisión electrónica** (más
9/10, boleta de venta/resimple, fuera del alcance de esta historia). Confirma exactamente la hipótesis
de partida de esta historia. Se descargó también `DE_v150.xsd` completo para mapear la estructura
real de cada grupo nuevo: `gCamNCDE` (motivo de nota de crédito/débito, dentro de `gDtipDE`),
`gCamDEAsoc` (documento asociado, a nivel de `<DE>`, hermano de `gTotSub` — la referencia real que
AC-03 exige), `gCamAE` (datos del proveedor de una autofactura, dentro de `gDtipDE`), y
`gCamNRE`+`gTransp` (motivo de traslado + datos de transporte de una nota de remisión, ambos dentro
de `gDtipDE`) — el grupo E10 "transporte" que la propia nota de HU-04 había dejado explícitamente
fuera de alcance ("no aplica a una venta al contado de una peluquería") es, correctamente, la primera
vez que este dominio lo necesita.

**Diseño: `SifenDocumentXmlService` se extiende por rama, no se duplica 4 veces.** Un nuevo
`SifenDocumentType` (enum, `sifenCode()`/`description()` con los literales exactos del catálogo real)
reemplaza el `"Factura electrónica"` hardcodeado de `buildStampGroup`. Un nuevo
`SifenDocumentTypeExtras` (record con como máximo un campo no nulo: `creditDebitNote`/
`autoInvoiceProvider`/`goodsRemission`) se enhebra a través de un nuevo overload de `buildDocument`
(el de 4 argumentos existente delega en el de 5 con `SifenDocumentTypeExtras.NONE`, cero cambios de
comportamiento para las 21 llamadas existentes de HU-04..HU-13) — cada grupo nuevo se agrega
condicionalmente, respetando el orden exacto de secuencia que exige el XSD real (`gCamFE` → `gCamAE`
→ `gCamNCDE` → `gCamNRE` → `gCamCond` → `gCamItem`* → `gTransp`, y `gCamDEAsoc` al final, hermano de
`gTotSub`). Todo lo demás (header/emisor/receptor/ítems/totales/firma/QR) se comparte sin cambios
entre los 5 tipos que esta clase construye.

**Decisión de diseño — receptor de una autofactura: el emisor se autofactura a sí mismo.** A
diferencia de una factura normal, el "receptor" real de una autofactura es el propio emisor (compra
un servicio a alguien —no contribuyente o extranjero— que no puede emitir su propio comprobante); el
vendedor real se describe por separado en `gCamAE` (`SifenAutoInvoiceProviderData`, nuevo). Esto no
exigió ningún cambio en `buildReceiver` — es una decisión de qué datos arma el llamador, documentada
en el javadoc de `SifenAutoInvoiceProviderData`. Alcance deliberadamente mínimo: `dDirProv`/
`cDepProv`/`cCiuProv` ("lugar donde se realizó la operación", obligatorios en el XSD real) reusan la
misma dirección del proveedor — este dominio no modela un "lugar de la operación" distinto.

**Decisión de diseño — nota de remisión, alcance mínimo del grupo de transporte.** `gCamSal`/
`gCamEnt` (local de salida/entrega de mercaderías) y el resto de `gTransp` (manifiesto, vehículo,
transportista) son opcionales en el propio XSD (`minOccurs="0"`) — se omiten, solo se emiten los
campos que el schema real exige sin ese atributo: `gCamNRE` completo (`iMotEmiNR`/`dDesMotEmiNR`/
`iRespEmiNR`/`dDesRespEmiNR`/`dKmR`) y `gTransp`'s `iModTrans`/`dDesModTrans`/`iRespFlete`. La
verificación en vivo (ver abajo) confirmó que esto alcanza — ninguna de las 10 respuestas reales de
este tipo menciona un campo faltante de `gCamSal`/`gCamEnt`/resto de `gTransp`.

**AC-03 (nota de crédito/débito referencian una factura previamente aprobada):** cada corrida de
esta historia envía primero una factura electrónica real (`sendSeedInvoiceForReference`) y usa su CDC
resultante como `gCamDEAsoc/dCdCDERef` para las 10 notas (5 correctas + 5 incorrectas) de ese tipo —
una referencia real, efectivamente enviada, no fabricada. Si esa factura semilla llega a estar
realmente "Aprobada" por SIFEN depende del mismo límite externo de abajo (Hallazgo 3) — el punto de
AC-03 es que la referencia sea real y consistente, no relitigar ese estado externo.

**Verificación en vivo (2026-07-28), 44 documentos reales contra `sifen-test.set.gov.py` con el `.p12`
piloto real: encontró y cerró 2 gaps de schema/contenido nuevos, propios de esta historia**, con el
mismo patrón iterativo que HU-13 (un hallazgo destapa el siguiente):

**Hallazgo 1 — `gOpeCom` (D1, grupo entero) no está permitido en una nota de remisión.** La primera
corrida completa (con el modelo de arriba, reusando `gOpeCom` sin condición, igual que factura)
rechazó las 5 notas de remisión "correctas" con `dCodRes=1201 "Grupo de informaciones inherentes a
la operación comercial no es permitido para el tipo de documento"` — ni el manual ni el XSD (que
marca todo el grupo y cada uno de sus hijos `minOccurs="0"`) lo descartaban de antemano; es una regla
de negocio, no de schema. Tiene sentido: un movimiento de bienes no es una operación comercial con
impuesto/moneda propios. Corregido: `buildGeneralDataGroup` omite `gOpeCom` por completo cuando
`documentType == NOTA_REMISION`.

**Hallazgo 2 — `gOpeCom/iTipTra` (tipo de transacción) no está permitido en nota de crédito/débito,
pero el resto del grupo sí.** Con el Hallazgo 1 corregido, las notas de crédito/débito "correctas"
seguían siendo rechazadas, ahora con `dCodRes=1216 "Tipo de transacción no requerido para el tipo de
documento electrónico seleccionado"` — un mensaje que nombra específicamente `iTipTra`, no todo el
grupo. Tiene sentido: la nota ajusta una factura ya emitida que ya tiene su propio tipo de
transacción; repetirlo en la nota es redundante. Corregido: `buildGeneralDataGroup` sigue emitiendo
`iTImp`/`dDesTImp`/`cMoneOpe`/`dDesMoneOpe` para NC/ND, pero omite `iTipTra`/`dDesTipTra`.

**Verificación de ambos fixes:** una segunda corrida completa de los 44 documentos confirma que
ninguna de las 44 respuestas reales menciona ya `1201` ni `1216` — las 5 notas de crédito, 5 de
débito y 5 de remisión "correctas" llegan ahora al mismo único obstáculo que la factura de HU-13, ver
Hallazgo 3 abajo (autofactura ya llegaba ahí desde la primera corrida, sin necesitar ningún fix — su
`gOpeCom` completo, incluyendo `iTipTra`, es válido tal cual, confirmando que sí representa una
operación comercial propia).

**Hallazgo 3, el mismo muro externo que HU-13 documentó: persiste igual para los 4 tipos nuevos.**
Con los 2 gaps de arriba cerrados, las 20 "correctas" (5 por tipo) y la factura semilla de referencia
llegan, sin excepción, a `dCodRes=1252 "El RUC del emisor se encuentra inactivo"` — el mismo estado
externo del registro de contribuyentes de SIFEN que HU-13 documentó, no un defecto de este código.
Confirma que el bloqueo no es específico de factura electrónica: afecta a los 5 tipos por igual. Igual
que HU-13, **AC-01 (correctas aprobadas) se verifica con `Assumptions.assumeTrue`**, no con aserción
dura — el test se aborta, no falla, mientras este estado externo persista.

**AC-02 (incorrectas rechazadas con motivo identificable), 20/20 (5 por tipo), aserción dura, pasó en
la corrida real.** Las primeras 4 de cada tipo reusan los mismos 4 escenarios que HU-13 ya probó
(RUC receptor malformado → `0160`; descripción de ítem vacía → `0160`; fecha de emisión 45 días atrás,
antes de `dFeIniT` del timbrado → `1103`; total que no coincide con la suma de ítems → enmascarado
por el mismo `1252` externo, igual que en HU-13, ver Hallazgo 3). La 5ª es específica de cada tipo
nuevo, elegida para ejercitar el propio grupo que esta historia agrega, no solo el andamiaje de
factura debajo: `iMotEmi=9` (fuera del rango `1-8`) para NC/ND → `0160 "iMotEmi es invalido"`;
`iNatVen=3` (fuera del rango `1-2`) para autofactura → `0160 "iNatVen es invalido"`; `iModTrans=5`
(fuera de la enumeración `1-4`) para nota de remisión → `0160 "iModTrans es invalido"` — los 3
confirmados en vivo.

**Reporte real (2026-07-28), 44 documentos enviados por envío inmediato contra
`sifen-test.set.gov.py` con el `.p12` piloto real (RUC `1137152-8`, timbrado `1137152`), después de
cerrar los 2 gaps de arriba:**

```
Tipo           | Correctas aprobadas      | Incorrectas rechazadas
NOTA_CREDITO   | 0/5                      | 5/5
NOTA_DEBITO    | 0/5                      | 5/5
AUTOFACTURA    | 0/5                      | 5/5
NOTA_REMISION  | 0/5                      | 5/5
```

(Más 2 facturas semilla de referencia para AC-03, también `REJECTED 1252`, igual que las 20
"correctas".) AC-04 (este mismo reporte consolidado por tipo) se cumple por construcción —
`renderPerTypeSummary` en el propio test. AC-01 queda pendiente de que SIFEN active el RUC piloto,
igual que HU-13 — el test se aborta explícitamente por esto, no falla.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`):
- `SifenDocumentType.java` (nuevo, enum) — `FACTURA(1)`/`AUTOFACTURA(4)`/`NOTA_CREDITO(5)`/
  `NOTA_DEBITO(6)`/`NOTA_REMISION(7)`, con la descripción literal exacta del catálogo real.
- `SifenCreditDebitNoteData.java`/`SifenAutoInvoiceProviderData.java`/`SifenGoodsRemissionData.java`
  (nuevos, records) — los campos propios de cada tipo, ver "Investigación"/"Decisión de diseño"
  arriba.
- `SifenDocumentTypeExtras.java` (nuevo, record) — enhebra como máximo uno de los 3 records de arriba
  a través de `buildDocument`; `NONE` para factura.
- `SifenDocumentXmlService.java` — nuevo overload de 5 argumentos de `buildDocument` (el de 4 delega
  sin cambios); `buildStampGroup` usa `SifenDocumentType.fromCode(...).description()` en vez del
  literal hardcodeado; `buildGeneralDataGroup` omite `gOpeCom`/`iTipTra` condicionalmente (Hallazgos
  1/2); `buildItemsAndTotals` agrega `gCamAE`/`gCamNCDE`/`gCamNRE`/`gTransp` condicionalmente, en el
  orden de secuencia real; nuevo `buildAssociatedDocumentGroup` (`gCamDEAsoc`, AC-03).

**Tests backend**:
- `SifenDocumentXmlServiceTest` — 9 casos nuevos: `iTiDE`/`dDesTiDE` correctos para los 4 tipos,
  `gCamNCDE`+`gCamDEAsoc` para nota de crédito y de débito, `gCamAE` para autofactura, `gCamNRE`+
  `gTransp` para nota de remisión, omisión de `gCamCond` en remisión, omisión de `iTipTra` en NC/ND
  (Hallazgo 2), omisión de `gOpeCom` completo en remisión (Hallazgo 1), y que una factura simple nunca
  emite ninguno de los grupos nuevos. 22 casos totales en este archivo, todos pasando.
- `SifenHomologationOtherDocumentTypesLiveTest.java` (nuevo, guardado, mismo patrón que HU-12/HU-13)
  — el propio reporte de 44 documentos de arriba es su salida real cuando corre con el `.p12` piloto
  presente; aserción dura sobre AC-02, `Assumptions.assumeTrue` sobre AC-01 (Hallazgo 3).

**Playwright**: ninguno — mismo patrón que HU-01/03/04/05/06/09/12/13 (capacidad de servicio/prueba
de homologación sin pantalla propia; esta historia es explícitamente solo de homologación, la
peluquería nunca emite estos 4 tipos en operación real).

## HU-13 — Probar el envío inmediato de facturas correctas e incorrectas (Done)

Épica EP-05, Fase 4. Reutiliza directamente la infraestructura de la Fase 1
(`SifenDocumentXmlService`/`SifenDocumentSigningService`/`SifenDocumentReceptionClient`) sobre la
base de conectividad que HU-12 dejó probada. El trabajo real de esta historia terminó siendo, sobre
todo, **cerrar los 3 gaps de compliance de schema que HU-04/HU-06/HU-08 documentaron y pospusieron
explícitamente a esta fase** — ver "Estado" arriba y las entradas de HU-06/HU-08 más abajo — y, una
vez cerrados esos 3, seguir la cadena de hallazgos reales que se destaparon detrás.

**Investigación — nueva vía para obtener el XSD real de producción, sin `curl --cert-type P12`.**
Todas las historias anteriores (HU-04/05/06/07/08/10/11/12) obtuvieron el WSDL/XSD real posteando
contra `sifen-test.set.gov.py` con el `.p12` piloto. Para esta historia se encontró una vía más
simple y más autoritativa: los XSD de producción están publicados sin autenticación en
`https://ekuatia.set.gov.py/sifen/xsd/{DE_v150,DE_Types_v150,Unidades_Medida_v141,Monedas_v150}.xsd`
(HTTP 200 sin certificado de cliente). Se descargaron los 4 y se los usó como fuente de verdad
directa — más confiable que inferir del manual o de SDKs de terceros, aunque estos últimos
(`abiliomp/ekuat-ia`, un repositorio público que compila exactamente este tipo de divergencias
manual-vs-XSD-real, y `TIPS-SA/facturacionelectronicapy-xmlgen`/`roshkadev/rshk-jsifenlib`) sirvieron
para confirmar cada hallazgo de forma independiente antes de tocar el código.

**Gap 1 — `dFeFinT` (C009): el campo fue eliminado en v150, nunca hay que emitirlo.** El manual
(sección "Tabla de formato de campos", tabla C) todavía lo documenta como obligatorio 1-1, pero el
XSD real (`DE_v150.xsd`, línea 49) lo tiene literalmente comentado:
`<!-- <xs:element name="dFeFinT" type="tFecAAAAMMDDguion"/> -->` — solo quedan `dSerieNum`/`dFeIniT`
en la secuencia de `gTimb`. El repositorio `abiliomp/ekuat-ia` documenta la misma eliminación con su
propia justificación: el timbrado dejó de tener fecha de fin de vigencia en v150, reemplazada por el
mecanismo de series de dos letras (AA, AB, ... ZZ) para la continuidad de numeración. Corregido:
`SifenDocumentXmlService.buildStampGroup` ya no emite `dFeFinT` en absoluto.
`SifenInvoiceHeader.stampValidUntil` se conserva en el dominio (sigue usándose en el KuDE, un
documento renderizado localmente, no validado por el schema de SIFEN) — solo el DE deja de emitirlo.

**Gap 2 — `dDesUniMed` (E710): debe ser la abreviatura del catálogo ("UNI"), no el texto libre
"Unidad".** Confirmado en el propio ejemplo del manual (E710, "Ejemplo: UNI") y en la Tabla 5
("Código 77 | Representación UNI | Descripción Unidad") — el propio `cUniMed` de este dominio ya era
"77" desde HU-03, pero `dDesUniMed` se armaba con la descripción larga en vez de la representación.
Confirmado también contra el catálogo real (`Unidades_Medida_v141.xsd`, `tdDesUniMed`): es una
enumeración cerrada cuyo literal para el código 77 es exactamente `"UNI"`. Corregido en
`SifenDocumentXmlService.buildItem`.

**Gap 3 — `dBasExe` (E737) falta dentro de `gCamIVA`: agregado por NT-013, ya no es opcional.** El
manual de 2019 no tiene este campo en absoluto (mismo patrón de desactualización que HU-10/HU-11 ya
encontraron para el catálogo de eventos) — lo agregó la Nota Técnica 13 después de esa edición. El
XSD real (`DE_v150.xsd`, `tgCamIVA`) lo tiene como último hijo de la secuencia, **sin
`minOccurs="0"`**: es obligatorio siempre, con `0` cuando la línea no es "gravado parcial". Fórmula
real (NT-013, confirmada contra `roshkadev/rshk-jsifenlib` y `abiliomp/ekuat-ia`): para `iAfecIVA=4`
(Gravado parcial), `dBasExe = [100 * dTotOpeItem * (100 - dPropIVA)] / [10000 + (dTasaIVA *
dPropIVA)]`; para cualquier otro valor de `iAfecIVA`, `dBasExe = 0`. Este dominio nunca produce
líneas "gravado parcial" hoy (`SifenTaxAffectation` javadoc: `taxProportion` siempre 100), así que en
la práctica siempre emite `0` — la fórmula completa se agregó de todos modos (`SifenDocumentXmlService
.exemptBase`) y se probó con un caso sintético, para no dejar una rama sin verificar si esa
limitación de dominio cambia en el futuro.

**Verificación en vivo de los 3 gaps (2026-07-28): los 3 mensajes de error documentados por
HU-06/HU-08 desaparecieron por completo de las 10 respuestas reales de esta historia** (ver reporte
completo más abajo) — ninguna de las 10 facturas reales enviadas menciona ya `dFeFinT`, `dDesUniMed`
ni `dBasExe`.

**Hallazgo 4 (no pedido por esta historia, encontrado al enviar en vivo tras cerrar los 3 gaps
anteriores): `dDesMoneOpe`/`dDMoneTiPag` = "Guaraní" (con tilde) es rechazado, "Guarani" (sin tilde)
no.** Con los 3 gaps de arriba cerrados, el primer envío real completo fue rechazado igual, ahora con
`dCodRes=1206 "Descripción de la moneda de la operación no corresponde al código"` — una validación
de contenido (no de schema/XSD) que compara el texto libre contra el catálogo real de monedas. El
catálogo real (`Monedas_v150.xsd`, enumeración `cMondT`, anotación `<CodeName>` para `PYG`) documenta
literalmente `Guarani`, sin tilde — SIFEN exige ese literal exacto, no la ortografía correcta del
español. Corregido en los 2 lugares donde `SifenDocumentXmlService` emitía "Guaraní"
(`dDesMoneOpe` en D1, `dDMoneTiPag` en E7.1) — confirmado en vivo que el `1206` desaparece.
**Aprovechando la misma investigación, se corrigió también `dDesAfecIVA` para `EXONERADO`/
`GRAVADO_PARCIAL`** (no alcanzables hoy por este dominio, ver `SifenTaxAffectation` javadoc, pero
mismo tipo de divergencia manual-vs-XSD): el XSD real (`DE_Types_v150.xsd`, `tdDesAfecIVA`) exige
`"Exonerado (Art. 100 - Ley 6380/2019)"` (el manual de 2019 todavía dice "Art. 83- Ley 125/91",
desactualizado por la NT-010) y `"Gravado parcial (Grav- Exento)"` (con un espacio después del guion
que el código no tenía).

**Hallazgo 5 (ambiental, no es un bug de código): el reloj de este sandbox corre unos minutos
adelantado respecto al reloj real de `sifen-test.set.gov.py`.** Tras cerrar los 4 hallazgos
anteriores, el envío seguía siendo rechazado, ahora con `dCodRes=1004 "La fecha y hora de la firma
digital es adelantada"` (A004a) — SIFEN exige que `dFecFirma` no sea posterior a su propio reloj.
Un diagnóstico dedicado (`ThrowawayClockSkewProbeTest`, borrado antes de este commit) envió el mismo
documento válido con `dFecFirma` corrida hacia atrás en distintos incrementos: con 0 minutos de ajuste
sigue apareciendo el `1004`; con apenas **1 minuto** de margen ya desaparece (confirmado
consistentemente hasta -12 minutos, sin ningún otro efecto colateral). Esto no es un defecto de
`SifenDocumentSigningService` (que sigue firmando con "ahora" real, comportamiento correcto para
producción) — es una característica de *este* sandbox, cuyo reloj de sistema no está perfectamente
sincronizado con el reloj real de SIFEN. El test guardado de esta historia
(`SifenHomologationInvoiceSubmissionLiveTest`) aplica un margen de seguridad de 2 minutos **solo
dentro del propio test**, documentado explícitamente como una particularidad de este entorno, nunca
como un cambio de comportamiento de producción. **Nota operativa real para producción:** el servidor
donde corra el Azure Container App real debe mantener su reloj sincronizado por NTP — Azure ya lo
hace a nivel de host, así que se espera que este hallazgo sea específico de este sandbox de
desarrollo y no de la infraestructura real desplegada, pero queda documentado acá por si vuelve a
aparecer.

**Hallazgo 6, el muro real que impide un "Aprobado" genuino hoy: el RUC piloto figura "inactivo" en
el registro de SIFEN — `dCodRes=1252 "El RUC del emisor se encuentra inactivo"`.** Con los 5
hallazgos anteriores resueltos, las 5 facturas "correctas" de esta historia llegaron, por primera vez
en toda esta integración, a una respuesta real que **no menciona ningún problema de contenido ni de
schema** — el único motivo de rechazo es este. No es un bug de este código: es un estado externo del
registro de contribuyentes de SIFEN, fuera del control de este repositorio. Es plausible que se deba
a que la "Fecha de inicio de vigencia" del timbrado piloto (27/07/2026, según "Configuración del
ambiente de pruebas") es literalmente el día anterior a esta verificación (2026-07-28) y todavía no
terminó de propagarse en los sistemas de SIFEN — o que requiera un paso de habilitación adicional del
lado de la SET/DNIT. **Decisión de diseño: por esto, AC-01 (facturas correctas aprobadas) se verifica
con `Assumptions.assumeTrue`, no con una aserción dura** — el test se aborta (no falla) mientras este
estado externo persista, con un mensaje que apunta explícitamente a esta sección para que nadie lo
confunda con una regresión de código; en el momento en que SIFEN active el RUC, este mismo test
empieza a pasar en verde sin ningún cambio de código. **AC-02 (facturas incorrectas rechazadas con un
motivo identificable) no depende de este estado externo y se verifica con una aserción dura**, que sí
pasó en la corrida real documentada abajo.

**Decisión: test guardado (no descartable), mismo patrón que HU-12.** El propio propósito de esta
historia (AC-04, reporte reproducible) justifica que quede en la suite permanente en vez de un
throwaway — `SifenHomologationInvoiceSubmissionLiveTest` extiende `SifenHomologationReport` (HU-12),
se salta con `Assumptions.assumeTrue` cuando el `.p12`/contraseña piloto no están presentes, y aplica
la misma pauta de espaciado (`PACING_DELAY`, 700ms) que HU-12 estableció contra el mismo límite de
tasa del gateway de prueba de SIFEN, con hasta 3 reintentos solo ante una falla de transporte
(nunca ante una respuesta HTTP real, aunque no coincida con lo esperado).

**Decisión: nuevo seam en `SifenDocumentReceptionClient` para enviar sin depender de un tenant/BD.**
`send(tenantId, xml)` resolvía el `HttpClient` mTLS vía `SifenConnectionService.buildAuthenticatedClient
(tenantId)`, que exige un tenant/certificado reales en base de datos — inviable para un test JUnit
puro sin contexto Spring. Se extrajo `sendWithClient(HttpClient, xml, logContext)` (paquete-visible),
que recibe el `HttpClient` ya armado y hace exactamente lo mismo que `send()` hacía internamente
(arma el sobre SOAP, postea, parsea la respuesta) — `send(tenantId, xml)` ahora delega en él sin
cambiar su comportamiento público. El test arma el `HttpClient` directamente con
`SifenConnectionService.buildMutualTlsClient(KeyStore, String, TrustManager[])`, el mismo overload
paquete-visible que HU-12 ya había abierto para el mismo motivo (homologación no depende de ningún
tenant de esta app).

**Decisión: se extrajo `SifenPilotCertificateTestSupport` de `SifenHomologationConnectivityLiveTest`
(HU-12).** Antes vivía inline en el test de HU-12; con un segundo test de homologación necesitando
exactamente la misma lógica (encontrar el `.p12`/contraseña piloto gitignorados, cargar el
`KeyStore`), se extrajo a una clase compartida sin cambiar el comportamiento del test de HU-12
(mismos casos, mismo resultado).

**Reporte real (2026-07-28), 10 facturas enviadas por envío inmediato contra
`sifen-test.set.gov.py` con el `.p12` piloto real (RUC `1137152-8`, timbrado `1137152`):**

```
Historia | Escenario                                               | Esperado   | Obtenido   | Resultado
HU-13    | correcta 1/5 — CDC ...279822...                         | APROBADO   | REJECTED (1252: TEST - El RUC del emisor se encuentra inactivo) | FALLO
HU-13    | correcta 2/5 — CDC ...279922...                         | APROBADO   | REJECTED (1252: TEST - El RUC del emisor se encuentra inactivo) | FALLO
HU-13    | correcta 3/5 — CDC ...280022...                         | APROBADO   | REJECTED (1252: TEST - El RUC del emisor se encuentra inactivo) | FALLO
HU-13    | correcta 4/5 — CDC ...280122...                         | APROBADO   | REJECTED (1252: TEST - El RUC del emisor se encuentra inactivo) | FALLO
HU-13    | correcta 5/5 — CDC ...280222...                         | APROBADO   | REJECTED (1252: TEST - El RUC del emisor se encuentra inactivo) | FALLO
HU-13    | incorrecta 1/5 (RUC receptor malformado)                | RECHAZADO  | REJECTED (0160: XML malformado [El valor 12 del elemento: dRucRec es invalido]) | OK
HU-13    | incorrecta 2/5 (descripción de ítem vacía)               | RECHAZADO  | REJECTED (0160: XML malformado [El valor  del elemento: dDesProSer es invalido]) | OK
HU-13    | incorrecta 3/5 (fecha de emisión fuera de rango)         | RECHAZADO  | REJECTED (1103: TEST - El número de timbrado no se encuentra vigente a la fecha de emisión del comprobante) | OK
HU-13    | incorrecta 4/5 (total no coincide con la suma de ítems)  | RECHAZADO  | REJECTED (1252: TEST - El RUC del emisor se encuentra inactivo) | OK
HU-13    | incorrecta 5/5 (código de unidad de medida inexistente)  | RECHAZADO  | REJECTED (0160: XML malformado [El valor 999 del elemento: cUniMed es invalido]) | OK
```

**Ninguna fila menciona ya `dFeFinT`, `dDesUniMed`, `dBasExe`, `Guaraní` ni `1004`** — los 4 gaps de
schema/contenido cerrados por esta historia se confirman ausentes en las 10 respuestas reales. AC-02
(5/5, motivo identificable y distinto para 4 de los 5 — el escenario 4, "total incorrecto", quedó
enmascarado por el mismo bloqueo externo de RUC antes de que SIFEN llegara a validar la consistencia
aritmética, ver Hallazgo 6) pasó con aserción dura. AC-01 (5/5) queda pendiente de que SIFEN active el
RUC piloto — el test se aborta explícitamente por esto, no falla. AC-03 (CDC distinto por factura,
nunca reusado) y AC-04 (este mismo reporte) se cumplen por construcción. AC-05 (fallar explícitamente
ante una correcta rechazada o una incorrecta aprobada) está implementado literalmente: hoy fallaría en
la mitad "correctas" si no fuera por el `Assumptions.assumeTrue` documentado en el Hallazgo 6 — la
intención de la historia (que el sistema *note* el problema en vez de reportar un falso éxito) se
cumple igual, solo que como "aborted" en vez de "failed" para no confundir un límite externo con una
regresión real de código.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`):
- `SifenDocumentXmlService.java` — `buildStampGroup` ya no emite `dFeFinT` (Gap 1); `buildItem` emite
  `dDesUniMed="UNI"` en vez de `"Unidad"` (Gap 2) y agrega `dBasExe` al final de `gCamIVA` vía el
  método nuevo `exemptBase` (Gap 3, fórmula NT-013); `dDesMoneOpe`/`dDMoneTiPag` usan `"Guarani"` sin
  tilde (Hallazgo 4); `taxAffectationDescription` corregido para `EXONERADO`/`GRAVADO_PARCIAL`
  (mismo hallazgo, bonus).
- `SifenDocumentReceptionClient.java` — nuevo método paquete-visible `sendWithClient(HttpClient,
  String, String logContext)`, extraído de `send(tenantId, ...)` sin cambiar su comportamiento
  público — permite enviar sin resolver un tenant/certificado vía base de datos.

**Tests backend** (todos corren siempre en CI salvo los guardados con `Assumptions.assumeTrue`):
- `SifenDocumentXmlServiceTest` — 4 casos nuevos: `dFeFinT` nunca se emite (`dFeIniT` sí),
  `dDesUniMed`/`cUniMed` mapean a `"UNI"`/`"77"`, `dBasExe="0"` para una línea no gravado-parcial,
  `dBasExe` calculado correctamente (fórmula NT-013) para una línea gravado-parcial sintética
  (incluye también el literal correcto de `dDesAfecIVA` para ese caso). 21 casos totales, todos
  pasando.
- `SifenPilotCertificateTestSupport.java` (nuevo, sin tests propios — extraído sin cambiar
  comportamiento, cubierto transitivamente por `SifenHomologationConnectivityLiveTest`).
- `SifenHomologationInvoiceSubmissionLiveTest.java` (nuevo, guardado) — el propio reporte de 10 filas
  de arriba es su salida real cuando corre con el `.p12` piloto presente; aserción dura sobre AC-02,
  `Assumptions.assumeTrue` sobre AC-01 (ver Hallazgo 6).

**Playwright**: ninguno — mismo patrón que HU-01/03/04/05/06/09/12 (capacidad de servicio/prueba de
homologación sin pantalla propia).

## HU-12 — Probar la conexión segura contra todos los servicios de SIFEN (Done)

Épica EP-05. **Primer paso de Fase 4** (Homologación ante la DNIT) — a diferencia de toda historia
anterior, esta épica entera es "pruebas automatizadas que demuestran ante la DNIT que el sistema
cumple", no una funcionalidad de cara al negocio: el deliverable **es** la prueba y su reporte, no
una pantalla ni un endpoint. Primera vez en esta integración que una verificación en vivo se diseñó
para quedar en la suite permanente en vez de ser un test descartable (`ThrowawayLiveSifenHuNN`,
patrón usado por HU-05/06/07/09/10/11) — ver "Decisión: test guardado, no descartable" abajo.

**Investigación (Manual Técnico V150.pdf, sección 7.10 "Resumen de las Direcciones Electrónicas..." +
verificación en vivo, 2026-07-28):** la tabla del manual publica 6 URLs de WSDL para el ambiente de
prueba (no 7): `sync/recibe.wsd?wsdl` (con la misma errata ya documentada por HU-05, falta la "l"),
`async/recibe-lote.wsdl?wsdl`, `eventos/evento.wsdl?wsdl`, `consultas/consulta.wsdl?wsdl`,
`consultas/consulta-lote.wsdl?wsdl`, `consultas/consulta-ruc.wsdl?wsdl`. Los 3 nuevos para esta
historia (envío por lotes, consulta de resultado de lotes, consulta de contribuyentes) se verificaron
en vivo con el mismo procedimiento `curl --cert-type P12` que HU-05/06/07/10/11 ya establecieron:
**los 3 responden HTTP 200 con un WSDL real en el path exacto que publica el manual, sin ninguna
errata esta vez** (a diferencia del único typo ya conocido de `recibe.wsd`), y el `soap12:address` de
cada WSDL real confirma que el endpoint real para conectarse es esa misma URL **sin** el query string
`?wsdl` — mismo patrón que todos los servicios anteriores.

**Hallazgo (resuelve la ambigüedad de AC-01 entre "consulta de facturas" y "consulta de
documentos"): son el mismo servicio, no dos.** AC-01 nombra 7 servicios, pero la sección 8 del
manual ("Aspectos Tecnológicos de los Servicios Web del SIFEN") solo lista **un** servicio síncrono
de consulta, "Consulta DE" (`SiConsDE`) — la propia tabla del manual (dos párrafos arriba) coincide:
6 URLs, no 7. La sección 8 sí menciona "Consulta DE destinados (Futuro)" y "Consulta DTE a entidades
u organismos externos autorizados (a Futuro)" como servicios **todavía no implementados** en este
ambiente — ninguno es la segunda "consulta de documentos" que buscaba AC-01. Se documentó
explícitamente en el Javadoc de `SifenHomologationEndpoint` en vez de inventar un endpoint que SIFEN
no expone: `INVOICE_QUERY` y `DOCUMENT_QUERY` apuntan al mismo path real
(`/de/ws/consultas/consulta.wsdl?wsdl`), y ambos se verifican igual — AC-01 queda satisfecho
literalmente (los 7 ítems nombrados se prueban) sin fingir una conectividad que no existe.

**Hallazgo operativo (investigación explícita pedida por esta historia): el `0160` de HU-10/HU-11 es
un rechazo de contenido, no de conectividad — confirmado, no solo inferido.** HU-10/HU-11 dejaron
documentado que todo envío real de un evento firmado contra `eventos/evento.wsdl` devuelve HTTP 200
con `dCodRes=0160 "XML mal formado"`, sin resolver la causa. La pregunta de esta historia era si ese
mismo muro podría estar afectando la *conexión* en sí (lo que haría ver un falso rechazo de
conectividad en el reporte de homologación). La respuesta, confirmada por este mismo reporte: no —
`EVENT_REGISTRATION` con el certificado piloto real se conecta y es **aceptado** (HTTP 200 al pedir
el WSDL, igual que los otros 6). El `0160` ocurre un paso más adelante, cuando SIFEN ya aceptó la
conexión mTLS y está procesando el *contenido* del sobre SOAP que se le envía — una capa de
validación completamente distinta a la que HU-12 mide (que solo pregunta "¿la conexión con este
certificado es aceptada por este servicio, sí o no?"). En otras palabras: el 0160 nunca fue, y no es,
un problema de homologación de conectividad (HU-12) — sigue siendo, exclusivamente, un problema de
contenido/firma de eventos (alcance de HU-10/HU-11/futuro HU-16).

**Decisión: `SifenServiceConnectivityChecker` es genérico y no requiere un tenant.** A diferencia de
`SifenConnectionService.connect(tenantId)` (HU-05), que resuelve el certificado activo de un tenant
vía `SifenCertificateService.requireActiveCertificate` y valida que su RUC coincida con
`BusinessProfile.ruc` antes de conectar, la homologación necesita ejercitar el mismo chequeo mTLS con
**dos certificados sin relación con ningún tenant real** (el `.p12` piloto real y un fixture
autofirmado) — forzar esto a través del mecanismo de "certificado activo por tenant" habría exigido
crear un tenant/certificado en base de datos solo para esta prueba, sin necesidad real. Se refactorizó
`SifenConnectionService.buildMutualTlsClient(SifenActiveCertificateMaterial, TrustManager[])`
(privado) para delegar en un overload nuevo, paquete-visible,
`buildMutualTlsClient(KeyStore, String password, TrustManager[])` — mismo código de siempre (TLS 1.2,
`KeyManagerFactory` con la identidad del certificado dado), ahora reutilizable sin pasar por el
sistema de certificado-activo-por-tenant. `SifenServiceConnectivityChecker.check(endpoint, keyStore,
password, expected)` es la única lógica nueva: arma el cliente mTLS con ese `KeyStore`, hace `GET` al
WSDL del `SifenHomologationEndpoint` dado, y clasifica `200`→`ACCEPTED`/cualquier otra cosa (incluida
una excepción de red/TLS)→`REJECTED` — la misma regla de clasificación que HU-05 ya verificó en vivo
(el gateway F5 de SIFEN completa el handshake TLS igual y responde `302 → /vdesk/hangup.php3` en vez
de cortar a nivel TLS).

**Decisión: `SifenHomologationReport` es un acumulador genérico, no específico de conectividad —
sienta la base que HU-17 AC-05 va a necesitar.** Fila = historia + escenario en texto libre +
esperado/obtenido/aprobado; un método `render()` (AC-04, tabla de texto de ancho fijo) y
`combinedWith(...)` (semilla para que HU-17 pueda concatenar el reporte de cada historia de esta fase
en uno solo, sin que ninguna de las dos partes necesite conocer la estructura interna de la otra).
Deliberadamente mínimo: sin persistencia, sin endpoint HTTP — vive solo durante la ejecución de un
test JUnit que después imprime `render()` y afirma sobre `allPassed()`.

**Decisión: test guardado (no descartable), con paso a paso encontrado durante la verificación en
vivo que casi produce un falso negativo.** A diferencia de HU-05/06/07/09/10/11 (verificación real
hecha con un test descartable, borrado antes del commit, porque el `.p12` real nunca está en un
checkout limpio ni en CI), el propio propósito de esta historia (AC-04, y el mandato de EP-05 de
"demostrar ante la DNIT") es un reporte real reproducible — se decidió que sí vale la pena que quede
en la suite permanente como test JUnit normal, no un throwaway. `Assumptions.assumeTrue` lo salta
("aborted", no "failed") cuando el `.p12`/contraseña piloto no están presentes localmente — nunca se
ejecuta en CI ni en un checkout limpio, mismo motivo de siempre. **Hallazgo real durante la primera
corrida: los 14 intentos de conexión (7 servicios × 2 certificados) disparados en menos de 2 segundos
producen `IOException: HTTP/1.1 header parser received no bytes` en varios de ellos** — nunca una
respuesta HTTP real (`200`/`302`), y el patrón de qué intentos fallaban no era determinístico (fallaba
un intento, el siguiente contra el mismo servicio funcionaba). Se confirmó con `curl` manual, con y
sin pausas entre pedidos, que **la misma petición exacta que falla disparada justo después de una
docena de otras funciona instantáneamente en cuanto tiene lugar para respirar** — esto es limitación
de conexiones del lado del gateway de prueba de SIFEN (probablemente un límite de tasa), no un
rechazo de certificado. `SifenHomologationConnectivityLiveTest` agrega una pausa de 500ms entre cada
intento real y hasta 3 reintentos, **pero solo cuando el resultado fue una excepción de transporte
(`httpStatus=-1`), nunca cuando ya hay una respuesta HTTP real** (incluso una que no coincide con lo
esperado) — evita que una limitación de infraestructura ajena se confunda con un verdadero fallo de
AC-02/AC-03, sin enmascarar nunca un mismatch genuino.

**Verificación en vivo (2026-07-28), reporte completo de los 7 servicios nombrados por AC-01 (14
filas: cada uno con certificado válido —el `.p12` piloto real, RUC `1137152-8`— y con certificado
inválido —el fixture autofirmado `sifen/test-cert.p12` del repo, sin RUC ni PSC habilitada—) contra el
`sifen-test.set.gov.py` real:**

```
Historia | Escenario                                                | Esperado | Obtenido           | Resultado
HU-12    | Envío inmediato (SiRecepDE) — certificado válido         | ACCEPTED | ACCEPTED (HTTP 200) | OK
HU-12    | Envío inmediato (SiRecepDE) — certificado inválido       | REJECTED | REJECTED (HTTP 302) | OK
HU-12    | Envío por lotes (SiRecepLoteDE) — certificado válido     | ACCEPTED | ACCEPTED (HTTP 200) | OK
HU-12    | Envío por lotes (SiRecepLoteDE) — certificado inválido   | REJECTED | REJECTED (HTTP 302) | OK
HU-12    | Consulta de facturas (SiConsDE) — certificado válido     | ACCEPTED | ACCEPTED (HTTP 200) | OK
HU-12    | Consulta de facturas (SiConsDE) — certificado inválido   | REJECTED | REJECTED (HTTP 302) | OK
HU-12    | Consulta de resultado de lotes (SiResultLoteDE) — válido | ACCEPTED | ACCEPTED (HTTP 200) | OK
HU-12    | Consulta de resultado de lotes (SiResultLoteDE) — inválido | REJECTED | REJECTED (HTTP 302) | OK
HU-12    | Consulta de documentos (SiConsDE) — certificado válido   | ACCEPTED | ACCEPTED (HTTP 200) | OK
HU-12    | Consulta de documentos (SiConsDE) — certificado inválido | REJECTED | REJECTED (HTTP 302) | OK
HU-12    | Registro de eventos (SiRecepEvento) — certificado válido | ACCEPTED | ACCEPTED (HTTP 200) | OK
HU-12    | Registro de eventos (SiRecepEvento) — certificado inválido | REJECTED | REJECTED (HTTP 302) | OK
HU-12    | Consulta de contribuyentes (SiConsRUC) — certificado válido | ACCEPTED | ACCEPTED (HTTP 200) | OK
HU-12    | Consulta de contribuyentes (SiConsRUC) — certificado inválido | REJECTED | REJECTED (HTTP 302) | OK
```

**14/14 OK** — AC-01 (los 7 servicios nombrados, sobre 6 endpoints reales distintos), AC-02
(certificado válido siempre aceptado), AC-03 (certificado inválido siempre rechazado con el mismo
`302 → /vdesk/hangup.php3` que HU-05 ya documentó) y AC-04 (este mismo reporte) quedan verificados en
vivo, de punta a punta, contra el ambiente real de prueba.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`):
- `SifenHomologationEndpoint.java` (nuevo, enum) — los 7 servicios nombrados por AC-01 con su path de
  WSDL real; `INVOICE_QUERY`/`DOCUMENT_QUERY` comparten path a propósito (ver hallazgo arriba).
- `SifenServiceConnectivityChecker.java` (nuevo, `@Service`) — `check(endpoint, keyStore, password,
  expected)` (AC-02/AC-03), clasifica `200`→`ACCEPTED`/lo demás→`REJECTED`, reusa
  `SifenConnectionService.buildMutualTlsClient` (ver overload nuevo abajo). `CheckResult` (record)
  expone `matchesExpectation()`.
- `SifenConnectionService.java` — el `buildMutualTlsClient(SifenActiveCertificateMaterial,
  TrustManager[])` privado ahora delega en un overload nuevo paquete-visible
  `buildMutualTlsClient(KeyStore, String, TrustManager[])`, sin cambiar ningún comportamiento
  existente (mismos tests de HU-05 sin tocar, todos siguen pasando).
- `SifenHomologationReport.java` (nuevo) — acumulador de filas (historia/escenario/esperado/
  obtenido/aprobado) + `render()` (AC-04) + `combinedWith(...)` (semilla para el reporte consolidado
  de HU-17 AC-05).

**Tests backend**:
- `SifenServiceConnectivityCheckerTest` (siempre corre en CI, 21 casos = 7 servicios × 3 escenarios
  parametrizados con `@EnumSource`): acepta con servidor mock respondiendo 200, rechaza con el mismo
  302→hangup verificado en vivo, rechaza cuando el servidor es inalcanzable — mismo patrón
  `HttpsServer` local que `SifenConnectionServiceTest` (HU-05) ya estableció.
- `SifenHomologationReportTest` (5 casos): orden de inserción, `allPassed` true/false, `render`
  incluye cada fila con su resultado OK/FALLO, `combinedWith` no muta los reportes originales.
- `SifenHomologationConnectivityLiveTest` (guardado, ver "Decisión" arriba) — el propio reporte de 14
  filas de arriba es su salida real cuando corre con el `.p12` piloto presente.

## HU-11 — Identificar al cliente en una factura emitida sin sus datos (Done)

Épica EP-04. **Cierra Fase 3** (la segunda y última interacción de eventos de esta fase). Registra
un evento llamado en la práctica "Evento de Nominación" contra un DTE ya aprobado emitido a
consumidor final, para identificarlo después sin necesidad de cancelar y reemitir.

**Investigación (Manual Técnico V150): esta vez el manual no dice nada en absoluto, ni siquiera algo
que contradecir.** El capítulo 11 (Tabla J, "Resumen de los eventos de SIFEN según los actores")
tiene exactamente 8 filas numeradas: 1 (Cancelación), 2 (Inutilización), 10 (Notificación de
recepción), 11 (Conformidad), 12 (Disconformidad), 13 (Desconocimiento), 14 (Devolución y Ajuste de
precios, automático), 16 (Asociación, automático) — **nada en las filas 3-9, 15, 17+.** Se confirmó
que esto no es un artefacto de extracción de `pdftotext -layout` (a diferencia de lo que se esperaba
por precedente de HU-01/HU-10): se renderizaron como imagen (`pdftoppm`) las dos páginas completas de
la Tabla J y se confirmó visualmente que esas filas simplemente no existen en esta edición del
manual (Septiembre 2019) — números reservados para una versión futura, no una omisión de extracción.
Ningún otro capítulo del documento (búsqueda de "consumidor final", "Sin Nombre", "nominaci",
"actualización de datos") menciona este evento tampoco.

**El evento sí existe: se encontró primero por una fuente pública, luego se confirmó en vivo contra
el XSD real de SIFEN.** Una búsqueda web (`gosocket.net`, sobre una Nota Técnica de la SET; y
`facturasend.com.py`, un proveedor de facturación electrónica paraguayo) confirmó que SIFEN sí tiene,
en la práctica, un "Evento de Nominación" — para asociar el receptor real de un DTE emitido
inicialmente sin nombre —, aunque ninguna fuente pública publicaba su XML exacto. Se repitió
entonces el procedimiento de HU-10: se descargó el WSDL/XSD real del servicio de eventos con
`curl --cert-type P12` (`.../de/ws/eventos/evento.wsdl.xsd1.xsd`, 2026-07-28) y se comparó contra el
`tgGroupEvt` (el `xs:choice` que decide el tipo de evento dentro de `<rEve>`): **el XSD real en vivo
tiene 12 opciones, no las 8 del manual de 2019** — agrega `rGEveNom` (nominación, el que esta
historia necesita), `rGeVeConAutPre`, `rGeVeAjuSal`, `rGeVeCamCliExt` (específico de exportación,
"Cambio de Cliente del Exterior" — no es el mismo evento que esta historia necesita, a pesar del
nombre parecido: siempre exige país+dirección+RUC/documento tributario extranjero, sin distinguir
persona/empresa) y `rGeVeTipExtDeu`. Es la primera vez en esta integración que el propio manual está
completamente desactualizado respecto al catálogo de eventos vivo, no solo respecto al detalle de un
campo — un nivel de divergencia más allá de lo que HU-07/HU-10 ya habían encontrado.

**Estructura real de `rGEveNom` (confirmada por el XSD real, no por ninguna fuente pública):**
`Id` (el CDC), `mOtEve` (motivo, 5-500 caracteres — igual que `rGeVeCan`, generado automáticamente
por este sistema ya que ningún AC le pide al usuario un motivo), `iNatRec` (1=tiene RUC/2=no, igual
criterio que `SifenDocumentXmlService.buildReceiver`), **`iTiOpe`** (documentado en el propio XSD
real como *"Tipo de operacion: 1(B2B), 2(B2C), 4(B2F)"* — el campo clave de esta historia: sin
código para "empresa extranjera" ni "persona extranjera" por separado, un receptor del exterior
siempre es `4` sin importar si es persona o empresa), `cPaisRec`/`dDesPaisRe` (siempre obligatorios,
a diferencia del DE donde están hardcodeados a Paraguay — acá si `iTiOpe=4` viene de una lista real
de 249 países ISO-3166 alpha-3 con nombre en español, `paisType`), `iTiContRec` (persona
física/jurídica, opcional — a diferencia del DE, donde `buildReceiver` no tiene de dónde sacar este
dato y lo hardcodea a "1", **esta historia sí lo resuelve correctamente** porque su propio formulario
ya le pregunta al usuario el tipo de cliente), `dRucRec`/`dDVRec` o `iTipIDRec`/`dDTipIDRec`/
`dNumIDRec` (RUC o documento, mutuamente excluyentes), `dNomRec` (nombre/razón social, obligatorio),
`dDirRec` (dirección, opcional salvo exterior). Campos opcionales del XSD real que esta historia
deliberadamente no completa (mismo criterio de alcance que el gap de departamento/ciudad de HU-02):
`dNomFanRec`, `dNumCasRec`, códigos de departamento/distrito/ciudad, `dTelRec`/`dCelRec`/`dEmailRec`,
`dCodCliente`.

**Decisión de diseño: el formulario modela exactamente 3 opciones (empresa/persona/exterior), no
"empresa o persona" + un checkbox separado de "es del exterior".** Esto refleja fielmente el propio
modelo de SIFEN: `iTiOpe` solo tiene 3 valores posibles (1/2/4), sin una cuarta combinación para
"empresa del exterior" vs "persona del exterior" — forzar esa distinción adicional en la UI
inventaría una granularidad que el evento real no soporta. AC-02 ("si es empresa o persona") y AC-04
("si es del exterior") se satisfacen igual: el AC-02 exige como mínimo tipo+documento/RUC+nombre
(los 3 casos lo piden), y el "también" de AC-04 ("también exige la dirección") se cumple porque
"exterior" es, en este modelo, una tercera categoría con requisitos adicionales sobre el mismo
formulario base, no una combinación libre con las otras dos.

**Reuso de la infraestructura compartida de HU-10, según lo pedido explícitamente por esta
historia:** se generalizó `SifenCancellationEventClient` → **`SifenEventClient`** (rename, sin
ningún otro cambio de comportamiento) — su código ya era 100% genérico (arma el mismo sobre
`rEnviEventoDe`/`dEvReg`/`gGroupGesEve` sea cual sea el evento adentro, parsea la misma forma de
respuesta `rRetEnviEventoDe`/`gResProcEVe`); el rename solo hace explícito lo que ya era cierto, en
vez de dejar un cliente genérico bajo un nombre que sugiere lo contrario. `SifenDocumentSigningService
.signEvent`/`verifyEvent` (HU-10) se reusan sin ningún cambio — la firma de un evento no depende de
qué contiene `gGroupTiEvt`. `SifenClientIdentificationEventXmlService` (nuevo) sigue exactamente el
mismo patrón que `SifenCancellationEventXmlService` (mismo shell `<rGesEve><rEve>...<Signature/>
</rGesEve>`, mismo `Id` de evento en segundos époch). `SifenInvoiceClientIdentificationService`
(nuevo) orquesta igual que `SifenInvoiceCancellationService`: valida elegibilidad y los campos del
formulario, persiste auditoría antes de la red, firma y envía, y mapea la respuesta real.

**Diferencia clave con HU-10: una identificación aprobada NO cambia `sifenSubmissionStatus`.** La
factura sigue "Aprobada"/"Aprobada con observación" exactamente igual — solo se agrega un flag nuevo
`sifenClientIdentified` (true únicamente si SIFEN aprueba, AC-01) y se actualizan los campos de
cliente ya existentes de la factura (`clientDisplayName`/`clientRucOverride`/
`clientIdentityDocumentOverride`) para que el resto de la app (KuDE, listado, etc.) vea el cliente
identificado sin que ningún otro punto de la app necesite saber que este evento existe. Un rechazo
(AC-06) dejo el flag en `false`, permitiendo reintentar — a diferencia de la cancelación, que es
terminal una vez aprobada, aquí no hay ninguna razón de negocio para bloquear un segundo intento tras
un rechazo.

**AC-01 (elegibilidad): "sin datos del cliente" se define exactamente igual que el criterio real de
SIFEN para un receptor anónimo/"Innominado"** (RUC y documento de identidad ambos vacíos — el mismo
criterio, ni más ni menos, que hace que `SifenDocumentXmlService.buildReceiver` tome su rama
`iTipIDRec=5`/consumidor final), no por el nombre para mostrar (que sí puede tener un valor por
defecto tipo "Consumidor Final" sin que eso cuente como "identificado"). Se expuso un método nuevo,
`SifenInvoiceHeaderService.isReceiverUnidentified`, para no duplicar esta lógica — `InvoiceService`
lo inyecta y lo usa para calcular `sifenClientIdentificationEligible` en `InvoiceResponse`, mismo
patrón que `sifenCancellationDeadlineAt` de HU-10.

**Hallazgo real no relacionado con SIFEN, encontrado ejercitando el endpoint en vivo (no por los
tests con Mockito): un bug genuino de auto-invocación transaccional, latente en el patrón que HU-10
ya había establecido.** `SifenInvoiceCancellationService.cancel()` (público, sin `@Transactional`)
llama a `this.prepareForCancellation(...)` (paquete-privado, `@Transactional`) — una auto-invocación
de Spring AOP que **omite silenciosamente la anotación `@Transactional`** (limitación documentada de
Spring: un proxy CGLIB solo intercepta llamadas que llegan *a través* del proxy, nunca las que un
método hace sobre `this` dentro de la misma instancia). Esto nunca causó un fallo visible en HU-10
porque `prepareForCancellation` solo toca columnas propias de `Invoice` (ya materializadas al cargar
la fila, sin sesión de Hibernate necesaria). Esta historia, con la misma estructura calcada
(`identifyClient()` llamando a `this.prepareForIdentification(...)`), fue la primera en necesitar
resolver una asociación *lazy* real (`Invoice.client`, vía `isReceiverUnidentified` → `buildReceiverData`
→ `client.getRuc()`) — y ahí sí explotó, con `org.hibernate.LazyInitializationException: ... no
session`, confirmado contra un backend en vivo real (no en JUnit: los tests con Mockito de este
dominio nunca instancian un proxy Spring real, así que nunca podían haber detectado esto). Se
corrigió con el patrón estándar de auto-inyección diferida de Spring: un campo `@Autowired @Lazy`
apuntando al propio bean (`selfProxy`), con un método `self()` que cae de vuelta a `this` si Spring
nunca lo inyectó (para que los tests unitarios existentes, que instancian la clase directamente sin
contexto Spring, sigan funcionando sin cambios) — `identifyClient()` ahora llama a
`self().prepareForIdentification(...)`/`self().recordIdentificationResult(...)`, pasando realmente
por el proxy transaccional. **Deliberadamente no se tocó `SifenInvoiceCancellationService`** (mismo
bug, todavía latente ahí) — sigue sin manifestarse porque su propio `prepareForCancellation` nunca
toca una asociación lazy; corregirlo queda fuera del alcance de esta historia, documentado acá como
deuda técnica conocida para quien la retome (mismo fix, una línea de patrón).

**Segundo hallazgo operativo: el "flujo real end-to-end" de Playwright necesita un certificado válido
real para el tenant demo, algo que ninguna historia anterior garantiza si su archivo de test corre
solo.** `signEvent`/`sign` exigen `SifenCertificateService.requireActiveCertificate(tenantId)` —
normalmente sembrado de rebote por otras specs SIFEN (HU-07/HU-18/HU-20) que suben un certificado al
mismo tenant compartido cuando corre la suite completa (mismo caveat que HU-19 ya documentó para su
propio caso). Correr `sifen-hu-11-identificar-cliente.spec.ts` en aislamiento no hereda ese
certificado gratis. Se agregó un endpoint nuevo, solo test, `POST /api/admin/sifen-test-support/
ensure-valid-certificate` (extrae la lógica ya existente `ensureValidCertificate` de
`prepareForStatusCheck` a un endpoint standalone, sin sus otros efectos secundarios), que el nuevo
Playwright llama explícitamente antes de su propio flujo real — a diferencia de HU-10, que hoy
depende implícitamente del orden de ejecución de la suite completa para que esto funcione (mismo
gap, no corregido ahí por estar fuera de alcance).

**Verificación en vivo (2026-07-28), procedimiento para reproducir:** mismo patrón que HU-10 — un
test JUnit temporal (`ThrowawayLiveSifenHu11Test`, borrado antes de este commit) construyó el evento
de nominación real (CDC sintácticamente válido del RUC piloto `1137152-8`/timbrado `1137152`, nunca
realmente aprobado) y lo firmó con el `.p12` real, sin necesidad de un contexto Spring/base de datos
completo — se mockeó únicamente `SifenCertificateService.requireActiveCertificate` para devolver un
`SifenActiveCertificateMaterial` cargado directamente del `.p12` real vía `KeyStore` estándar de
Java, evitando construir un tenant/certificado real en base de datos solo para esta verificación. El
XML firmado resultante se envolvió a mano en el mismo sobre SOAP que arma `SifenEventClient` y se
envió con `curl --cert-type P12` al mismo endpoint real de HU-10
(`https://sifen-test.set.gov.py/de/ws/eventos/evento.wsdl`). **Resultado: HTTP 200**,
`rRetEnviEventoDe/gResProcEVe/dEstRes=Rechazado`, `gResProc/dCodRes=0160 "XML mal formado"` —
**exactamente el mismo código y mensaje que HU-10 documentó**, confirmando en vivo, contra el
servidor real: (a) el endpoint/dominio sigue siendo correcto para un evento distinto (nominación, no
cancelación); (b) la forma de la respuesta es la misma que `SifenEventClient` ya parsea sin cambios;
(c) **el "0160" es una propiedad del camino compartido de sobre/firma de eventos, no algo específico
del payload de cancelación** — la misma limitación de HU-10 (ningún documento de este sistema llegó
nunca a un "Aprobado" real, así que un CDC "nunca aprobado" siempre sería rechazado de todos modos,
independientemente de si el 0160 se resolviera) se confirma que aplica igual acá. No se intentó
re-diagnosticar el 0160 desde cero — HU-10 ya documentó exhaustivamente las variantes probadas (C14N
inclusiva/exclusiva, `URI=""` vs `URI="#id"`, validación XSD completa con `xmllint`) sin aislar la
causa, y esta historia no encontró ninguna pista nueva que justificara reabrir esa investigación
dentro de su propio alcance (eventos, no homologación completa).

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `service/SifenEventClient.java` — **renombrado desde `SifenCancellationEventClient`** (HU-10), sin
  cambios de comportamiento; javadoc actualizado para describir su rol genérico (usado ahora por
  HU-10 y HU-11). Su test acompaña el rename (`SifenEventClientTest`).
- `domain/enums/SifenClientIdentificationType.java` (nuevo) — `COMPANY`/`PERSON`/`FOREIGN`, mapeado
  1:1 a `iTiOpe` (1/2/4).
- `service/SifenForeignCountry.java` (nuevo) — subconjunto curado (17 países) del catálogo real de
  249 (`paisType`), con el nombre oficial en español exacto que SIFEN documenta — no se expuso el
  catálogo completo (desproporcionado para este dominio); debe mantenerse sincronizado a mano con la
  lista homónima en `InvoiceDetailModal.tsx` (documentado en ambos lados).
- `service/SifenClientIdentificationEventXmlService.java` (nuevo) — construye `<rGesEve>` sin firmar
  con la estructura real de `rGEveNom` descrita arriba.
- `service/SifenInvoiceClientIdentificationService.java` (nuevo) — orquesta AC-01 (elegibilidad,
  incluye `SIFEN_INVOICE_CLIENT_ALREADY_IDENTIFIED` nuevo, reusa `SIFEN_INVOICE_NOT_APPROVED` de
  HU-10), AC-02/AC-03/AC-04 (validación de campos por tipo de cliente — `SIFEN_CLIENT_IDENTIFICATION_
  TYPE_REQUIRED/NAME_REQUIRED/RUC_INVALID/DOCUMENT_REQUIRED/ADDRESS_REQUIRED/COUNTRY_INVALID`
  nuevos), AC-05 (persiste auditoría + actualiza campos de cliente de la factura), AC-06 (dejo la
  factura intacta, registra el rechazo). `SIFEN_CLIENT_IDENTIFICATION_NO_RESPONSE` (502) sin
  respuesta. Usa auto-inyección diferida (`@Autowired @Lazy` campo `selfProxy` + método `self()`) para
  que sus propias llamadas internas a `prepareForIdentification`/`recordIdentificationResult` pasen
  por el proxy transaccional real de Spring — ver el hallazgo de auto-invocación más arriba.
- `domain/Invoice.java` — 12 columnas nuevas de auditoría/estado (`sifen_client_identified` +
  11 campos de auditoría), migración `V27__sifen_invoice_client_identification.sql`.
- `service/SifenInvoiceHeaderService.isReceiverUnidentified` (nuevo, público) — expone la misma
  lógica de "consumidor final sin RUC ni documento" que `buildReceiverData` ya calculaba
  internamente, para que `InvoiceService` la reuse sin duplicarla.
- `service/InvoiceService` — inyecta `SifenInvoiceHeaderService` (dependencia nueva, sin ciclo:
  `SifenInvoiceHeaderService` no depende de `InvoiceService`); calcula
  `sifenClientIdentificationEligible` en `toDetailDto`.
- `web/InvoiceController.identifySifenClient` — `POST /api/invoices/{id}/sifen/identify-client`.
- `web/dto/InvoiceResponse` — 11 campos nuevos (elegibilidad + identificado + auditoría AC-05/AC-06).
- `web/SifenInvoiceTestSupportController` — 2 endpoints nuevos, solo test:
  `fabricate-client-identification-result/{approved}` (mismo rol que el equivalente de HU-10) y
  `ensure-valid-certificate` (extraído del helper ya existente `ensureValidCertificate`, ver
  "Segundo hallazgo operativo" arriba).

**Tests backend**: `SifenClientIdentificationEventXmlServiceTest` (8 casos: estructura `rGesEve`,
empresa emite RUC+B2B+persona jurídica, persona emite documento+B2C, exterior emite país+dirección+
B2F+pasaporte, nunca emite `dTiGDE`, rechaza CDC en blanco, rechaza país desconocido).
`SifenInvoiceClientIdentificationServiceTest` (16 casos: AC-01 aprobado/rechazado/ya-identificado/con-
datos-previos, AC-02 nombre obligatorio, AC-03 RUC obligatorio y validado para empresa, AC-04
dirección+país obligatorios y validados para exterior, AC-05 actualiza campos de cliente, AC-06 dejo
intacto, sin respuesta, firma el evento con los datos reales). `InvoiceServiceTest` ganó 4 casos
(elegibilidad true/false por estado/datos-previos/ya-identificado). `SifenEventClientTest` sin
cambios de comportamiento (solo renombrado).

**Playwright** (`e2e/tests/sifen-hu-11-identificar-cliente.spec.ts`, 10 casos): AC-01 (factura
aprobada sin datos ofrece identificar; no aprobada no ofrece; con datos previos del cliente no
ofrece; ya identificada no vuelve a ofrecerse — via `fabricate-client-identification-result`),
AC-05 (SIFEN aprueba fabricado: registro histórico con usuario/nombre/documento visibles, cliente
queda identificado), AC-06 (SIFEN rechaza fabricado: motivo visible, factura sin cambios, la opción
sigue disponible para reintentar), AC-02/AC-03 (empresa sin RUC válido muestra error), AC-04
(exterior sin dirección ni país muestra ambos errores), AC-02 (nombre obligatorio), y **un flujo real
de punta a punta**: clic real → firma real → intento de red real contra el servicio de eventos,
inalcanzable en el perfil `e2e` por diseño → confirma "SIFEN no respondió" y la factura queda sin
cambios — mismo precedente que el Playwright de HU-10 para su propio camino de "sin respuesta".

## HU-10 — Cancelar una factura ya aprobada (Done)

Épica EP-04. Cierra Fase 1 de eventos: la primera interacción de este sistema con el web service de
**eventos** de SIFEN (`siRecepEvento`), distinto de los ya usados por HU-06 (recepción de
documentos) y HU-07/09 (consulta/QR) — introduce el primer estado nuevo de este dominio desde
HU-06, `SifenSubmissionStatus.CANCELLED`.

**Investigación (Manual Técnico V150, capítulo 11 "Gestión de eventos" + sección 9.5
`siRecepEvento`):** el texto es extraíble con `pdftotext -layout` sin necesidad de renderizar
imágenes (a diferencia de HU-01). La cancelación (11.1.2) es un evento "Registro Requerido" del
emisor, con plazo de **48 horas desde la aprobación del DTE** para una Factura Electrónica
(distinto de 168h para otros tipos de documento, sección 11.6.1/Tabla J fila 1 — este dominio solo
emite facturas, así que solo 48h aplica). El request/response (`rEnviEventoDe`/`rRetEnviEventoDe`,
Schema XML 13/14) y el formato del evento de cancelación en sí (`Evento_v150.xsd`, sección 11.5.1:
`rGesEve > rEve[Id] > dFecFirma, dVerFor, dTiGDE, gGroupTiEvt > rGeVeCan[Id=CDC, mOtEve=motivo]` +
`Signature` como hermano de `rEve` dentro de `rGesEve`) están bien documentados. Los códigos de
rechazo de cancelación son 4000-4049 (sección 12.1.3), con `4009`/`4010` específicamente para
"plazo... extemporáneo" (AC-04's caso de ejemplo) y `4002` para "CDC no existente en el SIFEN".

**Hallazgo 1 (cross-check con fuente pública): el manual documenta `dTiGDE` (GDE006, "Tipo de
Evento") como obligatorio (1-1), pero el XSD real en vivo no lo tiene en absoluto.** Se obtuvo el
WSDL y XSD reales del servicio de eventos con el mismo patrón `curl --cert-type P12` de HU-05/06/07
(`.../de/ws/eventos/evento.wsdl.xsd1.xsd`): el `complexType` `trEve` real solo tiene
`dFecFirma, dVerFor, gGroupTiEvt` en su secuencia — el tipo de evento se transmite implícitamente
por **cuál** elemento aparece dentro de `gGroupTiEvt` (`rGeVeCan` para cancelación, una de las
opciones de un `xs:choice`), no por un campo `dTiGDE` explícito. Se confirmó cruzando con
`TIPS-SA/facturacionelectronicapy-xmlgen` (mismo proveedor competidor cuyo `qrgen` ya había
resuelto una ambigüedad similar en HU-08): su `JSonEventoMainService.generateXMLEventoCancelacion`
tampoco emite nunca `dTiGDE` — confirmación independiente de que es una desviación real y estable
del manual, no una rareza del ambiente de prueba. `SifenCancellationEventXmlService` sigue el XSD
real, no la tabla de campos del manual.

**Hallazgo 2 (el más importante, encontrado en vivo — ver "Verificación en vivo" abajo): el
`SignedInfo` de la firma de un evento debe usar canonicalización C14N *exclusiva*, no la
*inclusiva* que HU-04 estableció (y verificó en vivo) para el DE.** El propio Manual Técnico no lo
aclara para eventos específicamente (solo dice, sección 7.6, que aplica el mismo "Estándar de firma
digital" en general). Se cruzó con `TIPS-SA/facturacionelectronicapy-xmlsign`
(`SignXMLEvento.java`, mismo proveedor competidor): su implementación de firma de eventos usa
literalmente `CanonicalizationMethod.EXCLUSIVE` para `SignedInfo` (a diferencia de la inclusiva que
otras librerías/el propio manual usan para el DE). `SifenDocumentSigningService.signEvent` ahora
usa exclusiva para `SignedInfo` en eventos, inclusiva para el DE — la única diferencia entre ambos
caminos de firma, que ahora comparten el mismo método interno `signIdentifiedElement` parametrizado
en ese único algoritmo.

**Decisión de diseño: se generalizó `SifenDocumentSigningService` en vez de duplicar la lógica de
firma XML-DSig.** `sign()` (DE) y el nuevo `signEvent()` (evento) comparten `signIdentifiedElement`
— ambos son "enveloped signature sobre un elemento con atributo `Id`, agregando `<Signature>` como
hermano de ese elemento dentro de la raíz del documento" (`<rDE>` para el DE, `<rGesEve>` para el
evento), difiriendo solo en la canonicalización de `SignedInfo` (Hallazgo 2). También se generalizó
`verify()`/`verifyEvent()` de la misma forma. `SifenCancellationEventXmlService` (nuevo, mismo
patrón que `SifenDocumentXmlService` pero para el fragmento `<rGesEve>`) construye el documento sin
firmar; `SifenCancellationEventClient` (nuevo, mismo patrón que `SifenDocumentReceptionClient`/
`SifenDocumentQueryClient`) envuelve el XML firmado en el sobre SOAP (`rEnviEventoDe/dId/dEvReg/
gGroupGesEve`) y parsea `rRetEnviEventoDe` reusando `SifenXmlUtils`. `SifenInvoiceCancellationService`
(nuevo) orquesta: valida AC-01 (Aprobado/Aprobado con observación) y AC-02 (dentro de 48h desde
`Invoice.sifenSubmittedAt`, reusado como proxy de "fecha de aprobación en el SIFEN" — no hizo falta
una columna nueva de "fecha de aprobación", ya que `sifenSubmittedAt` es exactamente ese instante
desde HU-06), persiste los campos de auditoría (AC-05) en una transacción corta *antes* de
intentar la red (mismo patrón que `SifenInvoiceSubmissionService.prepareForSubmission`), firma y
envía el evento, y sobre la respuesta real de SIFEN: `Aprobado`/`Aprobado con observación` mueve la
factura a `CANCELLED` (AC-03); `Rechazado` deja el estado anterior intacto pero igual registra el
motivo del rechazo (AC-04); sin respuesta lanza `SIFEN_CANCELLATION_NO_RESPONSE` (502) sin tocar el
estado de la factura, pero conservando igualmente el registro de "quién lo pidió y cuándo" (AC-05).

**AC-05 (registro histórico): se siguió el mismo patrón "último resultado", no una tabla de
auditoría nueva.** Igual que `sifenSubmissionResultCode`/`sifenSubmissionMessage` (HU-06) se
sobrescriben en cada reintento sin mantener un historial completo, los 7 campos nuevos de
cancelación en `Invoice` (`sifenCancellationRequestedAt/RequestedByUserId/RequestedByEmail/Reason/
ResultCode/Message/ProtocolNumber`) se sobrescriben en cada intento — no existe en este código base
ningún patrón de tabla de auditoría genérica que hubiera sido natural reusar (se buscó
explícitamente antes de construir esto, ver instrucciones de la historia). Dado que la cancelación
es, en la práctica, casi siempre un intento único (una vez `CANCELLED`, es terminal), esta
simplificación es consistente con el resto del dominio.

**Verificación en vivo (2026-07-28), procedimiento para reproducir:** mismo patrón que HU-06/07/08 —
primero se obtuvo el WSDL/XSD reales del servicio de eventos (`curl --cert-type P12` contra
`.../de/ws/eventos/evento.wsdl?wsdl` y su `.xsd1.xsd`/`.xsd2.xsd` importados), confirmando en vivo:
(a) el endpoint real para POSTear es `https://sifen-test.set.gov.py/de/ws/eventos/evento.wsdl`
(el WSDL sin `?wsdl`, mismo patrón que HU-05/06/07); (b) **a diferencia del hallazgo de HU-07 para
`SiConsDE`, los nombres de los elementos raíz del manual (`rEnviEventoDe`/`rRetEnviEventoDe`) sí
coinciden exactamente con el XSD real y con la respuesta real** — no hubo aquí el mismo tipo de
desviación; (c) el grupo de resultado se llama literalmente `gResProcEVe` (V mayúscula, e final),
confirmado tanto en el XSD como en una respuesta real capturada. Con esto confirmado, un test JUnit
temporal (no commiteado, `ThrowawayLiveSifenHu10Test`/variantes, borrados antes de este commit)
construyó y firmó un evento de cancelación real para un CDC sintácticamente válido del RUC piloto
(`1137152-8`/timbrado `1137152`, nunca realmente aprobado — ver limitación abajo) con el `.p12`
real, y lo envió con `curl --cert-type P12` al endpoint real. **Resultado: HTTP 200**, cuerpo
`rRetEnviEventoDe` con `gResProcEVe/dEstRes=Rechazado`, `gResProc/dCodRes=0160 "XML mal formado"` —
confirma en vivo, contra el servidor real: el endpoint/dominio es correcto, la forma de la
respuesta (`rRetEnviEventoDe`/`gResProcEVe`/`gResProc`) es exactamente la que este cliente parsea, y
el servidor real efectivamente enruta y procesa peticiones al servicio de eventos como tal (un
envío sin `<Signature>` en absoluto devuelve, en cambio, la forma de error genérica compartida
`rRetEnviDe` con HTTP 400 — confirma que el envío firmado sí fue reconocido como perteneciente al
servicio de eventos, un paso más adelante que un envío completamente inválido).

**Limitación real, documentada honestamente: no se logró resolver el "0160" en vivo durante esta
historia — el camino feliz de AC-03 (SIFEN aprueba la cancelación) no se verificó en vivo.** Se
probaron varias variantes sin cambiar el resultado: (1) el documento pasa una validación XSD
completa con `xmllint` contra el schema real descargado; (2) se probó tanto C14N inclusiva como
exclusiva para `SignedInfo` (Hallazgo 2 — aunque exclusiva es la elegida para el código final por
estar respaldada por una implementación de referencia real, no cambió el resultado de este
diagnóstico en particular); (3) se probó una referencia de firma con `URI=""` (documento completo)
en vez de `URI="#id"` anclada al atributo `Id` de `rEve` (que no está tipado `xs:ID` en el XSD real,
a diferencia de lo que se sospecha para `DE/@Id`) — tampoco cambió el resultado. El código 0160 es
una validación genérica "aplicada a los mensajes de entrada de cualquiera de los Web Services"
(sección 12.2.6) — no se pudo aislar la causa exacta dentro del alcance de esta historia. Sigue
siendo, no obstante, información en vivo genuina y valiosa para AC-04 (el camino de error): un CDC
nunca realmente aprobado por este sistema (limitación heredada, sin `gCamFuFD` real transmitido
alguna vez con éxito — ver HU-06/07/08) siempre iba a ser rechazado de todos modos; lo que faltó
verificar en vivo es específicamente la aprobación. Documentado aquí en vez de reclamar una
verificación que no ocurrió — decisión consciente de no expandir el alcance a homologación completa
(Fase 4) para perseguir esto, según lo pedido explícitamente por esta historia.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `domain/enums/SifenSubmissionStatus` — valor nuevo `CANCELLED` (AC-03), nunca asignado sin una
  aprobación real de SIFEN sobre el evento.
- `domain/Invoice.java` — 7 columnas nuevas de auditoría de cancelación (AC-05), migración
  `V26__sifen_invoice_cancellation.sql`.
- `service/SifenCancellationEventXmlService.java` (nuevo) — construye el documento `<rGesEve>` sin
  firmar (Hallazgo 1: nunca emite `dTiGDE`), valida el motivo (`mOtEve`, 5-500 caracteres, GEC003).
- `service/SifenDocumentSigningService` — generalizado: `sign()`/`verify()` (DE) y los nuevos
  `signEvent()`/`verifyEvent()` (evento) comparten `signIdentifiedElement`/`verifySignatureOver`,
  parametrizados solo en la canonicalización de `SignedInfo` (Hallazgo 2).
- `service/SifenCancellationEventClient.java` (nuevo) — arma el sobre SOAP (`rEnviEventoDe/dId/
  dEvReg/gGroupGesEve`), postea vía `SifenConnectionService.buildAuthenticatedClient` (mismo mTLS
  de siempre), parsea `rRetEnviEventoDe`/`gResProcEVe`. Devuelve `Optional<SifenSubmissionResult>`
  (reusa el mismo record de HU-06) — vacío si no hubo respuesta interpretable.
- `service/SifenInvoiceCancellationService.java` (nuevo) — orquesta AC-01/AC-02 (elegibilidad +
  ventana de 48h desde `sifenSubmittedAt`), AC-05 (persiste auditoría antes de la red), AC-03/AC-04
  (mapea la respuesta real). Errores nuevos: `SIFEN_INVOICE_NOT_APPROVED` (409, cubre "nunca
  aprobada" y "ya cancelada"), `SIFEN_INVOICE_CANCELLATION_WINDOW_EXPIRED` (409),
  `SIFEN_CANCELLATION_NO_RESPONSE` (502) — reusa `SIFEN_INVOICE_MISSING_CONTROL_NUMBER` (HU-07) para
  el caso defensivo sin CDC.
- `web/InvoiceController.cancelSifenInvoice` — `POST /api/invoices/{id}/sifen/cancel` (body:
  `{reason}`, `InvoiceCancellationRequest`, `@NotBlank @Size(min=5,max=500)`). Devuelve 200 con la
  factura actualizada tanto si SIFEN aprueba como si rechaza — solo casos verdaderamente
  excepcionales (no elegible, sin respuesta) son error HTTP.
- `web/dto/InvoiceResponse` — 6 campos nuevos: `sifenCancellationDeadlineAt` (calculado por
  `InvoiceService`, `sifenSubmittedAt + 48h`, solo presente si la factura sigue Aprobada/Aprobada
  con observación) + 5 campos de auditoría (AC-05).
- `web/SifenInvoiceTestSupportController` — 2 endpoints nuevos, solo test:
  `prepare-with-status-hours-ago/{status}/{hoursAgo}` (fabrica una factura aprobada hace N horas,
  para AC-02 dentro/fuera del plazo) y `fabricate-cancellation-result/{approved}` (fabrica
  directamente el resultado de una cancelación, ya que ningún documento de este sistema llegó nunca
  a un "Aprobado" real para cancelar de verdad — ver limitación arriba).

**Tests backend**: `SifenCancellationEventXmlServiceTest` (6 casos, incluye la aserción explícita de
que `dTiGDE` nunca se emite — Hallazgo 1). `SifenDocumentSigningServiceTest` ganó 2 casos
(`signEvent`/`verifyEvent`, incluida detección de manipulación). `SifenCancellationEventClientTest`
(5 casos: aprobado con `dProtAut`, rechazado por plazo vencido código real `4009`, sin respuesta,
respuesta no-XML, forma del sobre SOAP enviado). `SifenInvoiceCancellationServiceTest` (11 casos:
AC-03 aprobado/aprobado-con-observación, AC-04 rechazado deja estado intacto, AC-05 auditoría
siempre se registra, AC-01 rechaza pendiente/rechazada/ya-cancelada, AC-02 rechaza pasado el plazo y
permite justo dentro del límite, sin respuesta lanza error sin tocar el estado, el evento firmado
contiene el CDC/motivo reales de la factura). `InvoiceServiceTest` ganó 3 casos (deadline calculado
correctamente, ausente si no aprobada, ausente pero con auditoría visible si ya cancelada) — se
agregó un `@Spy FemmeTimeProperties` nuevo a este test para que `@InjectMocks` pudiera resolver la
dependencia nueva de `InvoiceService` (conversión LocalDateTime→Instant vía zona horaria de negocio).

**Playwright** (`e2e/tests/sifen-hu-10-cancelar-factura.spec.ts`, 8 casos): AC-01 (sin
verificación SIFEN no hay botón; pendiente de verificación tampoco), AC-01/AC-02 (aprobada dentro
del plazo: cuenta regresiva + botón habilitado), AC-02 (pasado el plazo: explicación visible +
botón deshabilitado), AC-03/AC-05 (SIFEN aprueba fabricado vía test-support: badge "Cancelled",
botón desaparece, registro histórico visible con usuario/motivo), AC-04 (SIFEN rechaza fabricado:
mensaje de rechazo visible, estado se mantiene Aprobado, botón de cancelar sigue disponible),
validación de motivo mínimo 5 caracteres (sin red), y **un flujo real de punta a punta**: clic real
en cancelar → firma real → intento de red real contra el servicio de eventos, que en el perfil
`e2e` es inalcanzable por diseño (`application-e2e.properties` apunta a un puerto rechazado) →
confirma que el error "SIFEN no respondió" se muestra y la factura queda sin cambios — mismo
precedente que el propio Playwright de HU-07 para su camino de "sin respuesta".

## HU-09 — Revalidar en SIFEN una factura desde el sistema (Done)

Épica EP-03. Cierra Fase 2: la última pieza del ciclo de vida de una factura ya enviada. A
diferencia de toda historia anterior, **esta no habla con SIFEN desde el backend en absoluto** —
por diseño (AC-04): reconstruye la misma URL que HU-08 ya calcula/persiste para el código QR del
KuDE (`SifenQrCodeService`, vía `Invoice.sifenQrUrl`) y la abre en una pestaña nueva del navegador,
delegando por completo en la propia página de "Consultas" de SIFEN la interpretación del resultado.

**Decisión de diseño clave: qué URL exactamente se reutiliza.** La descripción de la historia dice
"reconstruye la misma dirección de verificación que está codificada en el código QR" — es decir, la
URL **completa** que el QR codifica (`sifenQrUrl`: `.../consultas-test/qr?nVersion=150&Id=...&...&
cHashQR=...`), no la URL "base" de consulta pública que HU-08 ya mostraba como texto en el propio
PDF junto al CDC para tipeo manual (`sifenPublicConsultationUrl`, sin querystring). Abrir la primera
directamente en una pestaña reproduce exactamente lo que pasaría al escanear el QR (AC-02: "sin
necesidad de escanear ni leer ninguna imagen"); abrir la segunda obligaría al usuario a volver a
tipear el CDC a mano, contradiciendo el propio objetivo de "un solo clic" de la historia.

**No hizo falta un endpoint nuevo.** `Invoice.sifenQrUrl` ya existía (persistido por HU-08/HU-06 en
el momento del envío real, antes incluso de intentar la conexión con SIFEN) — solo faltaba
exponerlo. Se agregó un campo nuevo `sifenVerificationUrl` a `InvoiceResponse` (mapeado 1:1 desde
`Invoice.getSifenQrUrl()` en `InvoiceService.toDetailDto`), reusando el mismo `GET
/api/invoices/{id}` que el modal de detalle ya consume — ningún controller ni ruta nueva.

**AC-05 (activa o cancelada) y el estado que todavía no existe.** `SifenSubmissionStatus` (HU-06)
hoy solo tiene `PENDING_VERIFICATION`/`APPROVED`/`APPROVED_WITH_OBSERVATION`/`REJECTED` — ningún
`CANCELLED`, porque HU-10 (que lo introduciría) es Fase 3 y todavía no se construyó. Implementar
cancelación real está deliberadamente fuera de alcance de esta historia. En su lugar, el botón de
revalidar en `InvoiceDetailModal.tsx` se gatea **únicamente en que `sifenVerificationUrl` exista**
(no en el valor de `sifenSubmissionStatus`) — es la precondición técnica real (solo una factura
efectivamente firmada/enviada tiene una URL de QR que revalidar) y, a diferencia de gatear por
"Aprobado"/"Aprobado con observación" como hace el bloque del KuDE (HU-08, donde sí es correcto
restringir así), deja el botón funcionando sin cambios el día que HU-10 agregue un estado
`CANCELLED` — nadie tendrá que tocar esta historia de nuevo. El Playwright de esta historia prueba
esto explícitamente fabricando una factura en estado `REJECTED` (el "terminal, no aprobado" más
cercano disponible hoy) con URL persistida, y confirmando que el botón igual aparece.

**Verificación en vivo (2026-07-28), procedimiento para reproducir:** mismo patrón que HU-06/HU-07/
HU-08 — un test JUnit temporal (no commiteado, `ThrowawayLiveSifenHu09Test`, borrado antes de este
commit) construyó un documento real con los mismos datos piloto (RUC `1137152-8`, timbrado
`1137152`), lo firmó con el `.p12` real (`requirements/sifen/*.p12`, gitignored) vía
`SifenDocumentSigningService.sign`, y calculó el QR real con `SifenQrCodeService.build` (CSC de
prueba `ABCD.../IdCSC=0001`) — exactamente el mismo camino que produce `Invoice.sifenQrUrl` en
producción. La URL real resultante:

```
https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150&Id=01011371528001002001452822026072839191919198
  &dFeEmiDE=...&dNumIDRec=4123456&dTotGralOpe=100000&dTotIVA=9090.91&cItems=1
  &DigestValue=...&IdCSC=0001&cHashQR=e85ca3838b6256df2bd2eb09817e01186eab7cf6d3fdaa49997b6de1f78226df
```

se pidió con `curl` (GET simple, sin mTLS — a diferencia de los WS SOAP de HU-05/HU-06/HU-07, el
sitio de consultas públicas no exige certificado de cliente) contra
`https://ekuatia.set.gov.py/consultas-test/qr?...`. **Resultado: HTTP 200**, `Content-Type:
text/html; charset=UTF-8`, cuerpo la aplicación Angular real "Consultas" de la DNIT/SIFEN
(`ng-app="consultaspublicasApp"`, footer "SIFEN Versión 1.3.5") — la misma SPA que renderiza el
resultado de la consulta client-side a partir de esos parámetros de query, exactamente lo que
pasaría en un browser real al hacer clic en el botón de esta historia. Esto confirma en vivo, contra
el servidor real: (a) el dominio/ruta (`ekuatia.set.gov.py/consultas-test/qr`) es el correcto para
AC-02/AC-03, (b) el formato del querystring que `SifenQrCodeService` genera es aceptado por el
servidor real (no un 400/404), (c) el ambiente de prueba resuelve al sitio de prueba, nunca al de
producción (AC-03) — `SifenQrProperties`/`SifenConnectionProperties.activeEnvironment()` ya
garantizaban esto en código, ahora también confirmado end-to-end contra el servidor real. No se
verificó (ni HU-09 lo necesita) qué mensaje específico muestra esa SPA para este CDC en particular —
por diseño (AC-04), ese resultado lo interpreta y muestra la propia página de SIFEN, no este sistema.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `web/dto/InvoiceResponse.java` — campo nuevo `sifenVerificationUrl` (último de la lista, para no
  reordenar los ya existentes).
- `service/InvoiceService.toDetailDto` — lo mapea desde `Invoice.getSifenQrUrl()`, ya persistido por
  HU-06/HU-08 en submit(). Sin cambios de comportamiento en ningún otro método.
- `web/SifenInvoiceTestSupportController` — `prepareAsApproved` refactorizado a un helper privado
  `prepareWithQrAndStatus(id, status)` reusado por un endpoint nuevo, **solo test**, `POST
  /invoices/{id}/prepare-with-status/{status}` (cualquier valor de `SifenSubmissionStatus`) — hizo
  falta para que el Playwright de AC-05 pudiera fabricar una factura con URL de verificación
  persistida bajo un estado distinto de `APPROVED`, sin depender de que exista aún un estado de
  cancelación real.

**Tests backend** (`InvoiceServiceTest`, 2 casos nuevos): `getInvoice_exposesTheSameUrlPersistedAsSifenQrUrl`
(el campo nuevo refleja exactamente `Invoice.sifenQrUrl`, sin transformación) y
`getInvoice_withoutSifenSubmission_sifenVerificationUrlIsNull` (una factura que nunca se firmó/envió
no expone ninguna URL). No hizo falta tocar ningún test de `SifenQrCodeService`/
`SifenDocumentSigningService`/`SifenInvoiceSubmissionService` — ninguno de sus contratos cambió.

**Playwright** (`e2e/tests/sifen-hu-09-revalidar-factura.spec.ts`, 3 casos): AC-01/AC-06 (sin
verificación SIFEN previa no existe el botón, y tampoco ningún `input[type="file"]` en toda la
pantalla — confirma por ausencia que esta funcionalidad nunca ofrece subir/escanear una imagen),
AC-01/AC-02/AC-03 (factura aprobada real vía `prepare-as-approved`: el clic abre una pestaña nueva
cuya URL apunta exactamente a `consultas-test/qr?...`, nunca a `consultas/qr?...` de producción),
AC-05 (factura `REJECTED` fabricada vía el endpoint de test-support nuevo: el botón sigue
apareciendo, prueba directa de que no está gateado por "Aprobado"). AC-02/AC-03 usan el evento
`popup` de Playwright — la `Page` del `window.open` está disponible sincrónicamente en el instante en
que se crea, antes de que la navegación externa termine de cargar, así que el test puede afirmar
sobre la URL objetivo y cerrar la pestaña de inmediato sin depender de que el sitio real de SIFEN
efectivamente renderice dentro de CI. AC-04 no tiene test (por diseño, este sistema nunca interpreta
esa respuesta) y AC-06 se cubre por ausencia (ya descrito arriba).

## HU-08 — Generar el comprobante en PDF (KuDE) de una factura aprobada (Done)

Épica EP-03. La pieza que le faltaba a este sistema para poder llegar a un "Aprobado" real de
SIFEN: HU-06/HU-07 dejaron documentado, dos veces, que ningún documento propio llegó nunca a
"Aprobado" porque `gCamFuFD/dCarQR` (el código QR) faltaba en el DE. **Esta historia lo cierra y lo
verifica en vivo** (ver "Verificación en vivo" abajo) — con resultado real: el gap de `gCamFuFD`
desaparece, quedan solo los 3 gaps menores que HU-06 ya había documentado como fuera de alcance.

**Investigación del algoritmo del QR (Manual Técnico V150, sección 13.8, extraíble como texto sin
renderizar imágenes — a diferencia de lo que se esperaba):** el código QR codifica una URL
(`<host>/consultas[-test]/qr?...`) cuyo query string concatena, en un orden fijo, `nVersion` (150),
`Id` (el CDC completo), `dFeEmiDE` (fecha/hora de emisión, **hex de los bytes UTF-8 del texto
literal**, no del valor decodificado), el identificador del receptor (ver hallazgo siguiente),
`dTotGralOpe`/`dTotIVA` (F014/F017, tal cual aparecen en el DE), `cItems` (cantidad de `gCamItem`),
`DigestValue` (el mismo hex-de-texto-literal, esta vez del `DigestValue` base64 de la firma XML-DSig
— campo XS17) y `IdCSC`. El hash (`cHashQR`) es SHA-256 sobre esa cadena completa **más el CSC
crudo pegado sin separador** (nunca se transmite, solo se usa para hashear), en hexadecimal
minúscula. Verificado **exactamente** contra el ejemplo resuelto que trae el propio manual (sección
13.8.4: mismo CDC, mismo `DigestValue`, mismos totales, mismo CSC de prueba `ABCD...`/`IdCSC=0001`)
— `SifenQrCodeServiceTest` reproduce ese ejemplo carácter por carácter, incluido el hash final
`97ddbb3c1e7d65af...`. Esto es lo más parecido a una prueba matemática de que el algoritmo está bien
implementado, igual que HU-01 hizo con el checksum del CDC.

**Hallazgo (cross-check con fuente pública, ver siguiente párrafo): el parámetro de identificación
del receptor cambia de *nombre*, no solo de valor.** El manual documenta una sola fila
"`dRucRec`/`dNumIDRec`" para esto (ID Campo "D206 o D210"), con un único ejemplo resuelto que solo
cubre el caso RUC (`dRucRec=88899990`) — no alcanza para inferir qué pasa con el otro caso. Se buscó
en un generador de QR de SIFEN públicamente mantenido, `TIPS-SA/facturacionelectronicapy-qrgen`
(paquete npm de un proveedor competidor de facturación electrónica paraguaya, parte de una suite con
`xmlgen`/`xmlsign`/`setapi`), cuyo `QRGen.ts` confirma: el parámetro literalmente se llama
`dRucRec` cuando el receptor tiene RUC (`iNatRec=1`) y `dNumIDRec` en cualquier otro caso —
incluido el consumidor final anónimo, cuyo valor es `"0"` (mismo criterio "campo vacío → 0" que el
manual ya documenta para `dTotGralOpe`/`dTotIVA`). `SifenReceiverIdentification` implementa
exactamente esa rama, replicando (sin duplicar código de) la que `SifenDocumentXmlService.buildReceiver`
ya usa para decidir D206 vs D210 en el DE — deben coincidir siempre, porque el hash del QR solo es
válido si referencia literalmente el mismo par campo/valor que terminó en el documento firmado.

**Dónde se resuelve la dependencia circular DE↔QR:** el QR necesita el `DigestValue` de la firma
(campo XS17), pero `gCamFuFD` es parte del DE que SIFEN espera recibir firmado. La resolución (ya
insinuada por el propio error de HU-06, `"Elemento esperado: gCamFuFD dentro de: rDE"`) es que
`gCamFuFD` **no** va anidado dentro de `<DE>` — va como **hermano** de `<DE>` y `<Signature>`,
directamente bajo `<rDE>`. Eso permite firmar primero (la referencia firmada solo cubre `<DE>`, vía
`URI="#cdc"`), leer el `DigestValue` ya producido, calcular el QR, y recién ahí agregar `gCamFuFD`
como último hijo de `<rDE>` — sin invalidar la firma (probado explícitamente:
`signInvoice_appendsTheQrGroupWithoutInvalidatingTheSignature`, `SifenDocumentSigningServiceTest`).
`SifenDocumentXmlService.appendQrGroup` hace exactamente eso; `SifenDocumentSigningService.signInvoice`
(el orquestador) es quien firma, extrae el digest, llama a `SifenQrCodeService.build`, y agrega el
grupo — este orquestador es el único punto de esta app que arma un DE listo para enviar, así que HU-06
(envío) obtiene el QR gratis sin cambiar su propio código.

**Verificación en vivo (2026-07-28), procedimiento para reproducir:** mismo patrón que HU-06/HU-07 —
un test JUnit temporal (no commiteado, `ThrowawayLiveSifenHu08Test`, borrado antes de este commit)
construyó un documento real con los mismos datos piloto (RUC `1137152-8`, timbrado `1137152`, un
`dNumDoc` nuevo para no reusar un CDC de un intento anterior), lo firmó con el `.p12` real
(`requirements/sifen/*.p12`, gitignored) vía `SifenDocumentSigningService.sign`, calculó el QR real
con `SifenQrCodeService.build` usando el CSC de prueba `ABCD0000000000000000000000000000`
(`IdCSC=0001`), le agregó `gCamFuFD/dCarQR` con `appendQrGroup`, y volcó el XML resultante a un
archivo. Ese XML se envolvió a mano en el mismo sobre SOAP que `SifenDocumentReceptionClient` arma
(`rEnviDe`/`dId`/`xDE`) y se envió con `curl --cert-type P12 --cert archivo.p12:contraseña -X POST
https://sifen-test.set.gov.py/de/ws/sync/recibe.wsdl`.

- **Primer intento: `dCodRes=0160 "XML Mal Formado."` (HTTP 400) — pero era un error propio, no de
  SIFEN ni del código de esta app.** El script de `curl` generaba `<dId>` con `date +%s%3N` (formato
  GNU) para un id de correlación — en macOS, `date` no soporta `%3N` y lo deja como litoral, así que
  `<dId>` terminaba en una "N" (`"1785258251

3N"`), un valor no numérico en un campo `N` (numérico).
  Nada que ver con `SifenDocumentXmlService`/`SifenDocumentSigningService`/`SifenQrCodeService` —
  puramente un bug del script de reproducción manual, corregido generando el id con milisegundos
  reales (`python3 -c "import time; print(int(time.time()*1000))"`).
- **Segundo intento, con el `dId` corregido: `HTTP 200`, `dEstRes=Rechazado`, con exactamente los
  mismos 3 `gResProc` que HU-06 ya había documentado como gaps menores fuera de alcance** — `dFeFinT
  es invalido`, `dDesUniMed es invalido` (`"Unidad"` en vez del código de catálogo que el schema
  exige), `Elemento esperado: dBasExe dentro de: gCamIVA`. **Ningún error menciona ya `gCamFuFD`** —
  confirma en vivo, contra el servidor real, que el fix de esta historia cierra exactamente el gap
  que bloqueaba a HU-06/HU-07. `dDigVal` (el digest que SIFEN calculó de vuelta sobre el `<DE>`
  recibido) también vino en la respuesta — coincide con el que este sistema ya había calculado antes
  de enviar, otra confirmación de que la firma y el QR están usando el `DigestValue` correcto.
- **Conclusión: sigue sin haber, hoy, ningún CDC real "Aprobado" para consultar** (HU-07 AC-01/AC-03
  y la futura HU-09 siguen bloqueadas por esto) — pero la razón ya no es `gCamFuFD` (cerrado por esta
  historia), son los 3 gaps de compliance de schema que HU-04/HU-06 ya documentaron como
  deliberadamente pospuestos a homologación (HU-12..HU-17), no como algo que HU-08 debía resolver.
  Cerrarlos ahí sí podría finalmente producir un "Aprobado" real.

**Decisión de diseño clave: el QR no se recalcula al generar el KuDE — se lee tal cual quedó
persistido en el momento del envío real.** `SifenInvoiceSubmissionService.submit()` (HU-06) ahora
persiste `Invoice.sifenQrUrl`/`sifenPublicConsultationUrl` inmediatamente después de firmar (antes
de siquiera intentar el envío — es una propiedad del documento transmitido, no de la respuesta de
SIFEN). `SifenKudePdfService` simplemente lee esos dos campos. Esto evita dos problemas: (1) no
depende de que el certificado del tenant siga vigente en el momento de la descarga (un certificado
puede vencer mucho después de que una factura ya fue aprobada, pero su KuDE debe seguir
descargable), y (2) garantiza bit a bit que el QR impreso es el que SIFEN realmente recibió, nunca
una aproximación recalculada — literal cumplimiento de AC-11 y precondición real de AC-14.

**Dos campos nuevos, con distinto origen, en `BusinessProfile` (migración V24):**
`sifenFantasyName` (D106/dNomFanEmi, opcional en el propio schema del DE — sí es dato real de la
factura, se agregó también a `SifenIssuerData`/`SifenDocumentXmlService` para que el DE lo emita
cuando esté configurado) y `kudeFooterMessage` (la única excepción de AC-11 que no tiene ya una vía
de configuración — la otra, el logo, reutiliza `BusinessProfile.logoDataUrl`, que ya existía desde
antes de esta historia). **Deuda técnica conocida, mismo patrón que HU-04 dejó para
`taxpayerType`/`economicActivityCode`/ubicación del emisor:** ninguno de estos 2 campos tiene UI
propia todavía en `BusinessSettingsPage` — se puede cerrar junto con esos otros 3 campos en una sola
extensión futura del formulario existente; no bloquea esta historia porque son datos opcionales
(el nombre de fantasía no siempre existe; el mensaje libre es explícitamente opcional por AC-11).

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `config/SifenQrProperties.java` (nuevo) — URLs de QR/consulta pública por ambiente (reusa
  `SifenConnectionProperties.activeEnvironment()`) + CSC activo, con los dos CSC de prueba de la SET
  como default (mismo patrón que `SifenConnectionProperties`: cambiar de ambiente/CSC es
  configuración, no código).
- `service/SifenQrCodeService.java` (nuevo) — el algoritmo de arriba. `build(header, totals,
  itemCount, digestValueBase64)` devuelve `SifenQrResult(qrUrl, publicConsultationUrl,
  productionEnvironment)`.
- `service/SifenReceiverIdentification.java` (nuevo, package-private) — resuelve `dRucRec`/`dNumIDRec`
  + valor, documentado como debiendo permanecer sincronizado con `SifenDocumentXmlService.buildReceiver`.
- `service/SifenDocumentXmlService.appendQrGroup` (nuevo) — agrega `gCamFuFD/dCarQR` como hermano de
  `<DE>`/`<Signature>`. `buildIssuer` ahora también emite `dNomFanEmi` cuando está configurado.
- `service/SifenDocumentSigningService.signInvoice` — ahora también extrae el `DigestValue` post-firma,
  llama a `SifenQrCodeService`, y agrega el grupo QR antes de devolver el documento. `SifenSignedDocument`
  ganó 2 campos (`qrUrl`, `publicConsultationUrl`); `sign()` (de más bajo nivel, sin header/totals)
  los deja en `null` — solo el orquestador los completa.
- `service/SifenInvoiceSubmissionService.submit()` — persiste `sifenQrUrl`/`sifenPublicConsultationUrl`
  en una transacción corta nueva (`persistQrData`), justo después de firmar, antes de intentar el envío.
- `domain/Invoice.java` — 2 columnas nuevas (`sifen_qr_url`, `sifen_public_consultation_url`,
  migración V25).
- `service/SifenQrImageService.java` (nuevo) — renderiza el QR como PNG con `com.google.zxing:core`
  (única dependencia nueva de este HU además de la ya existente `openpdf`; no se usa el submódulo
  `javase` de zxing — el raster se arma a mano desde el `BitMatrix`, un puñado de líneas).
- `service/SifenKudePdfService.java` (nuevo) — arma el PDF completo con `com.lowagie` (`openpdf`, ya
  usado por `InvoicePdfService`/`TipsReportPdfService` — sin dependencia nueva de PDF). AC-01 (solo
  Aprobado/Aprobado con observación), AC-02 (A4, `com.lowagie.text.PageSize.A4`, multi-página
  automática por flujo de contenido — no hay paginación manual), AC-03/04/05 (encabezado, timbrado,
  venta, cliente si identificado — mismo criterio de "identificado" que ya usa el DE: RUC, documento
  o nombre no vacíos), AC-06/07 (tabla de ítems con columnas exento/5%/10%, subtotal/total/total en
  guaraníes/liquidación de IVA — el "total en guaraníes" es literalmente igual al total ya que este
  dominio solo opera en PYG), AC-08 (CDC agrupado en once bloques de 4, `groupControlNumber`), AC-09
  (leyenda KuDE), AC-10 (URL de consulta pública + CDC), AC-11 (logo + mensaje libre, únicas
  excepciones), AC-12 (numeración "Página N / " + plantilla de total de páginas — el truco estándar
  de iText/OpenPDF vía `PdfTemplate`; el bloque de totales se agrega al final del flujo, así que cae
  en la página real que sea la última, sin lógica de paginación manual), AC-13 (imagen QR ≥25mm de
  ancho, ver `QR_WIDTH_POINTS`), AC-15 (leyenda de ambiente de prueba solo si `testEnvironmentNotice`).
- `web/SifenKudeController.java` (nuevo) — `GET /api/invoices/{id}/sifen/kude` (AC-16, descarga) y
  `POST /api/invoices/{id}/sifen/kude/email` (AC-17, envío por correo). Archivo propio, no se agregó
  a `InvoicePdfController` (la factura PDF tradicional, sin relación con SIFEN, que HU-08 no debe
  tocar ni confundir).
- `service/SifenKudeEmailService.java` (nuevo) — reusa `SifenKudePdfService` + `EmailService`. El
  destinatario es el email tipeado explícitamente si se informó; si no, el email del cliente
  vinculado a la factura; si ninguno existe, `SIFEN_KUDE_EMAIL_REQUIRED` (400) en vez de fallar en
  silencio.
- `service/EmailService.sendPdfAttachment` (nuevo método) — primera vez que este servicio envía un
  adjunto; mismo patrón enabled/disabled (`app.femme.email.enabled=false` en e2e) que
  `sendActivationLink` ya tenía, ahora también con `EmailAttachment`/`BinaryData` de
  `azure-communication-email` (dependencia ya existente, sin agregar nada nuevo).
- `web/SifenInvoiceTestSupportController` — endpoint nuevo, solo test (`prepare-as-approved`):
  arma una factura "Aprobado" completa reusando los servicios reales
  (`SifenInvoiceHeaderService`/`SifenInvoiceDetailService`/`SifenQrCodeService`) — sin firma real ni
  round-trip real a SIFEN (innecesarios para probar que el KuDE renderiza/descarga/envía bien desde
  datos reales y válidos), ya que nada en la app llama todavía a `submit()` (activación real por
  tenant es HU-22).

**Tests backend**: `SifenQrCodeServiceTest` (6 casos: reproducción exacta del ejemplo resuelto del
manual — hash y URL carácter por carácter —, receptor anónimo, receptor con documento de identidad,
ambiente de prueba vs producción). `SifenQrImageServiceTest` (2 casos: PNG decodificable y cuadrado,
contenidos distintos producen imágenes distintas). `SifenKudePdfServiceTest` (13 casos, con
`com.lowagie.text.pdf.parser.PdfTextExtractor` para asserts de contenido real del PDF generado — la
herramienta correcta para esto, no Playwright/OCR: AC-01 rechazo si no aprobada, rechazo si falta el
QR persistido, AC-02 PDF A4 válido, AC-03/04 datos de negocio/timbrado/venta, AC-05 cliente
identificado/anónimo, AC-08 agrupación del CDC, AC-09/AC-10/AC-15 leyendas y URL de consulta, AC-06/07
detalle e impuestos, AC-12 numeración de página, AC-11 mensaje libre opcional, AC-13 imagen QR
embebida en la página 1 con el ancho mínimo). `SifenKudeEmailServiceTest` (5 casos: email explícito
gana, cae al email del cliente, error claro sin ninguno de los dos, email en blanco cae al del
cliente, se adjuntan los bytes reales del PDF). `SifenDocumentSigningServiceTest` ganó 1 caso nuevo
(`gCamFuFD` agregado sin invalidar la firma). `SifenDocumentXmlServiceTest` ganó 2 casos
(`dNomFanEmi` presente/ausente). `SifenInvoiceSubmissionServiceTest` ganó aserciones sobre
`sifenQrUrl`/`sifenPublicConsultationUrl` persistidos.

**Playwright** (`e2e/tests/sifen-hu-08-generar-comprobante-kude.spec.ts`, 2 casos — AC-16 y AC-17,
las únicas dos ACs de esta historia con pantalla propia): AC-16 confirma que el botón de descarga no
existe antes de aprobar, aparece tras `prepare-as-approved`, y una descarga real produce un PDF
(`content-type: application/pdf`, nombre `KUDE-*.pdf`); AC-17 envía el KuDE a un email tipeado y
confirma el mensaje de éxito. El resto de los 17 ACs (estructura/contenido del PDF, algoritmo del
QR) se cubrieron con JUnit — son puramente de contenido generado, no de interacción de UI, mismo
criterio que las historias anteriores sin pantalla propia (HU-01/03/04/05/21).

**Frontend**: `InvoiceDetailModal.tsx` — dentro de la sección "SIFEN status" (HU-07), un bloque nuevo
visible solo si el estado es Aprobado/Aprobado con observación: botón de descarga del KuDE y un
formulario de una sola línea (email opcional + botón "Enviar"). `api/downloadSifenKude.ts` (nuevo,
mismo patrón que `downloadInvoicePdf.ts`). Claves i18n nuevas bajo
`femme.billing.history.detail.sifen.*` y 3 códigos de error nuevos en `femme.apiErrors.*`
(`SIFEN_KUDE_ONLY_FOR_APPROVED_INVOICES`, `SIFEN_KUDE_MISSING_QR_DATA`, `SIFEN_KUDE_EMAIL_REQUIRED`),
en `en.json` y `es.json`.

## HU-19 — Ver el listado de certificados cargados de un tenant (Done)

Épica EP-06. **Sin interacción con SIFEN — N/A para el reporte final de interacciones reales
contra SIFEN de este loop.** Puramente aditiva y de solo lectura: todo lo que HU-19 necesita
(almacenamiento tenant-aislado del certificado, fechas extraídas del `.p12`, y el cálculo en vivo
de vigencia) ya lo construyeron HU-18 y HU-20 respectivamente — esta historia solo formaliza que
ese mismo endpoint/listado *es* HU-19, agrega la única pieza de UI que faltaba (el atajo del
estado vacío, AC-05) y su propia cobertura de test dedicada.

**Hallazgo principal: no hizo falta escribir casi nada de capacidad nueva.** `GET
/api/sifen/certificates` (`SifenCertificateController.list`, HU-18) ya devolvía
`SifenCertificateResponse` con exactamente los 4 campos permitidos por AC-02
(`uploadedAt`/`notBefore`/`notAfter`/`status`, más el `id` técnico usado como key de fila — nunca
la clave privada, el `.p12`, ni la contraseña, AC-03), ya ordenados por `uploadedAt` descendente
(`findByTenant_IdOrderByUploadedAtDesc`, AC-06 — HU-18 AC-10 ya garantizaba que cargar uno nuevo no
borra los anteriores), ya aislados por tenant (misma query, AC-04), y ya con el estado calculado en
vivo en cada llamada por `SifenCertificateService.computeStatus` (HU-20 AC-04). El frontend
(`SifenCertificatesPage.tsx`) ya renderizaba ese listado dentro de la misma sección que el
formulario de carga (AC-01), con los 4 campos visibles por fila.

**Lo único que realmente faltaba: AC-05 (estado vacío con acceso directo a la carga).** El listado
vacío ya mostraba el texto "No certificates uploaded yet." pero sin ningún atajo a la opción de
carga. Se agregó un botón (`femme.sifenCertificates.emptyCta`, variante `secondary` del design
system) dentro de un contenedor nuevo `data-testid="sifen-certificate-empty-state"` que, al hacer
clic, hace `scrollIntoView` + `focus()` sobre el input de archivo del formulario ya existente más
arriba en la misma página — no se creó un segundo formulario ni una ruta nueva, solo se conecta el
atajo al que ya estaba ahí (consistente con AC-01, que exige que carga y listado convivan en la
misma sección).

**Decisión de diseño: no se migró el listado a `DataTable` (design-system).** `DataTable` es un
componente pesado (drag-and-drop de columnas, ocultar/mostrar columnas, orden por click) pensado
para tablas con muchas columnas configurables — ninguna otra pantalla de configuración de este
repo lo usa (`TaxesPage`/`FiscalStampSettingsPage` tampoco), solo aparece en
`DesignSystemShowcasePage`. Con exactamente 4 campos fijos y sin necesidad de ordenar/ocultar
columnas, el patrón de filas `div` ya usado por HU-18/HU-20 es más simple y consistente con el
resto de `Configuración → SIFEN` — se mantuvo tal cual.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- Sin cambios de comportamiento — solo javadoc aclaratorio en `SifenCertificateController` (el
  `GET` ya documentado como "HU-18: upload..." ahora también referencia a HU-19/HU-20 para dejar
  explícito que ese mismo endpoint es el que sirve las tres historias).
- `web/SifenInvoiceTestSupportController` ganó un endpoint nuevo, **solo para testing** (mismo
  gateo `femme.data-init.enabled`, activo solo en el profile `e2e`): `POST
  /api/admin/sifen-test-support/certificates/clear` — borra todos los `SifenCertificate` del
  tenant demo. Hizo falta porque HU-07/HU-18/HU-20 ya suben certificados al mismo tenant demo
  compartido sin nunca limpiarlos (por diseño: esos specs solo aseveran conteos relativos, nunca un
  cero absoluto), y el orden de ejecución de archivos de Playwright no está garantizado — el test
  de estado vacío de HU-19 (AC-05) necesita partir de un cero real y reproducible sin importar qué
  corrió antes.

**Tests backend** (`SifenCertificateServiceTest`, 2 casos nuevos +1 comentario en el ya
existente): `list_exposesOnlyTheFourAllowedFieldsPerCertificate_neverPrivateKeyOrPassword`
(AC-02/AC-03, incluye una aserción sobre la forma del propio record — 5 componentes exactos — para
que agregar un campo nuevo a `SifenCertificateResponse` en el futuro rompa este test si no se
revisa a propósito) y `list_includesEveryHistoricalCertificate_notOnlyTheMostRecent` (AC-06, orden
descendente con certificados de antigüedad muy distinta). AC-04 (aislamiento por tenant) no
necesitó un test nuevo — se documentó que `list_onlyQueriesRequestedTenant_neverLeaksOtherTenants`
(ya existente desde HU-18) cubre exactamente lo mismo, porque HU-19 reutiliza `list()` sin
cambios; mismo precedente que HU-18 AC-07 (no existe fixture de segundo tenant para Playwright en
este repo — ver su propia "Desviación conocida" — así que el aislamiento se prueba a nivel de
repositorio, no de UI).

**Playwright** (`e2e/tests/sifen-hu-19-listado-certificados.spec.ts`, 4 casos, uno por AC restante
— AC-04 documentado arriba como cubierto solo por JUnit): AC-01 (listado y carga en la misma
sección), AC-02/AC-03 (inspecciona el JSON crudo de la respuesta de `GET
/api/sifen/certificates` y confirma que las claves son exactamente
`id/notAfter/notBefore/status/uploadedAt`, y que el cuerpo entero nunca contiene las palabras
"password"/"privatekey" ni la contraseña real usada), AC-05 (limpia certificados vía el endpoint
de test-support nuevo, confirma el estado vacío y que el botón de atajo efectivamente enfoca el
input de archivo del formulario de carga), AC-06 (sube 3 certificados y confirma que los 3
persisten visibles tras un *reload* completo de la página, no solo el más reciente).

## HU-07 — Verificar en SIFEN el estado de una factura pendiente (Done)

Primer paso de la Fase 2: cierra el ciclo de vida de una factura que HU-06 dejó en
`PENDING_VERIFICATION` (sin respuesta de SIFEN) consultando su estado real por CDC. **Primera
historia de esta integración con pantalla + controller HTTP propios** (AC-04 lo pide
explícitamente) — todas las anteriores (HU-01/02(salvo AC-05)/03/04/05/06/21) fueron capacidad de
servicio sin UI.

**Investigación del WS de consulta (`SiConsDE`, Manual Técnico V150.pdf sección 9.4):** el texto de
esta sección **sí** es extraíble con `pdftotext -layout` (a diferencia del capítulo 10 de HU-01, que
necesitó renderizar páginas como imagen) — describe el request (`rEnviConsDe`/`dId`/`dCDC`) y la
respuesta (`rResEnviConsDe`/`dFecProc`/`dCodRes`/`dMsgRes`/`xContenDE`, con `xContenDE` definido
como un `ContenedorDE` estructurado: `rDE` + `dProtAut` + `xContEv`) y la tabla de resultados
(Tabla G, sección 9.4.2): `0420`="CDC inexistente", `0421`="RUC Certificado sin permiso",
`0422`="CDC encontrado". Igual que en HU-05/HU-06, **el manual y el WSDL/XSD reales en vivo
difieren** — ver "Verificación en vivo" abajo para lo confirmado.

**Verificación en vivo (2026-07-28), procedimiento para reproducir:** se obtuvo el WSDL real del
servicio de consulta con el mismo patrón de `curl --cert-type P12` de HU-05/HU-06 (`curl --cert-type
P12 --cert archivo.p12:contraseña https://sifen-test.set.gov.py/de/ws/consultas/consulta.wsdl?wsdl`)
y también su XSD importado (`consulta.wsdl.xsd1.xsd`). Con eso confirmado, se armó a mano un sobre
SOAP con un CDC sintácticamente válido (mismos datos piloto RUC `1137152-8`/timbrado `1137152` que
HU-06, pero un número de documento que nunca se envió de verdad) y se envió con `curl --cert-type
P12 --cert archivo.p12:contraseña -X POST
https://sifen-test.set.gov.py/de/ws/consultas/consulta.wsdl`. La respuesta real fue **HTTP 200**,
cuerpo `rEnviConsDeResponse` con `dCodRes=0420`, `dMsgRes="Documento No Existe en SIFEN o ha sido
Rechazado"` — una consulta real y completa de principio a fin contra el ambiente de prueba real, que
ejercita AC-02 (aunque el CDC nunca fue realmente enviado en vez de rechazado, la respuesta de SIFEN
no distingue esos dos casos — ver Hallazgo 2). Igual que HU-05/HU-06, esto no quedó como test
automatizado contra el servidor real por la misma razón (el `.p12` real y su contraseña no están
presentes en un checkout limpio ni en CI); quien necesite reverificarlo puede repetir el mismo
procedimiento.

**Hallazgo 1: el endpoint real para POSTear, otra vez, no es la URL del WSDL.** Mismo patrón que
HU-06: el manual (sección 7.10) solo publica `.../de/ws/consultas/consulta.wsdl?wsdl`; el
`soap12:address` del WSDL real apunta a esa misma URL **sin** `?wsdl`. `CONSULTA_PATH` en
`SifenDocumentQueryClient` es literalmente eso.

**Hallazgo 2 (el más importante): los nombres de los elementos raíz del manual no coinciden ni con
el XSD real ni con la respuesta real.** El manual (secciones 9.4.1/9.4.3) documenta el request como
`rEnviConsDe` y la respuesta como `rResEnviConsDe`. El XSD real (`consulta.wsdl.xsd1.xsd`) define
`rEnviConsDeRequest` y `rEnviConsDeResponse` — confirmado también por la respuesta real capturada
arriba, que trae literalmente `<rEnviConsDeResponse>` como elemento raíz. `SifenDocumentQueryClient`
usa los nombres reales, no los del manual.

**Hallazgo 3: el mensaje real de `0420` ya combina "no existe" y "rechazado" en un solo texto.** El
manual (Tabla G) documenta `0420` como simplemente `"CDC inexistente"`. La respuesta real trajo
`"Documento No Existe en SIFEN o ha sido Rechazado"` — es decir, **SIFEN mismo no distingue "nunca
recibido" de "recibido y rechazado"** en esta consulta; ambos casos devuelven el mismo código y el
mismo mensaje combinado. Esto explica por qué AC-02 del propio HU-07 ya pide un estado combinado
("No existe / Rechazado") — el texto de la historia coincide con el comportamiento real observado,
no es una interpretación nuestra.

**Decisión de diseño: `0420`/`0422` se mapean sobre el enum ya existente `SifenSubmissionStatus`
(HU-06), sin agregar un valor nuevo.** `0422` ("CDC encontrado") mapea a `APPROVED` (AC-01); `0420`
mapea a `REJECTED`, reutilizando el estado terminal más cercano en vez de crear un
"NOT_FOUND_OR_REJECTED" nuevo — no hay forma de distinguir más allá de eso con esta respuesta sola
(Hallazgo 3), así que un enum nuevo no agregaría precisión real. `0421` ("RUC Certificado sin
permiso") **no** se mapea a ningún estado de documento — es un error de configuración/autorización
del certificado que está consultando, no una respuesta sobre el documento en sí, así que
`SifenDocumentQueryClient` lo distingue explícitamente y lanza `SIFEN_QUERY_RUC_NOT_AUTHORIZED`
(403) en vez de tratarlo como "sin respuesta".

**Límite real encontrado (heredado de HU-06, no nuevo): AC-01/AC-03 (aprobación real + contenido
completo del documento) no se pudieron verificar en vivo.** Mismo motivo documentado en HU-06:
ningún documento de este sistema llegó nunca a estar realmente "Aprobado" en SIFEN (falta
`gCamFuFD/dCarQR`, trabajo de HU-08), así que no existe ningún CDC real que devuelva `0422` para
consultar. La forma interna de `xContenDE` para ese caso queda **inferida del XSD, no observada en
vivo** — el XSD real lo tipa como `xs:string` plano (no como XML estructurado, a diferencia de lo
que documenta el ContenedorDE del manual) y `SifenDocumentQueryClient` simplemente guarda ese string
tal cual llega, sin intentar extraer un `dProtAut` de adentro (que según el manual estaría anidado
ahí) — otra inconsistencia manual/schema-real que solo se podrá confirmar del todo cuando HU-08
permita obtener una aprobación real para consultar.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `service/SifenXmlUtils.java` (nuevo) — extrae `firstDescendant`/`firstDescendantText` (búsqueda
  por nombre local, ignorando namespace) de `SifenDocumentReceptionClient` a una clase compartida,
  reusada también por `SifenDocumentQueryClient` — evita duplicar el mismo parsing tolerante a
  namespace en dos clientes SOAP.
- `service/SifenQueryResult.java` (nuevo) — record `submissionResult` (reusa `SifenSubmissionResult`
  de HU-06) + `documentContent` (AC-03, `xContenDE` crudo).
- `service/SifenDocumentQueryClient.query(tenantId, cdc)` — arma `rEnviConsDeRequest`, lo postea vía
  `SifenConnectionService.buildAuthenticatedClient` (mismo mTLS que HU-05/HU-06), parsea
  `rEnviConsDeResponse` según los Hallazgos de arriba. Devuelve `Optional<SifenQueryResult>` — vacío
  si no hubo respuesta interpretable, nunca lanza para una falla de comunicación (mismo contrato que
  `SifenDocumentReceptionClient.send`).
- `domain/enums/SifenSubmissionStatus` — sin cambios (reusado, ver "Decisión de diseño" arriba).
- `domain/Invoice.java` — campo nuevo `sifenQueryDocumentContent` (AC-03, `NVARCHAR(MAX)`, mismo
  patrón que otras columnas de texto grande de SIFEN — no `@Lob`, ver comentario en
  `SifenCertificate.encryptedP12Base64`). Migración `V23__sifen_invoice_query.sql`.
- `service/SifenInvoiceSubmissionService`:
  - `checkPendingStatus(tenantId, invoiceId)` (AC-01/AC-02/AC-03/AC-04) — exige que la factura esté
    en `PENDING_VERIFICATION` (si no, `SIFEN_INVOICE_NOT_PENDING_VERIFICATION`, 409) y tenga un CDC
    persistido (si no, `SIFEN_INVOICE_MISSING_CONTROL_NUMBER`, 409), consulta vía
    `SifenDocumentQueryClient`, y si hay respuesta persiste el resultado reusando el mismo
    `recordResult` de HU-06 (ahora con un parámetro nuevo `documentContent` para AC-03). Si SIFEN
    sigue sin contestar, la factura queda intacta (sigue `PENDING_VERIFICATION`).
  - `submit(tenantId, invoiceId)` (AC-05) — al principio del método, si la factura ya está
    `PENDING_VERIFICATION`, llama a `checkPendingStatus` primero; si eso resuelve el estado (aprobado
    o rechazado), retorna sin reintentar el envío. Si SIFEN sigue sin contestar, sigue de largo con
    el flujo normal de (re)envío que HU-06 ya tenía — así un reintento nunca reenvía a ciegas un
    documento cuyo estado real ya se puede confirmar.
- `web/InvoiceController.checkSifenStatus` — `POST /api/invoices/{id}/sifen/check-status` (AC-04):
  llama a `checkPendingStatus` y devuelve el `InvoiceResponse` actualizado (estado sin cambios si
  SIFEN no contestó). `InvoiceResponse` ganó 6 campos nuevos (`sifenControlNumber`,
  `sifenSubmissionStatus`, `sifenSubmissionProtocolNumber`, `sifenSubmissionResultCode`,
  `sifenSubmissionMessage`, `sifenQueryDocumentContent`) — primera vez que el estado SIFEN de una
  factura se expone al frontend.

**Frontend** (`src/frontend/src/components/InvoiceDetailModal.tsx`): sección nueva "SIFEN status",
visible solo si la factura tiene `sifenSubmissionStatus` (es decir, si alguna vez se intentó
enviar a SIFEN — la inmensa mayoría de las facturas hoy no, ya que la activación real por tenant es
HU-22): badge de estado, número de control, número de trámite, mensaje de SIFEN, y — cuando el
estado es Aprobado/Aprobado con observación y hay contenido — el contenido completo del documento
en un bloque `<pre>` (AC-03). El botón "Check status in SIFEN" (AC-04) solo aparece si el estado es
`PENDING_VERIFICATION`; al hacer clic llama al endpoint nuevo y muestra si SIFEN contestó o si
sigue sin responder. Claves i18n nuevas bajo `femme.billing.history.detail.sifen.*` en `en.json` y
`es.json`, más 3 códigos de error nuevos en `femme.apiErrors.*`
(`SIFEN_INVOICE_NOT_PENDING_VERIFICATION`, `SIFEN_INVOICE_MISSING_CONTROL_NUMBER`,
`SIFEN_QUERY_RUC_NOT_AUTHORIZED`).

**Infraestructura de test-only nueva (gateada, nunca activa en producción):**
- `web/SifenInvoiceTestSupportController` — mismo patrón que `SeedResetController` (gateado con
  `@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")`, solo `true` en
  el profile `e2e`). Existe porque, igual que HU-06, **nada en la app llama todavía a
  `SifenInvoiceSubmissionService.submit()`** (la activación real por tenant es HU-22) — así que
  ninguna factura puede llegar a `PENDING_VERIFICATION` por uso real todavía, ni en producción ni en
  un checkout limpio. `POST /api/admin/sifen-test-support/invoices/{id}/prepare-for-status-check`
  fabrica esa precondición completa para Playwright: sube un certificado válido (fixture
  autofirmado `sifen/e2e-test-support-cert.p12`, RUC `12345678-9`, copiado a `src/main/resources`
  para estar en el classpath en runtime — mismo fixture que `SifenConnectionServiceTest` usa como
  `ruc-fixture.p12`), configura el RUC del negocio para que coincida, y marca la factura
  `PENDING_VERIFICATION` con un CDC de forma real. Ruta permitida sin autenticación en
  `SecurityConfig` (`/api/admin/sifen-test-support/**`), mismo criterio que `/api/admin/seed/reset`.
- `application-e2e.properties` — `app.femme.sifen.connection.test-base-url` apunta a
  `https://127.0.0.1:9` (puerto "discard") en vez del `sifen-test.set.gov.py` real: cualquier
  llamada de red SIFEN en e2e falla rápido por conexión rechazada localmente, en vez de depender de
  una llamada real a un servidor externo de gobierno (indeseable en CI). Esto es lo que hace que el
  botón de HU-07 AC-04 ejercite el código real (controller → service → query client → intento de
  conexión mTLS) de punta a punta en el test, terminando en "SIFEN no contestó" real (mismo modo de
  falla que HU-06 ya documentó, no un mock).

**Tests**: `SifenDocumentQueryClientTest` (7 casos: la respuesta real capturada en vivo como test de
regresión exacto para `0420`, `0422`/aprobado con contenido de documento inferido del XSD, `0421`
lanzando `SIFEN_QUERY_RUC_NOT_AUTHORIZED`, sin respuesta por servidor inalcanzable, sin respuesta
por cuerpo no-XML, sin respuesta ante la forma de error compartida con el servicio de recepción
(`rRetEnviDe`), estructura del sobre SOAP enviado). `SifenInvoiceSubmissionServiceTest` ganó 9 casos
nuevos (`checkPendingStatus` resolviendo Aprobado con contenido de documento, resolviendo
Rechazado, sin respuesta deja la factura intacta, rechaza si la factura no está pendiente, rechaza
si falta el número de control; `submit` resolviendo vía la consulta automática sin reintentar el
envío, y cayendo al reenvío normal si la consulta sigue sin contestar). **Con Playwright** —
primera vez, ya que AC-04 sí tiene pantalla propia:
`e2e/tests/sifen-hu-07-verificar-estado.spec.ts` (2 casos: el botón aparece solo para una factura
`PENDING_VERIFICATION` y una consulta real end-to-end contra el mecanismo de test-support deja la
factura pendiente porque SIFEN no contesta; una factura sin intento de envío a SIFEN no muestra la
sección). AC-01/AC-02/AC-05 (resolución a Aprobado/Rechazado, disparo automático en reintento) se
cubrieron con JUnit — no hay forma de alcanzar una aprobación real para probarla ni en backend ni en
e2e (mismo límite que arriba), y las ramas de "SIFEN contesta con estado X" son puramente lógica de
servicio, no de UI.

## HU-06 — Enviar una factura a SIFEN y registrar el resultado (Done)

Cierra la Fase 1: combina `SifenConnectionService` (HU-05) + `SifenDocumentSigningService` (HU-04)
para efectivamente enviar un documento y registrar lo que SIFEN responde. **Esta historia fue la
primera con verificación en vivo de punta a punta contra el ambiente de prueba real** (no solo
conectividad TLS como HU-05, sino un envío SOAP real con un documento firmado real) — ver
"Verificación en vivo" abajo para el procedimiento y los tres hallazgos que solo se podían descubrir
así, no leyendo el manual.

**Verificación en vivo (2026-07-28), procedimiento para reproducir:** se generó un documento firmado
real reutilizando los mismos datos de fixture que `SifenDocumentSigningServiceTest` (RUC piloto
`1137152-8`, timbrado `1137152`) pero con el `.p12` real (`requirements/sifen/*.p12`, gitignored) en
vez del fixture autofirmado, vía un test JUnit temporal (no commiteado) que llamaba directamente a
`SifenDocumentXmlService.buildDocument` + `SifenDocumentSigningService.sign` y volcaba el XML a un
archivo. Ese XML se envolvió a mano en un sobre SOAP y se envió con `curl --cert-type P12 --cert
archivo.p12:contraseña -X POST https://sifen-test.set.gov.py/de/ws/sync/recibe.wsdl`. Quien necesite
reverificar esto en el futuro (p.ej. tras tocar `SifenDocumentXmlService`/`SifenDocumentSigningService`)
puede repetir el mismo procedimiento — no quedó como test automatizado por la misma razón que HU-05
(el `.p12` real y su contraseña no están presentes en un checkout limpio ni en CI).

**Hallazgo 1 (el más importante): el endpoint real para POSTear no es la URL del WSDL.** El manual
(sección 7.10) solo publica la URL del WSDL (`.../de/ws/sync/recibe.wsdl?wsdl`, la que HU-05 ya usa
como chequeo de conectividad). Se obtuvo el WSDL real en vivo (mismo `curl`, sin `-X POST`) y su
propio `<soap12:address location="...">` apunta a esa misma URL **sin** el query string `?wsdl` —
`https://sifen-test.set.gov.py/de/ws/sync/recibe.wsdl`. `SYNC_RECIBE_PATH` en
`SifenDocumentReceptionClient` es literalmente eso.

**Hallazgo 2: el HTTP status code NO indica de forma confiable aprobado/rechazado.** Se probó en
vivo con tres cuerpos distintos: (a) SOAP con XML claramente mal formado → **HTTP 400**, cuerpo
`rRetEnviDe` con `dCodRes=0160 "XML Mal Formado."`; (b) SOAP bien formado pero con un `<DE>` vacío
(sin firma, sin casi ningún campo) → **HTTP 200**, cuerpo `rRetEnviDe` con `dCodRes=0160 "Firma
difiere del estándar..."`; (c) el documento firmado real completo (faltándole solo el grupo QR, ver
Hallazgo 3) → **HTTP 200**, cuerpo `rRetEnviDe` con 4 `gResProc` distintos, cada uno con su propio
error de schema. Es decir: **tanto 400 como 200 pueden traer un cuerpo `rRetEnviDe` perfectamente
parseable**, y SIFEN no reserva el código HTTP para señalar rechazo. Por eso
`SifenDocumentReceptionClient.send()` intenta parsear el cuerpo de la respuesta sin mirar el status
code — solo cae a "sin respuesta" (`Optional.empty()`, AC-05) si el cuerpo no es XML válido o la
conexión falla a nivel de transporte.

**Hallazgo 3: `dEstRes` no queda anidado dentro de `gResProc` como documenta el manual.** Tanto la
tabla de campos (sección 9.1.3, `Schema XML 4`, fila `PP050`) como el propio ejemplo de SOAP
resuelto del manual (sección 7.4) muestran `dEstRes` como hijo de `gResProc`. En los tres envíos
reales de arriba, `dEstRes` vino siempre como **hijo directo de `rProtDe`, hermano de `gResProc`** —
y `gResProc` puede repetirse (se observaron 4 en el caso (c), uno por cada error de validación de
schema), cada uno con su propio `dCodRes`/`dMsgRes`. `SifenDocumentReceptionClient` parsea buscando
`dEstRes`/`dProtAut`/`dCodRes`/`dMsgRes` por nombre local en cualquier punto del subárbol de
`rProtDe`, no asumiendo un anidamiento fijo — tolera ambas formas (la real y la documentada) sin
cambios.

**Un cuarto hallazgo, este sí en código propio (no en la respuesta de SIFEN): `xsi:schemaLocation`
mal formado.** El primer intento de envío del documento firmado real completo fue rechazado con
`dCodRes=0160 "No se informó el schema en el XML"`, **antes** de llegar a cualquier validación de
contenido. La causa: `SifenDocumentXmlService` (HU-04) generaba
`xsi:schemaLocation="http://ekuatia.set.gov.py/sifen/xsd/siRecepDE_v150.xsd"` (namespace y nombre de
schema concatenados con `/`) — así es como aparece en la mayoría de los ejemplos del manual (secciones
7.2.2.1/7.2.2.2), pero la convención estándar de XML Schema para `xsi:schemaLocation` es un **par
separado por espacio** (namespace URI, espacio, URI del documento de schema) — que es como aparece
en el ejemplo *anterior* del propio manual (sección 7.2.2). SIFEN exige el par separado por espacio,
no la forma concatenada — corregido en `SifenDocumentXmlService` a `SIFEN_NS + " siRecepDE_v150.xsd"`
(con espacio). **Esto corrige un bug real de HU-04** que ningún test unitario podía detectar (ningún
test de HU-04 asertaba sobre el valor de `schemaLocation`) — solo se encontró al enviar un documento
real contra el servidor real.

**Límite real encontrado: "Aprobado" no se pudo verificar en vivo durante esta historia.** Tras
corregir el Hallazgo 4, el envío del documento firmado real completo (con todos los datos de HU-02/
HU-03/HU-04 correctamente poblados) todavía fue rechazado por schema — el motivo relevante:
`"Elemento esperado: gCamFuFD dentro de: rDE"`. `gCamFuFD/dCarQR` (grupo J del manual, sección
"Campos fuera de la Firma Digital") es el código QR del comprobante, obligatorio en todo DE — y
calcular su hash es explícitamente trabajo de HU-08 (usa el CSC de "Configuración del ambiente de
pruebas", ver spec), no de HU-04/HU-06. Es decir: **ningún documento de este sistema puede llegar a
"Aprobado" real hasta que exista HU-08** — no es un bug de HU-06, es una dependencia real entre
historias que el plan de fases no hace explícita. Los otros 3 errores de esa misma respuesta
(`dFeFinT` inválido, `dDesUniMed` inválido, `dBasExe` faltante en `gCamIVA`) son gaps de compliance
de schema menores, dentro del alcance ya documentado como deliberadamente acotado por HU-04
("cerrar compliance total de schema es trabajo de homologación, HU-12..HU-17") — no se tocaron en
esta historia para no expandir su alcance; van a aparecer de nuevo en la homologación real.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `domain/enums/SifenSubmissionStatus.java` — `PENDING_VERIFICATION`/`APPROVED`/
  `APPROVED_WITH_OBSERVATION`/`REJECTED`. Los tres últimos mapean 1-1 desde el `dEstRes` literal de
  SIFEN (`"Aprobado"`/`"Aprobado con observación"`/`"Rechazado"`); `PENDING_VERIFICATION` es propio
  del sistema (AC-05), SIFEN no tiene ese estado.
- `domain/Invoice.java` — 6 campos nuevos: `sifenSignedAt` (primera fecha/hora de firma,
  persistida una sola vez — ver "Decisión de diseño" abajo), `sifenSubmissionStatus`,
  `sifenSubmissionProtocolNumber` (dProtAut), `sifenSubmissionResultCode` (dCodRes del primer
  `gResProc`), `sifenSubmissionMessage` (todos los `dMsgRes`, unidos con `"; "`),
  `sifenSubmittedAt` (momento de la última respuesta *real* recibida — permanece `null` mientras el
  estado sea `PENDING_VERIFICATION`, ver más abajo por qué eso importa para AC-07).
- Migración `V22__sifen_invoice_submission.sql`.
- `service/SifenDocumentReceptionClient.send(tenantId, signedXml)` — arma el sobre SOAP 1.2
  (`rEnviDe`/`dId`/`xDE`, sección 9.1.1), lo postea vía
  `SifenConnectionService.buildAuthenticatedClient(tenantId)` (mismo mTLS que HU-05, método nuevo
  que reutiliza la resolución de certificado + validación de RUC ya existente, expuesto para que
  AC-01 — "envía y espera la respuesta en la misma conexión" — sea literal), y parsea la respuesta
  según los Hallazgos 2/3 de arriba. Devuelve `Optional<SifenSubmissionResult>` — vacío si no hubo
  respuesta interpretable (AC-05), nunca lanza para una falla de comunicación. Una
  `ResponseStatusException` de resolver el certificado (sin certificado vigente, RUC no coincide)
  **sí** se propaga sin capturar — es un error de configuración, no de comunicación.
- `service/SifenInvoiceSubmissionService.submit(tenantId, invoiceId)` — orquestador. Dos
  transacciones separadas (no una sola envolviendo todo el método): la llamada de red puede tardar
  hasta 30s y no debe mantener abierta una transacción de base de datos mientras tanto.
  1. `prepareForSubmission` (transacción corta): AC-06 (ya Aprobado/Aprobado con observación →
     `SIFEN_INVOICE_ALREADY_APPROVED`, 409), resuelve/persiste `sifenSignedAt` la primera vez, AC-07
     (ver "Decisión de diseño" abajo).
  2. Firma (`SifenDocumentSigningService.signInvoice(tenantId, invoiceId, signedAt)`, nuevo overload
     de 3 argumentos — ver abajo) + envío (`SifenDocumentReceptionClient.send`), sin transacción
     abierta.
  3. `recordResult` (transacción corta): persiste el resultado; solo pisa `sifenSubmittedAt` si
     `responseReceived` es verdadero.
- `SifenDocumentSigningService.signInvoice` — nuevo overload de 3 argumentos
  (`signInvoice(tenantId, invoiceId, LocalDateTime signatureTimestamp)`); el de 2 argumentos ya
  existente delega a este con `now()`, sin romper ningún llamador existente (solo los tests de
  HU-04, que siguen pasando sin cambios).
- `SifenConnectionService.buildAuthenticatedClient(tenantId)` — nuevo método público, extrae la
  misma lógica de resolución de certificado + validación de RUC + construcción de `HttpClient` mTLS
  que `connect()` ya usaba internamente, para que `SifenDocumentReceptionClient` no duplique el
  handshake TLS.
- `SifenDocumentXmlService` — fix del Hallazgo 4 (`xsi:schemaLocation` con espacio, no `/`).

**Decisión de diseño clave: `sifenSignedAt` se persiste una sola vez y AC-07 se mide contra ese
instante fijo, no contra "ahora" en cada intento.** Sin esto, cada reintento de envío volvería a
firmar con la hora actual (`SifenDocumentSigningService.signInvoice(tenantId, invoiceId)` de 2
argumentos siempre usaba `now()`), y la ventana de 72 horas del manual ("La transmisión del DE
firmado digitalmente contempla un plazo de hasta 72 horas posteriores a la firma digital", sección
7.x) nunca podría vencerse — el propio código estaría re-firmando con una fecha siempre fresca. El
overload de 3 argumentos existe exactamente para que el orquestador controle ese instante.

**Decisión de diseño: AC-07 solo bloquea si la factura nunca recibió una respuesta real antes
(`sifenSubmittedAt == null`), no simplemente "no fue Aprobada".** El criterio dice literalmente "sin
haber sido enviada antes" — se interpretó como "sin haber recibido nunca una respuesta real de
SIFEN", no "sin haber sido aprobada" (eso ya lo cubre AC-06 aparte). Consecuencia: una factura
`REJECTED` o `APPROVED_WITH_OBSERVATION` que se reintenta mucho después de las 72h **no** queda
bloqueada por AC-07 — solo una que quedó en `PENDING_VERIFICATION` (nunca hubo respuesta) y que se
intenta reenviar directamente en vez de usar HU-07 (verificar estado) sigue bloqueada indefinidamente
tras vencer la ventana. Esto empuja al operador hacia el flujo correcto (verificar antes de
reintentar a ciegas) sin impedir corregir y reenviar una factura rechazada.

**Frontend**: ninguno. Ninguna AC de HU-06 pide un disparador manual (a diferencia de HU-07 AC-04,
que sí pide un botón) — mismo patrón que HU-01/02/03/04/05/21: capacidad de servicio sin pantalla,
consumida por historias futuras. La activación real por tenant y el enrutamiento desde el flujo
normal de emisión de facturas son HU-22 (Fase 5), que todavía no existe.

**Tests**: `SifenDocumentReceptionClientTest` (7 casos, mismo patrón de `HttpsServer` local que
`SifenConnectionServiceTest`: rechazo con un solo `gResProc`, rechazo con múltiples `gResProc` unidos
en un solo mensaje, aprobado con número de trámite, aprobado con observación, sin respuesta por
servidor inalcanzable, sin respuesta por cuerpo no-XML, estructura del sobre SOAP enviado). Los
cuerpos de respuesta usados en los tests son copias literales de lo observado en vivo (Hallazgos
2/3), no inventados. `SifenInvoiceSubmissionServiceTest` (11 casos: los tres estados de SIFEN
persistidos correctamente, pendiente de verificación sin pisar `sifenSubmittedAt`, AC-06 para
Aprobado y para Aprobado con observación, AC-07 bloqueando y permitiendo según los 72h, AC-07 no
bloqueando un reintento que ya tuvo respuesta antes aunque esté vencido, `sifenSignedAt` persistido
una sola vez y reutilizado en un segundo intento, factura no encontrada). **Sin Playwright** — mismo
precedente que HU-01/02(salvo AC-05)/03/04/05/21: ninguna AC de HU-06 tiene pantalla propia que
ejercitar.

## HU-04 — Firmar digitalmente el documento (Done)

Cierra el Frente B de la Fase 1: combina `SifenInvoiceHeader` (HU-02) + `SifenInvoiceDetail`
(HU-03) en el XML real del documento electrónico y lo firma con XML-DSig.

**Hallazgo clave (Manual Técnico V150.pdf, secciones 7.6/7.7, esta vez extraíble con
`pdftotext -layout` sin renderizar imágenes):** el estándar de firma es un subconjunto de XML
Digital Signature (W3C), formato **Enveloped**, con una particularidad: `<Signature>` no queda
anidado dentro de `<DE>` sino como su **hermano** dentro de `<rDE>` (`<rDE><dVerFor/><DE Id="cdc">
...</DE><Signature>...</Signature></rDE>`), y el `Reference` apunta a `<DE>` vía
`URI="#{cdc}"` usando el atributo `Id`. Algoritmos exigidos (tabla "Schema XML 1"): canonicalización
de `SignedInfo` = C14N **estándar** (no exclusive) `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`;
`SignatureMethod` = `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`; transforms del `Reference` =
`enveloped-signature` + C14N **exclusive** `http://www.w3.org/2001/10/xml-exc-c14n#`; `DigestMethod`
= `http://www.w3.org/2001/04/xmlenc#sha256`. El manual también prohíbe explícitamente incluir
`X509SubjectName`/`X509IssuerSerial`/`X509IssuerName`/`X509SKI`/`KeyValue`/`RSAKeyValue` en
`KeyInfo` — solo `X509Data > X509Certificate`, porque esa información ya está implícita en el
certificado.

**Decisión técnica: `javax.xml.crypto.dsig` (JSR 105), sin dependencia nueva.** Es parte del JDK
desde Java 6. Sus constantes nombradas (`SignatureMethod.RSA_SHA256`, `DigestMethod.SHA256`,
`Transform.ENVELOPED`, `CanonicalizationMethod.EXCLUSIVE`/`INCLUSIVE`) coinciden **exactamente**
con las URIs de la tabla del manual — confirma que JSR 105 es la vía estándar para esto, no hay
que reconstruir XML-DSig a mano.

**El schema real del DE (`DE_v150.xsd`, sección "Tabla de formato de campos") sí es extraíble como
texto** (secciones B/C/D/D2/D2.1/D3/E1/E7/E7.1/E8/E8.1/E8.1.1/E8.2/F) — se usó para mapear cada
campo ya modelado por HU-02/HU-03 a su nombre de elemento XML real (`dRucEm`, `gCamItem`, etc.), no
solo su ID (`D101`, `E701`). **Alcance deliberadamente acotado**: `SifenDocumentXmlService` cubre
todo lo que el modelo de dominio ya tiene, con constantes fijas donde este negocio solo tiene un
valor posible (moneda `PYG`, impuesto `IVA`, tipo de transacción "Prestación de servicios",
indicador de presencia "Operación presencial", condición de pago "Contado" ya fijada por HU-03) —
grupos que no aplican a una venta al contado de una peluquería (D2.2 responsable, E7.1.1 tarjeta,
E7.1.2 cheque, E7.2 crédito, E9.x sectores, E10 transporte, G, H) quedan fuera. Nada de esto bloquea
el objetivo real de HU-04 (firmar lo que sea que se construya) — cerrar compliance total de schema
es trabajo de homologación (HU-12..HU-17), no de esta historia.

**Gap nuevo encontrado y cerrado: el emisor no tenía departamento/ciudad.** `D111/cDepEmi` y
`D115/cCiuEmi` (códigos numéricos del catálogo DNIT) son 1-1 (obligatorios) en el DE, y
`BusinessProfile` no tenía ningún campo para esto (a diferencia del receptor, que ya tiene
`department`/`city` como texto libre desde HU-02). Se agregaron 4 columnas nuevas
(`sifen_department_code/name`, `sifen_city_code/name`, migración V21) + validación en
`SifenInvoiceHeaderService.requireIssuerDataComplete` (`SIFEN_ISSUER_LOCATION_NOT_CONFIGURED`).
También se agregó una validación que faltaba para `dTelEmi`/`dEmailE` (D117/D118, también 1-1):
`BusinessProfile.phone`/`contactEmail` ya existían como columnas pero no se validaban como
obligatorios (`SIFEN_ISSUER_CONTACT_INFO_MISSING`). **Gap conocido y no cerrado (heredado de
HU-02, no un problema nuevo):** el receptor sigue sin códigos de departamento/ciudad — cuando su
dirección está presente, el DE solo emite `dDirRec`, sin `cDepRec`/`cCiuRec` (que el manual exige
solo si `dDirRec` está informado). No bloquea la firma; si bloquea el envío real es cosa de HU-06.

**`SifenControlNumberService.parse()` (nuevo, inverso de `build()`):** `SifenInvoiceHeader` solo
guarda el CDC ya armado (44 caracteres), no los 10 campos que lo componen — para reconstruir
`B002/iTipEmi`, `B004/dCodSeg`, `C002/iTiDE`, `C005/dEst`, `C006/dPunExp`, `C007/dNumDoc` (todos
también necesarios como elementos propios del DE, no solo embebidos en el CDC) se agregó `parse()`,
con offsets fijos según la tabla de HU-01 (10.1). Probado contra el mismo ejemplo resuelto del
manual usado por `build()` (inverso exacto) y con un round-trip `build(parse(cdc)) == cdc`.

**Dos campos nuevos en `SifenInvoiceHeader`:** `issueDateTime` (D002/dFeEmiDE necesita fecha+hora
completas; HU-02 solo derivaba la fecha para el CDC) y `stampValidFrom`/`stampValidUntil`
(C008/dFeIniT y C009/dFeFinT, tomados de `FiscalStamp.validFrom/validUntil`, que ya existían pero
no se exponían en el header).

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`):
- `SifenDocumentXmlService.buildDocument(header, detail, cdcFields, signatureTimestamp)` — arma el
  DOM completo (`org.w3c.dom.Document`) del `<rDE>` sin firmar. `signatureTimestamp` lo pasa quien
  va a firmar (no quien arma el XML), porque A004/dFecFirma es "fecha de la firma", no "fecha de
  construcción del XML" — ver siguiente punto.
- `SifenDocumentSigningService`:
  - `sign(SifenActiveCertificateMaterial, Document, LocalDateTime signedAt)`: firma con JSR 105 tal
    cual el algoritmo de la sección 7.6/7.7, usando `DOMSignContext.setIdAttributeNS(deElement,
    null, "Id")` para que el `Reference URI="#cdc"` resuelva sin depender de un DTD/schema que
    declare `Id` como atributo ID (necesario porque el DOM se arma a mano, no se parsea de un
    archivo con esquema).
  - `verify(Document)`: valida usando **solo lo que trae el propio documento firmado** — un
    `KeySelector` interno extrae la clave pública directamente del `X509Certificate` embebido en
    `KeyInfo` (no recibe la clave desde afuera). Esto es lo que hace la verificación "independiente"
    (AC-05): cualquiera con el XML firmado puede validarlo, no solo el proceso que lo firmó.
  - `signInvoice(tenantId, invoiceId)`: orquestador — resuelve el certificado **primero**
    (`SifenCertificateService.requireActiveCertificate`, HU-21) antes de tocar `SifenInvoiceHeaderService`/
    `SifenInvoiceDetailService`, así que si no hay certificado vigente, no se arma nada del
    documento (AC-02: "no firma... antes de intentar enviarlo"). Revocación sigue sin chequeo
    propio (no hay CRL/OCSP implementado) — mismo gap ya documentado en HU-05 AC-03.
  - AC-03 (alteración detectable) es una consecuencia directa de cómo funciona XML-DSig, no código
    propio: cualquier cambio al contenido de `<DE>` después de firmar cambia el digest y
    `verify()` devuelve `false` — probado explícitamente mutando un nodo de texto post-firma.
  - AC-04 (nivel de firma vigente, no obsoleto): los algoritmos están fijos por código
    (RSA-SHA256, nunca SHA-1) — no hay configuración que permita degradarlos.
- `SifenSignedDocument` (record `document`/`controlNumber`/`signedAt`) — resultado de firmar; su
  XML final para HU-06 sale de `SifenDocumentXmlService.serialize(signed.document())`.
- `BusinessProfile`/`SifenIssuerData`/`SifenInvoiceHeaderService`/`BusinessProfileService`/
  `BusinessProfileUpdateRequest`/`BusinessProfileResponse` — extendidos con los 4 campos de
  ubicación del emisor (ver "Gap nuevo" arriba). Sin UI propia todavía en `BusinessSettingsPage`
  — mismo patrón de deuda técnica ya dejado por HU-02 para `taxpayerType`/`economicActivityCode`;
  se puede cerrar junto con esos 3 campos en una sola extensión del formulario existente.

**Frontend**: ninguno — igual que HU-01/HU-03/HU-05/HU-21, sin pantalla propia (capacidad de
servicio consumida por HU-06).

**Tests**: `SifenDocumentXmlServiceTest` (8 casos: estructura rDE/DE, mapeo de emisor, leyenda de
ambiente de prueba, receptor con cédula, receptor anónimo/innominado, ítems, pagos).
`SifenDocumentSigningServiceTest` (7 casos: firma+verificación válida end-to-end con el fixture
`test-cert.p12` real de HU-18, detección de alteración post-firma (AC-03), verificación de un
documento sin firmar, algoritmos exigidos por el manual presentes en el XML serializado (AC-04),
`KeyInfo` sin los elementos prohibidos, rechazo sin certificado vigente sin llegar a construir el
documento (AC-02), firma end-to-end vía el orquestador `signInvoice`). 3 casos nuevos en
`SifenControlNumberServiceTest` (`parse`). 4 casos nuevos en `SifenInvoiceHeaderServiceTest`
(contacto/ubicación del emisor, `issueDateTime`). **Sin Playwright** — mismo precedente que
HU-01/HU-03/HU-05/HU-21: ninguna AC de HU-04 tiene pantalla propia que ejercitar (firma XML-DSig
interna, no hay flujo de UI que la dispare todavía — eso es HU-06).

## HU-05 — Conectarse de forma segura con SIFEN (Done)

**La pieza más importante de esta historia fue de investigación, no de código** — quedó
completamente verificada en vivo contra el ambiente de prueba real de SIFEN, con un certificado
real. Ver "Certificado real y verificación en vivo" más abajo para cómo reproducirlo.

**Hallazgos técnicos (Manual Técnico V150.pdf + verificación en vivo):**
- URLs reales de los WSDL (sección 7.10 del manual, tabla "Resumen de las Direcciones
  Electrónicas..."): producción en `https://sifen.set.gov.py/de/ws/...`, prueba en
  `https://sifen-test.set.gov.py/de/ws/...`. El manual tiene una **errata**: la URL de prueba del
  servicio síncrono de recepción figura como `recibe.wsd?wsdl` (falta la "l" final) — verificado en
  vivo que el path real es `recibe.wsdl?wsdl`, igual que producción.
- TLS 1.2 con **autenticación mutua obligatoria** (sección 7.9) — confirmado en vivo: el servidor
  real manda `Request CERT` durante el handshake TLS.
- Comportamiento real ante una conexión sin certificado válido: el handshake TLS se completa
  igual (el servidor no lo corta a ese nivel), pero la capa de aplicación (un gateway F5 BIG-IP)
  responde `HTTP 302` con `Location: /vdesk/hangup.php3` en vez de servir el WSDL. Con el
  certificado real, correcto: `HTTP 200`, `Content-Type: text/xml`, cuerpo = WSDL real de
  `rEnviDe`. Esta es la señal que usa `SifenConnectionService` para distinguir éxito de rechazo —
  **no** se basa en capturar una excepción TLS.
- El RUC del contribuyente va embebido en el certificado como una entrada `directoryName` dentro de
  `Subject Alternative Name`, con el atributo `serialNumber` (OID `2.5.4.5`) conteniendo
  `RUC<valor>`. Importante: la API de Java (`X509Certificate.getSubjectAlternativeNames()`) **no**
  resuelve ese OID a un nombre amigable — lo devuelve como texto crudo
  `2.5.4.5=#<hex DER>`, que hay que decodificar a mano (tag DER + longitud + contenido
  PrintableString/UTF8String). Verificado con el certificado real: RUC extraído = `1137152-8`,
  coincide exactamente con el Timbrado `1137152` de la sección "Configuración del ambiente de
  pruebas" del spec.

**Backend**:
- `config/SifenConnectionProperties.java` (prefijo `app.femme.sifen.connection`) — enum
  `Environment{TEST,PRODUCTION}` + URL base por ambiente (AC-04: cambiar de ambiente es 100%
  configuración, cero código).
- `service/SifenConnectionResult.java` — record con el ambiente usado + timestamp; HU-02 (AC-08,
  leyenda de "sin valor comercial") y HU-06 van a necesitar saber en qué ambiente se conectó.
- `service/SifenConnectionService.connect(tenantId)`:
  1. Resuelve el certificado activo vía `SifenCertificateService.requireActiveCertificate` (HU-21).
  2. **AC-02, antes que nada**: extrae el RUC del certificado y lo compara con
     `BusinessProfile.ruc` del tenant — si no coincide (o cualquiera de los dos falta), rechaza
     con `SIFEN_CERT_RUC_MISMATCH` **sin intentar ninguna conexión de red**.
  3. Arma un `SSLContext` TLSv1.2 con `KeyManagerFactory` (identidad cliente = el certificado del
     tenant) y `TrustManager` por defecto (confía en la CA real del servidor de SIFEN —
     DigiCert — sin necesidad de trust store custom).
  4. Hace `GET` al WSDL de recepción síncrona con `java.net.http.HttpClient`; `200` = éxito,
     cualquier otra cosa (incluida una excepción de red/TLS) = `SIFEN_CONNECTION_REJECTED`.
  5. Loguea cada intento (INFO en éxito, ERROR en rechazo) con tenantId/ambiente/certificateId —
     ver "Decisión: AC-05 sin tabla nueva" abajo.
- **AC-03 (CA no habilitada) quedó deliberadamente sin validación propia** — por decisión del
  usuario ("RUC check now, defer PSC trust store"), ese chequeo lo termina haciendo el propio
  servidor de SIFEN al validar el certificado del cliente en el handshake/gateway (ya verificado en
  vivo: un certificado autofirmado nuestro también cae en el mismo `302 → /vdesk/hangup.php3`).
  Pendiente si se quiere una validación propia más temprana: conseguir el bundle de raíces PSC
  habilitadas (`https://www.acraiz.gov.py/html/Certif_1PrestaServ.html`) y agregar un
  `TrustManager` adicional solo para ese chequeo.
- **Decisión: AC-05 sin tabla nueva.** "Queda registrado" se interpretó como logs estructurados
  INFO/ERROR (ya exigidos por CLAUDE.md para todo request), no una tabla de auditoría persistida —
  a diferencia de HU-18 AC-09/HU-22 AC-05, ninguna pantalla necesita listar intentos de conexión
  históricos. Si en algún momento se decide que sí hace falta (p.ej. para el reporte de HU-12), es
  un cambio aislado: envolver `connect()` en un `SifenConnectionAttempt` persistido.
- Sin endpoint HTTP propio ni pantalla — igual que HU-21, es una capacidad de servicio consumida
  por historias futuras (HU-06 va a llamar a `connect()` antes de enviar).

**Tests** (`SifenConnectionServiceTest`, `SifenConnectionPropertiesTest`, 10 casos): usan un
`com.sun.net.httpserver.HttpsServer` local (JDK, sin dependencia nueva) haciendo de "SIFEN falso",
reproduciendo exactamente el `200`/`302→hangup` observado en vivo — así la lógica de clasificación
se prueba de verdad, no solo el cableado. Se agregó `connect(tenantId, TrustManager[])` (paquete-
privado, solo para tests) para poder apuntar la confianza TLS al certificado del servidor mock en
vez del trust store por defecto de la JVM. Fixture nuevo: `sifen/ruc-fixture.p12` (autofirmado,
generado con `openssl req -x509 ... -config <archivo con subjectAltName = dirName:...,
IP:127.0.0.1, DNS:localhost>` — keytool **no** soporta generar un SAN `directoryName`, solo
`EMAIL/URI/DNS/IP/OID`), contraseña `TestPass123!`, RUC embebido `12345678-9` — permite probar
tanto la extracción de RUC como el camino feliz completo sin usar el certificado real. Las
entradas IP/DNS son necesarias para que la verificación de hostname de Java no falle al conectar a
`127.0.0.1` en el test.

**Certificado real y verificación en vivo (no es parte de la suite automatizada):**
- El usuario proveyó el certificado real del tenant piloto: `.p12`, CSR, certificado emitido, y la
  cadena de CA (raíz de Paraguay + intermedia de **VIT S.A.**, una PSC real que opera como
  eFirma.com.py) en una carpeta `temp/` en la raíz del repo. **Esa carpeta y cualquier `*.p12` bajo
  `requirements/sifen/` están gitignored** (`/temp/.gitignore` en la raíz, `requirements/sifen/.gitignore`)
  — nunca deben terminar en un commit. La contraseña confirmada está en
  `requirements/sifen/.secrets/lucia-cert-password.txt` (gitignored, permisos 600) — **nunca
  transcribir su valor en un archivo que se commitee**, ni siquiera en este mismo documento.
- Con ese certificado real, se verificó en vivo (vía `curl --cert-type P12 --cert
  archivo.p12:contraseña`) una conexión mTLS exitosa contra `sifen-test.set.gov.py`: `HTTP 200`,
  WSDL real de `rEnviDe` en el cuerpo. Con el fixture autofirmado del repo (`test-cert.p12`), la
  misma URL responde `302` al `/vdesk/hangup.php3` — la prueba viva de que un certificado no
  emitido por una PSC habilitada es rechazado (AC-03), y de que uno válido conecta (AC-01).
- **Esto no se automatizó como test JUnit/Playwright** porque (a) el `.p12` real y su contraseña
  nunca están presentes en un checkout limpio ni en CI (están gitignored a propósito), y (b) un
  test de la suite estándar no debería depender de conectividad real a un servidor externo de un
  gobierno. Si se necesita re-verificar en el futuro (p.ej. después de tocar
  `SifenConnectionService`), repetir el comando `curl` de arriba manualmente con el `.p12` real ya
  presente en `requirements/sifen/`.
- Nota para cuando haga falta reusar este certificado real desde la app en sí (no desde `curl`):
  el RUC embebido es `1137152-8`; el `BusinessProfile` del tenant demo (id=1) no tiene RUC
  configurado por el seed (`FemmeDataInitializer`), así que habría que configurarlo a `1137152-8`
  en Configuración → Negocio antes de que `SifenConnectionService` acepte ese certificado para ese
  tenant.

## HU-01 — Generar el número de control de una factura (Done)

Frente B de la Fase 1 (en paralelo con HU-05, ya cerrado). Lógica pura, sin persistencia ni red —
tal como anticipaba la nota dejada en la iteración anterior de este documento.

**Hallazgo clave (Manual Técnico V150.pdf, sección 10.1/10.2):** el texto extraído por
`pdftotext` **no** incluye la tabla "Conformación del CDC" ni el ejemplo resuelto — ambos son
imágenes incrustadas en la página 57 del PDF (página impresa 56), invisibles a una búsqueda de
texto plano. Hubo que renderizar esa página a PNG (`pdftoppm`) y leerla visualmente para obtener la
estructura real de los 44 caracteres. Quien retome esta integración y necesite releer el capítulo
10 del manual: **no confiar en un grep sobre el texto extraído para las secciones con tablas**,
renderizar la página como imagen primero.

**Estructura del CDC** (11 campos concatenados, 44 caracteres exactos):

| # | Campo | Origen | Longitud |
|---|---|---|---|
| 1 | Tipo de Documento (iTiDE) | parámetro | 2 |
| 2 | RUC del Emisor sin DV (dRucEm) | parámetro | 8 |
| 3 | DV del RUC del Emisor (dDVEmi) | parámetro | 1 |
| 4 | Establecimiento (dEst) | parámetro | 3 |
| 5 | Punto de Expedición (dPunExp) | parámetro | 3 |
| 6 | Número de Documento (dNumDoc) | parámetro | 7 |
| 7 | Tipo de Contribuyente (iTipCont) | parámetro | 1 |
| 8 | Fecha de Emisión, formato AAAAMMDD (dFeEmiDE) | parámetro | 8 |
| 9 | Tipo de Emisión (iTipEmi) | parámetro | 1 |
| 10 | Código de Seguridad (dCodSeg) | generado/persistido por el llamador | 9 |
| 11 | Dígito Verificador del CDC | calculado | 1 |

**Algoritmo del dígito verificador (módulo 11):** confirmado combinando el manual (que solo dice
"se debe utilizar el módulo 11" y linkea a un PDF de la SET que hoy redirige al home de la DNIT,
ya no sirve el documento) con el ejemplo numérico resuelto del propio manual (RUC `44444401`,
DV `7`, establecimiento `001`, punto expedición `001`, documento `0014528`, tipo contribuyente `2`,
fecha `20170125`, tipo emisión `1`, código de seguridad `587326098` → CDC completo
`01444444017001001001452822017012515873260988`, es decir DV del CDC = `8`) y con la documentación
pública sobre el algoritmo de dígito verificador de RUC paraguayo (mismo algoritmo, confirmado por
[varias fuentes de la comunidad](https://gist.github.com/zrkb/747866c47f47762989caf0fa7707160b)):
pesos cíclicos 2..11 aplicados de derecha a izquierda (el dígito más a la derecha se multiplica por
2, el siguiente por 3, ..., al llegar a 11 se reinicia en 2), `resto = suma % 11`,
`DV = resto > 1 ? 11 - resto : 0`. Se usó el ejemplo del manual como test de regresión exacto
(`build_matchesManualsWorkedExample`) — es el ancla más fuerte posible porque el resultado no fue
derivado por nosotros, viene impreso en el propio documento oficial.

**Curiosidad del algoritmo (no es un bug, es así como lo define SET):** el peso 11 aporta 0 al
módulo 11 (`11 % 11 = 0`), así que el dígito que cae exactamente en la posición de peso 11 dentro
de los 43 caracteres (posiciones 10, 20, 30 y 40 contando desde la derecha) puede alterarse sin que
cambie el dígito verificador. Con el orden de campos de esta implementación, la posición de peso 11
más relevante cae exactamente sobre `iTipEmi` (tipo de emisión): cambiarlo de `1` a `2` no altera
el DV. Esto es una propiedad del algoritmo oficial, no algo que debamos "arreglar" — SIFEN valida
con este mismo algoritmo.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/service/`, siguiendo la convención
plana `Sifen*` ya establecida, sin subpaquete):
- `SifenControlNumberFields.java` — record con los 10 campos de entrada (sin padear), documentado
  campo por campo con su ID SIFEN (`C002/iTiDE`, `D101/dRucEm`, etc.) para que HU-02 pueda mapear
  directamente contra el manual al completarlos.
- `SifenControlNumberService.java` — sin dependencias (no es `@Transactional` ni usa repositorios):
  - `build(fields)`: arma los 43 caracteres base (zero-pad AC-03) + dígito verificador (AC-01).
  - `isValid(cdc)`: recalcula el DV de los primeros 43 caracteres y lo compara contra el 44°
    (AC-02) — pensado para reutilizarse en HU-07/HU-09 (verificar/revalidar por CDC).
  - `generateSecurityCode(documentNumber)`: `SecureRandom` de 9 dígitos, reintenta si coincide
    numéricamente con `documentNumber` (AC-04) en vez de confiar en la baja probabilidad de
    colisión entre un espacio de 9 dígitos y uno de 7.
- **Decisión de diseño para AC-06 (determinismo):** `build()` es una función pura — no genera el
  código de seguridad internamente, lo recibe ya resuelto en `fields.securityCode()`. Esto hace que
  llamar a `build()` dos veces con los mismos datos sea trivialmente determinista, pero traslada la
  responsabilidad de persistir y reutilizar el código de seguridad de cada factura ya procesada a
  quien la llame — todavía no existe ese llamador (es HU-02, que construye el documento completo).
  Ver la nota de "Próximo paso" al inicio de este documento sobre dónde probablemente deba
  persistirse ese código de seguridad.
- Sin endpoint HTTP ni pantalla — igual que HU-21, es una capacidad de servicio consumida por
  historias futuras (HU-02 en particular).

**Tests** (`SifenControlNumberServiceTest`, 9 casos): incluye el ejemplo resuelto del manual como
test de regresión exacto, padding de RUC/número de documento cortos (AC-03), unicidad del código de
seguridad frente al número de documento (AC-04, 200 iteraciones × 3 números de documento distintos),
CDCs distintos para facturas distintas (AC-05), determinismo (AC-06), detección de alteración
(AC-02, alterando un dígito fuera de las posiciones de peso 11 para garantizar que sí se detecta), y
rechazo de valores que no entran en su campo (p.ej. un RUC de 9 dígitos).

## HU-02 — Completar los datos de identificación, timbrado, emisor y receptor (Done)

Frente B de la Fase 1, siguiente paso después de HU-01. A diferencia de HU-01, esta historia sí
tocó el modelo de dominio existente — ver "Decisión de diseño clave" abajo para por qué el resultado
**no** quedó conectado al flujo real de emisión de facturas todavía.

**Hallazgo clave del manual (Manual Técnico V150.pdf):** la leyenda obligatoria de "ambiente de
prueba" (AC-08) no es un campo aparte — es una regla de validación sobre **D105/dNomEmi** (nombre o
razón social del emisor): en ambiente de prueba, ese campo debe contener literalmente
`"DE generado en ambiente de prueba - sin valor comercial ni fiscal"` **en vez de** la razón social
real, y en producción el uso de ese mismo texto está prohibido (sección "Campos que describen la
actividad económica del emisor" + tabla de validaciones, ambas fuera del texto plano de
`pdftotext` — hubo que grepear alrededor de "sin valor comercial" para encontrarlas). También se
confirmó que la actividad económica del emisor es un grupo `gActEco` con dos campos (`cActEco`
código + `dDesActEco` descripción, D131/D132), no un único campo libre.

**Decisión de diseño clave: `SifenInvoiceHeaderService` no se llama desde
`InvoiceService.issueInvoice`.** AC-01/02/03/04/06/07/08 (armar CDC + timbrado + emisor + receptor)
quedaron implementadas en un servicio nuevo, `SifenInvoiceHeaderService`, pero **deliberadamente
desconectado** del flujo real de emisión — igual que HU-01/HU-05/HU-21 ("sin pantalla propia,
consumida por historias futuras"). La razón, a diferencia de esas tres: exigir RUC válido +
actividad económica + tipo de contribuyente completos en `BusinessProfile` **en cada factura**
habría roto la emisión de **cualquier** tenant que hoy no usa SIFEN (que es literalmente todos,
salvo el piloto) — la activación real por tenant es HU-22 (Fase 5), que todavía no existe. Conectar
`SifenInvoiceHeaderService.buildHeader()` al flujo real de emisión queda pendiente para cuando HU-04
(firma) o HU-06 (envío) necesiten consumirlo — en ese punto también hará falta decidir el
enrutamiento correcto (¿llamarlo solo si el tenant tiene SIFEN activo? eso todavía no existe).

**La única AC de HU-02 que sí es una regla de negocio universal (no específica de SIFEN) es AC-05**
(el umbral de Gs. 7.000.000 exige identificar al cliente) — es una obligación de la DNIT sobre
cualquier factura con RUC, no algo exclusivo del documento electrónico. Por eso, a diferencia del
resto de la historia, **sí quedó conectada** a `InvoiceService.issueInvoice` (después de calcular
`total`, antes de validar los pagos): si `total >= 7.000.000` y ni el cliente vinculado ni el
override de la factura tienen RUC o documento de identidad, rechaza con
`SIFEN_CLIENT_IDENTIFICATION_REQUIRED` (400). Se verificó que ningún test e2e existente emite
facturas por ese monto (`grep` sobre montos de 7+ dígitos en `e2e/`), así que la regla no tiene
efectos colaterales sobre la suite ya existente — confirmado corriendo `hu-14`, `hu-15`, `hu-10`,
`hu-12`, `hu-02b`, `issue-96`, `issue-101`, `sifen-hu-18` y `sifen-hu-20` completos (47/47 verde).

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `domain/enums/SifenTaxpayerType.java` — `INDIVIDUAL`(1)/`LEGAL_ENTITY`(2), mapea a D103/iTipCont.
- `domain/FiscalStamp.java` — nuevos campos `establishment`/`expeditionPoint` (`int`, default 1 =
  "001" al zero-padear). **Default deliberado en 1**: coincide con el valor real que la SET dio para
  el piloto (Establecimiento `001`, primer Punto de expedición `001` de la lista `001, 002, 003` en
  la sección "Configuración del ambiente de pruebas" del spec) — el piloto no necesita tocar estos
  campos para que HU-02 ya sea correcta para él.
- `domain/BusinessProfile.java` — nuevos campos `taxpayerType` (enum, nullable),
  `economicActivityCode`/`economicActivityDescription` (String, nullable). **Sin UI propia
  todavía** — ver "Deuda técnica" abajo.
- `domain/Client.java` — nuevos campos `identityDocumentNumber` (cédula, para AC-05/AC-04),
  `address`/`department`/`city` (AC-07). **`department`/`city` son texto libre, no validan contra
  la tabla de códigos DNIT** (departamento/distrito/ciudad tienen relación cruzada exigida por el
  manual vía códigos oficiales) — decisión deliberada de no construir ese catálogo todavía, ya que
  ningún AC de HU-02 exige validarlo, solo "incluirlo".
- `domain/Invoice.java` — `clientIdentityDocumentOverride` (simétrico a `clientRucOverride`, para
  un cliente ocasional sin `Client` guardado), `sifenControlNumber`/`sifenSecurityCode` (persistidos
  la primera vez que se arma el header, para que HU-01 AC-06 se cumpla de punta a punta si
  `buildHeader()` se llama más de una vez para la misma factura).
- Migración `V19__sifen_document_fields.sql`.
- `util/ParaguayRucValidator.split(ruc)` — nuevo, separa RUC en base + dígito verificador (`record
  RucParts`), reutilizado tanto para el emisor como potencialmente para clientes con RUC.
- `service/SifenIssuerData.java` / `SifenReceiverData.java` / `SifenInvoiceHeader.java` — records
  nuevos que modelan el documento parcial.
- `service/SifenInvoiceHeaderService.buildHeader(tenantId, invoiceId)` — arma el header completo;
  ver "Decisión de diseño clave" arriba sobre por qué no está conectado a `issueInvoice`. Valida que
  `BusinessProfile` tenga RUC válido + tipo de contribuyente + actividad económica completos, si no
  rechaza con `SIFEN_ISSUER_RUC_INVALID`/`SIFEN_TAXPAYER_TYPE_NOT_CONFIGURED`/
  `SIFEN_ECONOMIC_ACTIVITY_NOT_CONFIGURED` (`PRECONDITION_FAILED`).
- `InvoiceService.issueInvoice` — nueva validación AC-05 (ver arriba) + persiste
  `clientIdentityDocumentOverride` igual que ya hacía con `clientRucOverride`.
- **Compatibilidad de los DTOs existentes**: `ClientRequest`, `BusinessProfileUpdateRequest`,
  `FiscalStampCreateRequest` e `InvoiceCreateRequest` son `record`s a los que se les agregaron
  campos nuevos — para no reescribir cada test/caller existente que construye estos records con la
  aridad vieja, cada uno ganó un constructor auxiliar que delega al canónico pasando `null` en los
  campos nuevos. Convención a seguir si una futura historia necesita agregar más campos a un DTO ya
  usado en muchos lugares.

**Frontend**: la única historia que quedó con comportamiento real conectado (AC-05) tiene UI en
`BillingPage.tsx` (`NewInvoiceTab`) — nuevo campo "Client identity document (override for this
invoice)" junto al RUC de cliente ya existente, y validación cliente-side que bloquea el envío con
el mismo umbral que el backend (mensaje `femme.billing.invoice.clientIdentificationRequiredThreshold`).
`ClientResponse`/`ClientSearchField` ya devuelven `identityDocumentNumber` para que seleccionar un
cliente con cédula guardada la precargue, igual que ya pasa con el RUC.

**Deuda técnica (no bloqueante, documentada para cuando haga falta):**
- `BusinessProfile.taxpayerType`/`economicActivityCode`/`economicActivityDescription` **no tienen
  campo en ninguna pantalla de configuración** todavía (ni en `BusinessSettingsPage`). Hoy solo se
  pueden cargar vía `PUT /api/business-profile` directo. Hace falta antes de que HU-04/HU-06
  puedan construir un documento real para el tenant piloto — agregar los 3 campos al formulario
  existente de `BusinessSettingsPage.tsx` es la extensión natural (no una pantalla nueva).
- `FiscalStamp.establishment`/`expeditionPoint` tampoco tienen campo en `FiscalStampSettingsPage`
  — no urgente porque el default (1/1 = "001"/"001") ya coincide con el valor real de prueba de la
  SET, pero si el piloto necesita usar un punto de expedición distinto de `001` no hay forma de
  configurarlo desde la UI todavía.
- ~~`Client.address`/`department`/`city` tampoco tienen campo en `ClientsPage` — solo se pueden
  cargar vía API.~~ **Cerrado 2026-08-01, ver "Adenda AC-07" abajo.**

**Tests**: `SifenInvoiceHeaderServiceTest` (14 casos, cubre AC-01 a AC-08 incluyendo el contraste
ambiente de prueba/producción para AC-08 y determinismo del CDC entre llamadas). 5 casos nuevos en
`InvoiceServiceTest` para AC-05 (umbral exacto, justo debajo, override de cédula, RUC de cliente
guardado). E2E: `e2e/tests/sifen-hu-02-datos-documento.spec.ts` (AC-05 vía API y vía UI — las demás
ACs no tienen pantalla propia, ver nota en el spec).

## Adenda AC-07 (2026-08-01) — dirección/departamento/ciudad del cliente, con códigos DNIT reales

Sesión de auditoría de status posterior al cierre del plan (22/22 HU). AC-07 literalmente dice "si
se informa la dirección del cliente, el documento también incluye su departamento y ciudad" — pero
`SifenDocumentXmlService.buildReceiver` nunca emitía D219/D220/D223/D224 (`cDepRec`/`dDesDepRec`/
`cCiuRec`/`dDesCiuRec`) porque `Client.department`/`city` (desde HU-02 original) eran texto libre,
no los códigos numéricos del catálogo DNIT que esos campos exigen — y, hallazgo más importante:
**ninguna pantalla exponía siquiera `address` para editarlo** (`ClientsPage`/`ClientDetailPage`
nunca tuvieron ese campo, a pesar de que la columna existe en la base desde HU-02) — AC-07 era
literalmente imposible de disparar desde la UI hasta ahora.

**Decisión de diseño (confirmada con el usuario): construir un picker buscable**, no un simple
texto libre para departamento/ciudad — el catálogo geográfico oficial de la DNIT tiene 6.766
combinaciones únicas de departamento+ciudad (descargado en vivo de
`dnit.gov.py/documents/.../CÓDIGO DE REFERENCIA GEOGRAFICA_NOVIEMBRE_2025__.xlsx`, la misma fuente
oficial que HU-13's Adenda ya había usado para corregir el departamento/ciudad del emisor) —
demasiadas para un `<select>` plano. Reducido de 7.735 filas (departamento→distrito→ciudad→barrio)
a 6.766 combinaciones únicas departamento+ciudad (SIFEN solo necesita esas dos, igual que ya hace
`SifenIssuerData` para el emisor) y empaquetado como `src/backend/src/main/resources/sifen/
dnit-geographic-catalog.json`.

**Backend**:
- `Client.java` — `department`/`city` (texto libre) pasan a ser `departmentName`/`cityName` (mismo
  nombre de columna, sin migración de datos necesaria) y ganan sus pares `departmentCode`/
  `cityCode` nuevos (`V29__client_sifen_geographic_codes.sql`).
- `SifenGeographicLocality.java`/`SifenGeographicCatalogService.java` (nuevos) — carga el catálogo
  una vez a memoria (6.766 entradas, liviano) y expone `search(query, limit)` case/tilde-insensible
  contra nombre de ciudad o departamento.
- `SifenGeographicCatalogController.java` (nuevo) — `GET /api/sifen/geographic-localities?q=...`,
  cualquier usuario autenticado del tenant (no requiere rol admin), cap de 20 resultados.
- `SifenReceiverData.java` — gana `departmentCode`/`departmentName`/`cityCode`/`cityName` (antes
  solo `department`/`city`, nunca leídos por `buildReceiver`).
- `SifenInvoiceHeaderService.buildReceiverData` — solo puebla estos 4 campos si el cliente tiene
  address **y** ambos códigos cargados (nunca fabrica un departamento/ciudad a medias).
- `SifenDocumentXmlService.buildReceiver` — ahora sí emite D219/D220 (`cDepRec`/`dDesDepRec`) y
  D223/D224 (`cCiuRec`/`dDesCiuRec`) en el orden real que el Manual Técnico V150 documenta
  (D213→D218→D219→D220→D223→D224), solo cuando los códigos están presentes.
- `ClientRequest`/`ClientResponse`/`ClientService` — extendidos con los 4 campos nuevos.

**Frontend**: nuevo componente de design-system `LocalityCombobox` (mismo patrón de interacción que
`TimeCombobox` — input editable + listbox flotante — pero con búsqueda server-side debounced vía el
nuevo hook `useLocalitySearch`, no una lista estática cliente-side, ya que 6.766 opciones son
demasiadas para filtrar en el navegador en cada tecla). Agregado a `ClientsPage.tsx` (alta) y
`ClientDetailPage.tsx` (edición): un campo "Address" de texto libre + el picker de localidad,
después del campo RUC en ambos formularios. i18n: `femme.clients.address`/`.locality`/
`.localityPlaceholder`/`.localityHint`/`.localityNoResults` (en/es).

**Tests backend**: `SifenGeographicCatalogServiceTest` (5 casos — búsqueda por ciudad/departamento
case/tilde-insensible, query vacía, límite, sin resultados). `SifenDocumentXmlServiceTest` (+2 —
emisión completa con códigos, omisión sin códigos aunque haya dirección).
`SifenInvoiceHeaderServiceTest` (+1 — dirección sin códigos no fabrica nada). Resto de archivos
(`SifenDocumentSigningServiceTest`/`SifenKudePdfServiceTest`/`SifenQrCodeServiceTest`/los 5
`SifenHomologation*LiveTest`) actualizados solo por la firma nueva de `SifenReceiverData` (8
argumentos en vez de 6), sin cambios de comportamiento. Suite completa de backend
(`./gradlew test`) y `spotlessCheck` verdes.

**Playwright**: `e2e/tests/sifen-hu-02-datos-documento.spec.ts` — 3 casos nuevos: AC-07 alta de
cliente con dirección + selección de localidad vía UI (verifica los 4 campos persistidos por API),
AC-07 negativo (dirección sin localidad no fabrica códigos), y una prueba directa del endpoint de
búsqueda contra el catálogo real. Suite completa de Playwright de SIFEN (52 specs) verde.

## HU-03 — Completar los servicios facturados y calcular los totales (Done)

Frente B de la Fase 1, siguiente paso después de HU-02. Igual que HU-01/HU-02, es lógica de mapeo
pura — no toca `InvoiceService.issueInvoice` ni agrega columnas nuevas: todo lo que HU-03 necesita
ya está persistido en `Invoice`/`InvoiceLine`/`InvoicePaymentAllocation` desde que se emite la
factura tradicional.

**Hallazgo clave del manual (Manual Técnico V150.pdf, secciones E8/E8.1/E8.2/F, esta vez sí
extraíble con `pdftotext -layout`, sin necesidad de renderizar imágenes):** el grupo de ítem
(`gCamItem`/`gCamIVA`) define el cálculo de impuesto por ítem en **dos campos separados y
encadenados**, no en un solo paso: `E735/dBasGravIVA = EA008 / (1 + tasa/100)` (base gravada) y
`E736/dLiqIVAItem = E735 * (tasa/100)` (impuesto), cada uno con su propio redondeo. Esto es
distinto — aunque matemáticamente equivalente sin el redondeo intermedio — de la fórmula de un solo
paso que ya usaba `InvoiceService` para la factura tradicional (`taxAmount = lineNet * rate / (100 +
rate)`). Se implementó la versión de dos pasos porque es la que el manual define campo por campo, no
por replicar el atajo de un solo paso de la factura tradicional.

**Segundo hallazgo: `dTasaIVA` (E734) solo acepta 0, 5 o 10** — "0 (para E731=2 o 3); 5 (para
E731=1 o 4); 10 (para E731=1 o 4)". Como `Tax.rate` en este dominio es una tasa libre configurable
por tenant (no restringida a los valores de IVA paraguayo), se agregó una validación explícita
(`SIFEN_UNSUPPORTED_TAX_RATE`, `PRECONDITION_FAILED`) que rechaza cualquier tasa gravada que no sea
exactamente 5 o 10 — sin esto, una tasa como 8% construiría un documento que SIFEN rechazaría en el
envío, mucho más tarde y con un error mucho más difícil de diagnosticar.

**Decisión de diseño clave: "Gravado parcial" (E731=4) no es alcanzable con el modelo de datos
actual.** El manual define cuatro valores para `iAfecIVA` (1=Gravado, 2=Exonerado, 3=Exento,
4=Gravado parcial — un mismo ítem con una porción gravada y otra exenta, vía `dPropIVA`). `Tax` en
este dominio es una tasa única por servicio (`Tax.rate`), sin bandera de exoneración Art. 83 ni
forma de partir un ítem en dos porciones — así que cada línea resuelve determinísticamente a
GRAVADO (`rate > 0`) o EXENTO (`rate == 0`), nunca a EXONERADO ni GRAVADO_PARCIAL. Se modeló
`SifenTaxAffectation` con los 4 valores del manual por completitud (y porque `AC-03` los menciona
explícitamente), pero los dos no alcanzables están documentados en su propio Javadoc como
limitación conocida, igual que el precedente ya sentado en HU-02 (departamento/ciudad como texto
libre). Si una futura historia necesita soportar servicios con impuesto mixto, hay que extender
`Tax`/`SalonService` antes de que esto sea alcanzable — no es un cambio aislado a este servicio.

**Reconfirmado 2026-08-02 (auditoría de status post-cierre del plan):** revisado explícitamente con
el usuario si `EXONERADO`/`GRAVADO_PARCIAL` ameritaban cerrarse — decisión: **fuera de alcance
permanente**, esta peluquería no vende servicios exonerados por ley especial (Art. 83) ni servicios
con IVA mixto dentro de una misma línea. No es una limitación pendiente de una futura historia; es
un cierre deliberado.

**AC-05 (descuento se refleja en el total): el descuento por línea y el descuento global de la
factura son casos distintos.** El descuento por línea (`InvoiceLine.discountType/discountValue`) ya
está incluido en `InvoiceLine.lineTotal` (no hace falta recalcularlo — `grossLineTotal - lineTotal`
da el monto exacto sin importar si fue FIXED o PERCENT). El descuento a nivel factura
(`Invoice.discountType/discountValue`, aplicado sobre el subtotal, no sobre un servicio puntual) no
tiene un desglose por ítem en el modelo actual — SIFEN exige uno (`EA004/dDescGloItem`, por ítem).
Se prorratea proporcionalmente al peso de cada línea sobre el subtotal
(`globalDiscount * lineTotal_i / subtotal`), con la última línea absorbiendo el resto del redondeo
en centavos — así la suma de los `netTotal` de las líneas siempre coincide exactamente con
`Invoice.total` (AC-04), sin importar cuántas líneas haya ni cómo caigan los redondeos.

**AC-02 (descripciones de hasta 2000 caracteres) vs. el límite real de SIFEN (120 caracteres para
`E708/dDesProSer`):** son requisitos en tensión, no el mismo campo. Se resolvió ensanchando
`invoice_lines.description` a `NVARCHAR(2000)` (antes 500) a nivel de aplicación, y truncando a 120
caracteres para el nombre del ítem SIFEN — el resto de la descripción (hasta 500 caracteres, límite
de `E714/dInfItem`) se manda en un campo complementario (`additionalInfo`) en vez de perderse. Nota
para HU-04: **no existe hoy ningún input de UI que permita escribir una descripción larga** — en
`BillingPage.tsx` la descripción de cada línea siempre viene de `service.name` (el catálogo de
servicios), nunca de texto libre. AC-02 es hoy una capacidad de API/dominio sin forma de ejercitarla
manualmente; si el negocio necesita descripciones largas reales, hace falta una historia aparte para
agregar ese campo a la UI de facturación (fuera de alcance de HU-03, que solo pedía "admite").

**AC-06 (forma de pago si es al contado): la condición siempre es Contado (1), nunca Crédito (2).**
`InvoiceService.issueInvoice` (paso 8) ya exige que la suma de pagos sea exactamente igual al total
+ propinas al momento de emitir — no existe en este sistema el concepto de factura con saldo
pendiente. Por eso `SifenInvoiceDetail.paymentCondition` es una constante, no algo que dependa de la
factura. El mapeo `PaymentMethod → E606/iTiPago` es: `CASH→1 (Efectivo)`,
`CREDIT_CARD→3 (Tarjeta de crédito)`, `DEBIT_CARD→4 (Tarjeta de débito)`, `TRANSFER→5
(Transferencia)`, `OTHER→99 (Otro)` — sin código propio para cheque/giro/billetera electrónica/etc.
porque `PaymentMethod` (el enum general del dominio, no específico de SIFEN) no los distingue hoy.

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `domain/enums/SifenTaxAffectation.java` — `GRAVADO`/`EXONERADO`/`EXENTO`/`GRAVADO_PARCIAL` con
  `sifenCode()`, ver limitación de alcance arriba.
- `domain/InvoiceLine.java` — `description` ensanchado a `length = 2000` (antes 500).
- `web/dto/InvoiceLineRequest.java` — agregado `@Size(max = 2000)` sobre `description` (AC-02); una
  descripción que excede el límite ya cae en el manejo genérico de `MethodArgumentNotValidException`
  → `INVALID_REQUEST` (`GlobalExceptionHandler`), mismo comportamiento que cualquier otra validación
  Bean Validation existente en este DTO — no se agregó un código de error dedicado.
- Migración `V20__sifen_invoice_line_description_length.sql` — `ALTER COLUMN` (no `ADD COLUMN`,
  primera migración SIFEN que amplía una columna existente en vez de agregar una nueva).
- `service/SifenInvoiceLine.java` / `SifenInvoiceTotals.java` / `SifenPaymentDetail.java` /
  `SifenInvoiceDetail.java` — records nuevos, cada campo documentado con su ID SIFEN (`E7xx`/`E8xx`/
  `Fxxx`) igual que `SifenControlNumberFields` de HU-01.
- `service/SifenInvoiceDetailService.buildDetail(tenantId, invoiceId)` — arma líneas + totales +
  pagos a partir de una factura ya persistida. Sin endpoint HTTP ni pantalla — igual que
  HU-01/HU-02/HU-05/HU-21, es una capacidad de servicio consumida por HU-04 (que la va a combinar
  con `SifenInvoiceHeader` de HU-02 antes de firmar).

**Frontend**: ninguno — ver la nota de AC-02 arriba sobre por qué no hay forma de ejercitar
descripciones largas desde la UI todavía.

**Tests**: `SifenInvoiceDetailServiceTest` (14 casos, cubre AC-01 a AC-06: detalle por línea,
código interno con/sin servicio vinculado, truncado de descripción larga + `additionalInfo`, cálculo
de base/impuesto gravado al 5%/10%, exento, tasa no soportada, total = suma de líneas, prorrateo del
descuento global, mapeo de formas de pago). **Sin Playwright** — igual que HU-01/HU-05/HU-21 (y la
mayoría de HU-02), ninguna de las 6 ACs tiene una pantalla propia que ejercitar: es una capacidad de
servicio consumida recién por HU-04/HU-06. Se investigó específicamente si AC-02 tenía un ángulo de
UI viable (el input de descripción de línea en `BillingPage.tsx`) y se confirmó que no — ver nota
arriba.

## HU-18 — Cargar un nuevo certificado y clave para un tenant (Done)

PR: (pendiente de abrir; commit directo a `feat/integracion-sifen` por instrucción del skill).

**Backend** (`src/backend/src/main/java/com/cursorpoc/backend/`):
- `domain/SifenCertificate.java` — `@ManyToOne Tenant`, `@ManyToOne AppUser uploadedBy`,
  `encryptedP12Base64`/`encryptedPasswordBase64` (`NVARCHAR(MAX)` — **no uses `@Lob`**, ver el
  comentario ya existente en `BusinessProfile.logoDataUrl`: SQL Server mapea LOB a CLOB y la
  validación de Hibernate falla), `notBefore`/`notAfter` (`LocalDate`, del certificado X.509),
  `uploadedAt`.
- `repository/SifenCertificateRepository.java` — `findByTenant_IdOrderByUploadedAtDesc`.
- `config/SifenCertificateProperties.java` (`app.femme.sifen.cert-encryption-key`, registrada en
  `FemmeConfiguration`) + `service/SifenCertificateEncryptionService.java` — AES-256-GCM,
  nonce aleatorio de 12 bytes por llamada, `base64(nonce || ciphertext+tag)`. Clave dev-default en
  `application.properties` (env var `FEMME_SIFEN_CERT_ENCRYPTION_KEY` para prod/staging real).
- `service/SifenCertificateService.java` — parsea el `.p12` con `KeyStore.getInstance("PKCS12")`.
  Comportamiento empírico verificado (JDK 21, proveedor SunJSSE):
  - Password incorrecta → `IOException` con `cause instanceof UnrecoverableKeyException` →
    `SIFEN_CERT_INVALID_PASSWORD`.
  - Archivo corrupto / no-PKCS12 → cualquier otro `IOException` (p.ej. `EOFException`, sin cause) o
    `GeneralSecurityException` → `SIFEN_CERT_INVALID_FILE`.
- `web/SifenCertificateController.java` — `GET/POST /api/sifen/certificates`. Gateado a
  `principal.getRole() == UserRole.ADMIN` exclusivamente (ni `SYSTEM_ADMIN` puede — la historia es
  del admin del tenant, no del operador de plataforma). Este gateo es una decisión de diseño propia
  (ninguna AC de HU-18 lo exige explícitamente); si se requiere que `SYSTEM_ADMIN` también gestione
  certificados de un tenant en modo "preview" (como hace `FeatureFlagController`), ajustar aquí.
- Migración `V18__sifen_certificates.sql` (tabla `sifen_certificates`, seguí el patrón `IF NOT
  EXISTS` de `V17__tip_withdrawals.sql`).
- Tests: `SifenCertificateServiceTest` (upload válido, password incorrecta, archivo corrupto,
  base64 malformado, aislamiento por tenant a nivel de repositorio) +
  `SifenCertificateEncryptionServiceTest` (round-trip, nonce distinto por llamada). Fixture
  `.p12` de test en `src/backend/src/test/resources/sifen/test-cert.p12` (autofirmado, contraseña
  `TestPass123!`, generado con `keytool -genkeypair -storetype PKCS12`).

**Frontend**:
- `pages/SifenCertificatesPage.tsx` — formulario de carga (input file `.p12` → `FileReader` a
  base64 igual que `BusinessSettingsPage`'s `onLogoFile`, sin prefijo `data:` antes de enviar) +
  listado (solo fecha de carga/expedición/vencimiento; el badge de "estado" es HU-20/HU-19, no
  HU-18). Auto-gateada en el propio componente (`me.role === "ADMIN"`) igual que
  `FeatureFlagsPage` se autogatea con `SYSTEM_ADMIN`.
- Ruta `/app/settings/sifen`, tab "SIFEN" en `SettingsLayout.tsx` (visible solo si
  `me.role === "ADMIN"`).
- i18n: `femme.sifenCertificates.*` y `femme.settings.tabSifen` en `en.json`/`es.json`, más
  `femme.apiErrors.SIFEN_CERT_INVALID_PASSWORD|SIFEN_CERT_INVALID_FILE|SIFEN_CERT_FILE_TOO_LARGE`.

**E2E**: `e2e/tests/sifen-hu-18-cargar-certificado.spec.ts`, fixture compartida en
`e2e/fixtures/sifen/test-cert.p12` (mismo archivo que el backend).

**Convención de nombres de test SIFEN:** los HU de esta especificación (`HU-01`..`HU-22`) son un
documento aparte de los HU del backlog original del producto (que ya usa `hu-01`..`hu-30` como
nombre de archivo en `e2e/tests/`, p.ej. `hu-18-cerrar-caja-del-dia.spec.ts` ya existe y **no**
tiene relación con el HU-18 de SIFEN). Para evitar colisiones, todo spec de esta integración se
nombra `sifen-hu-<n>-<slug>.spec.ts`.

**Desviación conocida (no bloqueante):** AC-07 de HU-18 ("un tenant no puede acceder a
certificados de otro") está cubierta solo a nivel de test de backend (mock de repositorio
filtrando por `tenantId`), no con un test e2e real de dos tenants. Se investigó y **no existe en
este repo** ningún mecanismo (endpoint, fixture, o seed) para crear un segundo tenant en tests e2e
— solo existe el tenant demo id=1 sembrado por `FemmeDataInitializer`. Construir esa
infraestructura está fuera del alcance de HU-18; si se decide agregarla, sería un fixture
reutilizable en `e2e/fixtures/` (p.ej. `createSecondTenantApi`) para que HU-18 y futuras historias
multi-tenant (HU-21 AC-04, HU-22 AC-02) puedan verificarlo con Playwright.

**Deuda técnica (agregada después de HU-18, no re-abrir la historia por esto — trackear aparte):**
la especificación ahora exige RT-08..RT-11 (Azure Key Vault + Managed Identity para la clave
maestra de cifrado fuera del ambiente `e2e`), agregado *después* de implementar HU-18. La
implementación actual de `SifenCertificateEncryptionService`/`SifenCertificateProperties` lee la
clave maestra de `app.femme.sifen.cert-encryption-key` (env var `FEMME_SIFEN_CERT_ENCRYPTION_KEY`
con default de desarrollo) en **todos** los ambientes, igual que ya hace `FemmeJwtProperties` para
el secreto JWT — por lo tanto hoy **no cumple RT-09/RT-10** fuera de `e2e`. Pendiente: un chore
que (a) agregue una dependencia a Azure Key Vault (`azure-security-keyvault-secrets` +
`DefaultAzureCredential`/Managed Identity, ya hay `com.azure:azure-identity` en el classpath) para
resolver la clave maestra solo cuando el perfil activo no sea `e2e`, y (b) evalúe si conviene
extender lo mismo al secreto JWT ya que comparte el mismo patrón de riesgo. No se resolvió en el
loop porque es una historia de infraestructura transversal, no una de las 22 HU numeradas del plan
de fases — se necesita indicación del usuario sobre si crear una HU nueva para esto o manejarlo
como chore de infraestructura.

**Reconfirmado 2026-08-02 (auditoría de status post-cierre del plan):** sigue sin resolverse,
deliberadamente — fuera del alcance de la sesión de cierre de gaps que terminó con HU-02/HU-03/
HU-06/HU-10/HU-11/HU-15/HU-16/HU-17 (ver Adendas 2 y 3 arriba). Sigue pendiente la misma indicación
del usuario sobre HU nueva vs. chore de infraestructura.

## HU-20 — Calcular el estado de cada certificado según su vigencia (Done)

Pequeño y puramente derivado — no agrega tabla ni columna nueva.

**Backend**:
- `domain/enums/SifenCertificateStatus.java` — `VALID`, `EXPIRED`, `NOT_YET_VALID` (inglés, como
  el resto de los enums del dominio — ver `ServiceRecordStatus`, `UserRole`).
- `SifenCertificateService`: nueva dependencia `FemmeTimeProperties` (mismo patrón que
  `DashboardService`/`InvoicePdfService` para "hoy" en zona horaria de negocio, no UTC ni zona del
  servidor). Método privado `computeStatus(cert, today)` — `today.isBefore(notBefore)` →
  `NOT_YET_VALID`; `today.isAfter(notAfter)` → `EXPIRED`; si no, `VALID` (ambos límites inclusive,
  AC-01). Se llama en `list()` (con `LocalDate.now(zone)` fresco en cada invocación — AC-04, nunca
  se guarda) y en `upload()` para que la respuesta inmediata también traiga el estado correcto.
- `SifenCertificateResponse` ahora incluye `status`.
- Tests: 5 casos nuevos en `SifenCertificateServiceTest` (vigente, límites inclusive, expirado, no
  vigente aún, y AC-05 — dos certificados `VALID` simultáneos sin error). Construidos con fechas
  relativas a `LocalDate.now()` real (no hay `Clock` inyectable todavía), no con fechas fijas.

**Frontend**: `SifenCertificatesPage.tsx` agrega un badge de estado (reusa
`--color-timbrado-valid-bg/fg` de `FiscalStampSettingsPage` para `VALID`, `--color-danger-lt/danger`
para `EXPIRED`, `--color-stone`/`--color-ink-2` neutro para `NOT_YET_VALID`). i18n:
`femme.sifenCertificates.colStatus/statusValid/statusExpired/statusNotYetValid`.

**E2E**: `e2e/tests/sifen-hu-20-estado-certificado.spec.ts`. Para probar `EXPIRED` y
`NOT_YET_VALID` con el sistema real (sin mockear el reloj) se generaron dos fixtures adicionales
con `keytool -genkeypair -startdate "-2y"/"+1y" -validity <n>`:
`e2e/fixtures/sifen/expired-cert.p12` (vigencia 2024–2025) y `notyetvalid-cert.p12` (vigencia
2027–2037), misma contraseña `TestPass123!` que `test-cert.p12`. Si `Especificacion_...md` o el
reloj de referencia cambian mucho en el futuro, estas fechas fijas eventualmente podrían quedar
fuera de rango (p.ej. `expired-cert.p12` ya no sería "expirado" si el sistema corriera en 2024) —
regenerar con el mismo comando si algún test de HU-20 empieza a fallar por esto.

AC-06/AC-07 ("pasa a Vigente/Expirado automáticamente al llegar la fecha, sin acción manual") están
cubiertas indirectamente: como el estado nunca se guarda (AC-04, ya testeado) y se recalcula en
cada `list()`, la transición automática es una consecuencia directa de esa propiedad — no se
escribió un test que espere el paso real del tiempo.

## HU-21 — Usar automáticamente el certificado vigente del tenant (Done)

Sin pantalla propia (es una capacidad de servicio para historias futuras). Se implementó sin pedir
confirmación al usuario sobre adelantar HU-05 en paralelo — se decidió seguir el orden literal del
plan de fases y avanzar con HU-05 en la próxima iteración del loop.

**Backend**:
- `service/SifenActiveCertificateMaterial.java` — record nuevo (no es un DTO web, **nunca**
  serializar: expone `PrivateKey`/`KeyStore`) con `certificateId`, `keyStore`, `keystorePassword`,
  `alias`, `certificate` (`X509Certificate`), `privateKey`. Pensado para que HU-04 (firmar) use
  `privateKey`/`certificate` directamente y HU-05 (conectar) use `keyStore`/`keystorePassword` para
  construir un `KeyManagerFactory`/`SSLContext` de mTLS.
- `SifenCertificateService.requireActiveCertificate(tenantId)`: filtra los certificados del tenant
  a estado `VALID` (reutiliza `computeStatus`, ya existente de HU-20) y elige el de `notAfter` más
  lejano, con empate por `id` (AC-03: mismo criterio siempre). Si no hay ninguno `VALID`, lanza
  `ResponseStatusException(PRECONDITION_FAILED, "SIFEN_NO_VALID_CERTIFICATE")` (AC-02) — agregado
  ya el i18n `femme.apiErrors.SIFEN_NO_VALID_CERTIFICATE` en ambos locales aunque todavía no hay
  ningún controller que dispare este código.
- **Sin caché entre llamadas, deliberadamente**: cada llamada vuelve a consultar el repositorio y
  descifrar el `.p12`/password desde cero. Esto es lo que hace que AC-04 (nunca cruzar tenants,
  incluso en el mismo instante), AC-05 (un certificado que expira entre una operación y la
  siguiente deja de usarse solo) y AC-06 (uno recién cargado se usa de inmediato) se cumplan sin
  código adicional — no agregar un caché de material descifrado más adelante sin volver a revisar
  estas tres ACs.
- Tests (`SifenCertificateServiceTest`, 5 casos nuevos): decodificación real end-to-end del
  material (no solo el filtro de estado), selección por vencimiento más lejano, rechazo cuando no
  hay ninguno vigente, un certificado expirado nunca es elegido, y aislamiento estricto por tenant.

## Convenciones establecidas para el resto de la integración

- **Nunca uses `@Lob`/`VARBINARY`** para blobs — usar `NVARCHAR(MAX)` + texto base64, como ya hace
  `BusinessProfile.logoDataUrl` y ahora `SifenCertificate`.
- **Carga de archivos**: base64-en-JSON (vía `FileReader.readAsDataURL` + strip del prefijo
  `data:...;base64,`), no multipart — no hay precedente de `MultipartFile` en el backend y así se
  mantiene consistencia con `BusinessSettingsPage`.
- **Cifrado en reposo**: `SifenCertificateEncryptionService` (AES-256-GCM) es reutilizable para
  cualquier otro secreto que la integración necesite guardar — no crear un segundo mecanismo.
- **Gateo de admin de tenant**: no existe `@PreAuthorize` en este proyecto; el patrón es
  `principal.getRole() != UserRole.ADMIN` (o `SYSTEM_ADMIN` según el caso) al inicio del método del
  controller, como en `FeatureFlagController.requireSystemAdmin()`.
- **Config con env var**: seguir el patrón `app.femme.<x>=${ENV_VAR:dev-default}` de
  `application.properties` (ver `app.femme.jwt.secret` / `app.femme.sifen.cert-encryption-key`).
