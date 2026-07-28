# Progreso — Integración SIFEN

Memoria de trabajo para el loop `/sifen-loop`. Se actualiza al final de cada HU completada.
Todo el trabajo vive en la branch `feat/integracion-sifen` (worktree en `pelu-sifen/`).

## Estado

Fase actual: **Fase 2** (Cerrar el ciclo de vida de la factura ya enviada) — en curso, HU-07 y HU-08
hechas. HU-19 (de EP-06/Fase 1) también se tomó ya, en paralelo, por no depender de HU-08/HU-09.
Plan completo: `Especificacion_SIFEN_Peluqueria.md` sección "Plan de implementación por fases".

| HU | Estado | Notas |
|---|---|---|
| HU-18 Cargar certificado y clave | ✅ Done | Ver detalle abajo. ⚠️ Cifrado en reposo hoy no cumple RT-09/RT-10 fuera de `e2e` — ver "Deuda técnica" abajo. |
| HU-20 Calcular estado del certificado | ✅ Done | Ver detalle abajo. |
| HU-21 Usar certificado vigente automáticamente | ✅ Done | Ver detalle abajo. |
| HU-05 Conectarse de forma segura con SIFEN | ✅ Done | Ver detalle abajo. Verificado en vivo contra SIFEN real. |
| HU-01 Generar número de control | ✅ Done | Ver detalle abajo. |
| HU-02 Datos identificación/timbrado/emisor/receptor | ✅ Done | Ver detalle abajo. |
| HU-03 Servicios facturados y totales | ✅ Done | Ver detalle abajo. |
| HU-04 Firmar digitalmente | ✅ Done | Ver detalle abajo. |
| HU-06 Enviar factura y registrar resultado | ✅ Done | Ver detalle abajo. Verificado en vivo contra SIFEN real (rechazo); ver limitación de "Aprobado" abajo. |
| HU-07 Verificar estado de una factura pendiente | ✅ Done | Ver detalle abajo. Verificado en vivo contra SIFEN real (CDC inexistente); primera historia con pantalla + controller propios. |
| HU-19 Ver listado de certificados | ✅ Done | Ver detalle abajo. Sin interacción con SIFEN (N/A) — 100% lectura de datos locales. |
| HU-08 Generar comprobante PDF (KuDE) | ✅ Done | Ver detalle abajo. Verificado en vivo: el fix de `gCamFuFD/dCarQR` cierra ese gap específico; quedan 3 gaps menores ya documentados por HU-06, sin "Aprobado" real todavía. |
| HU-09 Revalidar en SIFEN una factura | ⬜ Next | Depende de HU-08 (ya hecha) — ver "Próximo paso" abajo. |
| Fase 3 (HU-10, HU-11) | ⬜ Todo | |
| Fase 4 (HU-12..HU-17, homologación) | ⬜ Todo | |
| Fase 5 (HU-22, activación real por tenant) | ⬜ Todo | |

**Próximo paso al reanudar el loop:** implementar HU-09 (Revalidar en SIFEN una factura desde el
sistema) — único ítem restante de Fase 2. HU-09 reconstruye la misma URL de consulta pública que
codifica el QR del KuDE (ya persistida por HU-08 en `Invoice.sifenPublicConsultationUrl`/
`sifenQrUrl`) y la abre en una pestaña nueva — no necesita recalcular nada, solo leer esos dos
campos. El WS de consulta (`SiConsDE`) ya quedó completamente investigado por HU-07 (XSD real vía
`consulta.wsdl.xsd1.xsd`, endpoint real, forma real de `rEnviConsDeResponse`) — no hace falta
re-investigarlo para HU-09, que reutiliza el mismo `SifenDocumentQueryClient`. **Sigue sin existir
ningún CDC real que SIFEN devuelva como "Aprobado"** (ver hallazgo de HU-08 abajo: quedan 3 gaps de
schema menores — `dFeFinT`, `dDesUniMed`, `dBasExe` — ya documentados por HU-06 como deliberadamente
fuera de alcance hasta homologación, HU-12..HU-17) — así que HU-07's AC-01/AC-03 y la consulta real
de HU-09 AC-02/AC-03 (aprobación real) van a seguir sin poder verificarse en vivo hasta que
homologación cierre esos 3 gaps. Quien quiera reintentarlo puede reusar el mismo procedimiento
manual (test JUnit temporal + `curl`) documentado en la sección de HU-08 abajo — ahora ya incluye el
grupo QR, así que solo faltarían esos 3 campos para llegar a un "Aprobado" real.

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
- `Client.address`/`department`/`city` tampoco tienen campo en `ClientsPage` — solo se pueden
  cargar vía API. Necesario para que AC-07 tenga datos reales que mostrar en HU-04/HU-06, más allá
  del código ya probado en `SifenInvoiceHeaderServiceTest`.

**Tests**: `SifenInvoiceHeaderServiceTest` (14 casos, cubre AC-01 a AC-08 incluyendo el contraste
ambiente de prueba/producción para AC-08 y determinismo del CDC entre llamadas). 5 casos nuevos en
`InvoiceServiceTest` para AC-05 (umbral exacto, justo debajo, override de cédula, RUC de cliente
guardado). E2E: `e2e/tests/sifen-hu-02-datos-documento.spec.ts` (AC-05 vía API y vía UI — las demás
ACs no tienen pantalla propia, ver nota en el spec).

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
