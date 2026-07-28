# Progreso — Integración SIFEN

Memoria de trabajo para el loop `/sifen-loop`. Se actualiza al final de cada HU completada.
Todo el trabajo vive en la branch `feat/integracion-sifen` (worktree en `pelu-sifen/`).

## Estado

Fase actual: **Fase 1** (Primera interacción real con el Web Service de SIFEN).
Plan completo: `Especificacion_SIFEN_Peluqueria.md` sección "Plan de implementación por fases".

| HU | Estado | Notas |
|---|---|---|
| HU-18 Cargar certificado y clave | ✅ Done | Ver detalle abajo. ⚠️ Cifrado en reposo hoy no cumple RT-09/RT-10 fuera de `e2e` — ver "Deuda técnica" abajo. |
| HU-20 Calcular estado del certificado | ✅ Done | Ver detalle abajo. |
| HU-21 Usar certificado vigente automáticamente | ✅ Done | Ver detalle abajo. |
| HU-05 Conectarse de forma segura con SIFEN | ✅ Done | Ver detalle abajo. Verificado en vivo contra SIFEN real. |
| HU-01 Generar número de control | ✅ Done | Ver detalle abajo. |
| HU-02 Datos identificación/timbrado/emisor/receptor | ⬜ Next | |
| HU-03 Servicios facturados y totales | ⬜ Todo | |
| HU-04 Firmar digitalmente | ⬜ Todo | |
| HU-06 Enviar factura y registrar resultado | ⬜ Todo | |
| Fase 2 (HU-07, HU-08, HU-09, HU-19) | ⬜ Todo | |
| Fase 3 (HU-10, HU-11) | ⬜ Todo | |
| Fase 4 (HU-12..HU-17, homologación) | ⬜ Todo | |
| Fase 5 (HU-22, activación real por tenant) | ⬜ Todo | |

**Próximo paso al reanudar el loop:** implementar HU-02 (Completar los datos de identificación,
timbrado, emisor y receptor), siguiente paso del Frente B de la Fase 1 (depende de HU-01, ya
cerrado). A diferencia de HU-01, esta historia sí necesita tocar el modelo de dominio existente:
la especificación exige establecimiento y punto de expedición (hoy **no existen** en `FiscalStamp`
— solo `stampNumber`, ver detalle en la sección HU-01 abajo) y un concepto de "tipo de
contribuyente" (persona física=1/jurídica=2, campo `iTipCont`/D103 que `SifenControlNumberFields`
ya espera recibido desde afuera) que tampoco existe en `BusinessProfile` ni en ningún otro lugar del
dominio — hay que decidir dónde vive (¿nuevo campo en `BusinessProfile`? ¿en `FiscalStamp`?) antes
de escribir el servicio que arma el documento. También hay que decidir dónde persiste el CDC/código
de seguridad de cada factura para que HU-01 AC-06 (determinismo) se cumpla de punta a punta —
probablemente una tabla o columnas nuevas asociadas a `Invoice`, ya que hoy `Invoice` no tiene
ningún campo relacionado con SIFEN. AC-05 de HU-02 (umbral de Gs. 7.000.000 para exigir
identificación del cliente) es lógica de negocio nueva, no depende de estos gaps de modelo.

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
