# Hardening SIFEN

Documento vivo de requisitos de endurecimiento (seguridad, logging, seeding, multitenancy) para
la integración SIFEN. Se construye incrementalmente a medida que se van definiendo nuevos
requisitos — no es un plan de implementación cerrado.

Los ítems se numeran `RT-<n>` continuando la numeración de requisitos transversales ya usada en
`Especificacion_SIFEN_Peluqueria.md` (que llega hasta `RT-11`), para mantener las referencias
cruzadas simples. Cuando un ítem nuevo reemplaza o vuelve obsoleto un `RT` anterior, se indica
explícitamente.

## Gestión de activos criptográficos (Azure Key Vault)

**Contexto actual (2026-08-05):** los `.p12` de cada tenant se guardan hoy en la tabla
`sifen_certificates` (`SifenCertificate.encryptedP12Base64` / `encryptedPasswordBase64`),
cifrados con AES-256-GCM mediante una clave maestra **única para toda la aplicación**
(`app.femme.sifen.cert-encryption-key`, `SifenCertificateEncryptionService`). Esa clave tiene un
valor por defecto real hardcodeado en `application.properties:44`
(`FEMME_SIFEN_CERT_ENCRYPTION_KEY:enOvRBV4YK7cD2WVPl0pMOLFRq5xGVCnGBNLse2/XUY=`), usado en
**todos** los ambientes si no se sobreescribe la variable de entorno — esto ya viola RT-09 fuera
de `e2e`, y es la deuda técnica registrada en `PROGRESS.md` (sección "Deuda técnica" tras HU-18).

- **RT-12 — El `.p12` y su contraseña se guardan como secretos de Azure Key Vault, nunca en la
  base de datos.** La base de datos solo puede almacenar una referencia al secreto (nombre/URI de
  Key Vault) más metadatos no sensibles (`notBefore`, `notAfter`, `uploadedAt`, `uploadedBy`) —
  nunca el activo criptográfico en sí, cifrado o no.

  **Reemplaza y elimina RT-09**, no lo extiende. RT-09 solo exigía que la *clave maestra* que
  cifra el blob viviera en Key Vault, dejando el `.p12` cifrado en la base de datos. Con el `.p12`
  y la contraseña como secretos nativos de Key Vault, ya no queda ningún ciphertext a nivel de
  aplicación que proteger: Key Vault provee cifrado en reposo y control de acceso (vía Managed
  Identity, RT-10) de forma nativa. En consecuencia, la clave maestra de aplicación
  (`app.femme.sifen.cert-encryption-key` / `SifenCertificateEncryptionService`) y su default
  hardcodeado en `application.properties:44` se **eliminan**, no se migran a otro lado.

  Viola hoy: `SifenCertificate.encryptedP12Base64` / `encryptedPasswordBase64`,
  `SifenCertificateEncryptionService`, `application.properties:44`.

- **RT-13 — Cada tenant tiene sus propios activos criptográficos en Key Vault.** No existe una
  clave maestra compartida que cifre un blob multi-tenant; cada tenant tiene su(s) propio(s)
  secreto(s) (`.p12` y contraseña) aislados por convención de nombre/scope dentro del mismo Key
  Vault. Viola hoy: el diseño actual usa una única clave maestra para todos los tenants.

- **RT-14 — Las conexiones a SIFEN se establecen con la clave y el certificado correspondientes
  al tenant que ejecuta la transacción.** El punto de resolución por tenant ya existe
  (`SifenConnectionService.buildAuthenticatedClient(tenantId)`, que además valida que el RUC del
  certificado coincida con `BusinessProfile.ruc` del tenant) — al migrar a Key Vault, ese mismo
  punto debe resolver el secreto correcto por `tenantId` en cada llamada, no una capacidad nueva.

- **RT-15 — Transacciones concurrentes de distintos tenants nunca cruzan credenciales.** Hoy esto
  se cumple por ausencia de concurrencia explícita (no hay `@Async`/executor en el código SIFEN;
  `TenantContext` depende de `SecurityContextHolder`, atado al hilo de request) y por diseño
  deliberado: `SifenCertificateService.requireActiveCertificate` nunca cachea material
  descifrado, precisamente para que dos llamadas simultáneas de tenants distintos no puedan
  mezclarse (ver HU-21 en `PROGRESS.md`). Este invariante debe preservarse explícitamente al
  introducir un cliente de Key Vault: cualquier cache que se agregue en el futuro (del cliente
  SDK, de secretos resueltos, etc.) debe estar scopeada por tenant, nunca compartida.

- **RT-17 — Migración de certificados existentes: re-carga manual, sin script de migración.**
  Decidido: los tenants con un `.p12` ya cargado hoy (blob cifrado en `sifen_certificates`)
  deben volver a subirlo por la pantalla existente una vez que el flujo de carga apunte a Key
  Vault. No se construye un script/job que descifre los blobs existentes con la clave maestra
  actual y los empuje a Key Vault en batch — se prefiere el menor riesgo de manipular material
  criptográfico descifrado fuera del flujo normal de carga, a costa de requerir coordinación con
  cada tenant antes de dar de baja la clave maestra (RT-12).

- **RT-08 (confirmado sin cambios) — la excepción de `e2e` se mantiene.** El perfil `e2e` sigue
  almacenando activos localmente (archivo/DB cifrada), sin depender de Key Vault real ni de un
  emulador, tal como ya especifica RT-08 en `Especificacion_SIFEN_Peluqueria.md`. RT-12..RT-15
  aplican solo a ambientes no-`e2e`.

- **RT-18 — El secreto JWT (`app.femme.jwt.secret`) recibe el mismo tratamiento que la clave
  maestra de SIFEN: se elimina su default hardcodeado y pasa a resolverse desde Azure Key Vault
  en cualquier ambiente que no sea `e2e`, mediante Managed Identity (mismo mecanismo que RT-10).**
  Decidido: se incluye en el alcance de este hardening en lugar de quedar como ítem separado,
  dado que comparte exactamente el mismo patrón de riesgo (`FemmeJwtProperties`, default real
  hardcodeado en `application.properties:33`). A diferencia del certificado SIFEN, el JWT secret
  no tiene "activo por tenant" — sigue siendo un único secreto de aplicación en Key Vault, pero ya
  no vive en configuración ni variables de entorno fuera de `e2e`. Nota operativa: rotar este
  secreto invalida todas las sesiones activas — la migración inicial (mover el valor actual a Key
  Vault sin cambiarlo) no rota nada, pero cualquier rotación posterior sí.

## KUDE — plantilla compartida, datos por tenant

- **RT-16 — La misma lógica de generación de KUDE se usa para todos los tenants; los datos
  específicos del tenant se leen siempre de la base de datos al momento de generar el documento.**
  No existe (ni debe introducirse) un archivo de plantilla por tenant. Esto ya es como funciona
  `SifenKudePdfService` hoy: no hay un archivo de plantilla externo (HTML/Jasper/etc.) — el PDF se
  arma programáticamente con OpenPDF, y en cada llamada a `buildKudePdf(tenantId, invoiceId)` se
  lee `BusinessProfile` fresco desde la base (razón social, RUC, dirección, logo, mensaje de pie)
  sin cachear ni hardcodear nada. Este requisito formaliza ese comportamiento existente para
  evitar que una futura refactorización lo rompa (p.ej. introduciendo un cache de perfil de
  negocio, o una plantilla estática con datos de un solo tenant).

- **RT-28 [CRÍTICA] — El KuDE debe poder entregarse al cliente aunque la factura esté
  `PENDING_VERIFICATION`, no solo cuando SIFEN ya aprobó.** El Manual V150 (pág. 19, Gráfica N° 02;
  pág. 24) establece que el modelo operativo general de SIFEN ("validación posterior") permite
  generar y entregar el KuDE en el momento de la venta, *antes* de obtener la aprobación de SIFEN
  — la transmisión del DE a SIFEN tiene un plazo de hasta 72 horas corridas desde la firma digital.
  La "validación previa" (exigir aprobación de SIFEN antes de entregar el documento al receptor) es
  una modalidad excepcional que la SET puede habilitar para ciertos segmentos de contribuyentes
  durante el plan de masificación — no es el modelo general. El manual habilita explícitamente este
  flujo para "venta a un receptor no electrónico contribuyente de IVA o renta... al consumidor
  final y para las mercaderías en su traslado físico" (pág. 24) — exactamente el perfil de cliente
  de una peluquería. La única condición: "su validez jurídica se encuentra condicionada a la
  aprobación por parte de la SET", y el receptor "se obliga a consultar y/o comprobar la existencia
  del DTE en el SIFEN" usando el CDC/QR ya presentes en el KuDE (ver RT-16).

  Hoy la implementación se comporta como si siempre operara en modalidad de validación previa:
  según el script de UAT (`PROGRESS.md`), "Descargar KuDE (PDF)" solo está disponible una vez que
  la factura está Aprobada/Aprobada con observación — mientras la factura está
  `PENDING_VERIFICATION` (ver RT-20), el cliente se va sin ningún comprobante. Esto bloquea
  innecesariamente el flujo de un negocio de venta directa a consumidor final, y además es la
  causa raíz de por qué hoy hay presión por mantener algún intento síncrono a SIFEN dentro del
  request de emisión (ver RT-20/RT-23): si el KuDE no depende de la aprobación, no hace falta que
  la factura resuelva su estado con SIFEN antes de que el cliente se retire con su comprobante.

  Requiere: habilitar la descarga/impresión del KuDE para facturas en estado
  `PENDING_VERIFICATION` (no solo `APPROVED`/`APPROVED_WITH_OBSERVATION`), idealmente indicando
  visualmente que el comprobante está sujeto a validación pendiente de SIFEN (el manual no exige
  una leyenda de texto fija para este caso —a diferencia de la leyenda de ambiente de prueba— pero
  sí exige que el receptor pueda verificar el DTE, lo cual ya se cumple vía CDC/QR).

## Multitenancy y ambiente SIFEN

**Corrección 2026-08-05:** la versión anterior de RT-19 asumía que un mismo deployment podía servir
tenants en distintos ambientes SIFEN simultáneamente. Eso no aplica: `dev`/`testing` y `producción`
son deployments físicamente separados (`infrastructure_v2/environments/dev` vs `.../prod`, cada uno
con su propia suscripción de Azure, su propio `azurerm_mssql_server`/`azurerm_mssql_database`, y su
propio `app.femme.sifen.connection.environment` de aplicación). El diseño correcto —y ya vigente— es:
el ambiente SIFEN se configura una sola vez por deployment (dev → `TEST`, prod → `PRODUCTION`), y las
pruebas de homologación de un tenant se hacen enteramente en el deployment de dev/testing. Un tenant
en modo homologación tiene el flag `SIFEN_ELECTRONIC_INVOICING`
(`TenantFeatureFlag`/`FeatureFlagService.isEnabled`) activo únicamente en la base de datos de
dev/testing; su fila equivalente en la base de datos de producción es una entidad completamente
distinta y permanece desactivada hasta que el tenant esté listo para pasar a producción. No se
propone entonces mover `environment` a una propiedad por tenant — ya está correctamente segmentado
por deployment.

- **RT-19 [IMPORTANTE] — El paso de un tenant de homologación a producción depende solo del
  criterio manual de un `SYSTEM_ADMIN`, sin un estado de "homologación completada" verificable ni
  una compuerta en código.** `FeatureFlagController` (gate `SYSTEM_ADMIN`, `TenantPathAccess`)
  permite activar `SIFEN_ELECTRONIC_INVOICING` para un tenant en la base de producción en cualquier
  momento; no existe ningún campo o entidad que registre si ese tenant realmente completó y aprobó
  la homologación (EP-05) en dev/testing antes de esa activación — la única traza es
  `TenantFeatureFlagChange`, que guarda solo el *último* cambio (quién, cuándo, valor anterior/nuevo),
  no un checklist de habilitación. Además, RT-06
  ("las pruebas de homologación solo pueden ejecutarse con el flag activado; si está desactivado,
  fallan de forma explícita") está documentado en `Especificacion_SIFEN_Peluqueria.md` pero no
  tiene ninguna verificación en código: los tests EP-05 (`SifenHomologation*LiveTest.java`) se
  saltean por `Assumptions.assumeTrue` sobre la presencia de los archivos `.p12` piloto, no por el
  estado del flag. El riesgo ya no es de ambiente cruzado (eso está resuelto por la separación de
  deployments), sino de gobernanza: nada impide activar producción para un tenant que nunca pasó
  homologación, ni queda un registro auditable de que sí la pasó. Sugerido: (a) enforzar RT-06 en
  código (los tests/flujo de homologación deben verificar el flag, no solo la presencia de
  archivos); (b) considerar un estado explícito por tenant ("homologación pendiente/aprobada") que
  la UI de `FeatureFlagsPage` muestre antes de permitir la activación en producción, aunque sea solo
  informativo para el `SYSTEM_ADMIN` que decide.

## Resiliencia y observabilidad

**Contexto (Manual Técnico V150, cap. 14, pág. 210):** la "Operación de Contingencia" está
reservada para una versión futura de la especificación, sin contenido definido todavía por SIFEN —
por eso no se propone acá un modo de contingencia offline; el código ya lo marca correctamente
"fuera de alcance" (`SifenInvoiceHeaderService.java:37`). En ausencia de contingencia, toda falla
de comunicación con SIFEN debe resolverse por resiliencia de la propia app (reintentos +
reconciliación), no por un fallback offline.

- **RT-20 [CRÍTICA] — Toda la comunicación con SIFEN es asíncrona, a través de una cola (Azure
  Service Bus, tier Basic), sin ningún intento síncrono dentro del request HTTP que emite la
  factura.** Fusiona y reemplaza las versiones anteriores de RT-20 (reintento acotado + job de
  reconciliación) y RT-23 (acotar concurrencia con semáforo) — con RT-28 ya resuelto (el KuDE se
  entrega igual en estado `PENDING_VERIFICATION`), no queda ninguna razón para bloquear el request
  de emisión esperando a SIFEN, así que ambos requisitos colapsan en uno solo: no hay camino
  síncrono que proteger ni acotar.

  **Diseño:**
  - `InvoiceController.issue` crea la factura con estado pendiente, encola un mensaje en Service
    Bus con los datos necesarios para el envío (o el id de la factura) y devuelve la respuesta al
    instante, sin bloquear el hilo del request esperando a SIFEN en ningún momento.
  - Un consumidor dentro del propio backend (Spring Cloud Azure, `ServiceBusProcessorClient`) toma
    el mensaje con **PeekLock** y ejecuta el envío real. El lock resuelve la seguridad
    multi-instancia sin coordinación manual: con varias réplicas del backend corriendo (scale-out),
    solo una a la vez procesa cada factura — si la instancia se cae a mitad de proceso, el lock
    expira solo y otra instancia toma el mensaje.
  - El consumidor se dispara apenas se encola el mensaje, no espera a un cron — en el caso feliz la
    aprobación de SIFEN sigue llegando en segundos, igual que hoy; lo único que cambia es que el
    hilo del request nunca esperó ese resultado.
  - **Basic no incluye duplicate detection ni scheduled messages** (eso sería Standard), así que:
    - *Backoff entre reintentos*: se implementa reencolando el mensaje con un retraso manual
      calculado en la app, no vía scheduled messages nativo.
    - *Deduplicación*: queda a nivel de aplicación, no de la cola — antes de cada reintento el
      consumidor debe verificar el estado actual de la factura (local o contra SIFEN) para no
      reenviar un documento que ya fue aprobado entre que se encoló el mensaje y se procesó (mismo
      cuidado que ya señalaba la versión anterior de este RT sobre el `dId` no estable del sobre
      SOAP — `System.currentTimeMillis()`, no un id estable).
  - **Dead-letter**: los mensajes que superan `MaxDeliveryCount` van automáticamente a la DLQ de la
    cola — de ahí sale la necesidad operativa de un proceso (alertado vía RT-21/observabilidad) que
    la revise: una factura en la DLQ es un documento fiscal que la app ya se rindió a resolver sola.
  - Reemplaza también la necesidad de un `@Scheduled` de reconciliación como mecanismo *principal*
    — la cola con reintentos + DLQ cumple ese rol. Puede quedar un job programado liviano, pero solo
    como red de seguridad para mensajes que se hayan perdido antes de llegar a la cola (p.ej. si el
    backend se cae entre crear la factura y encolar el mensaje): comparar facturas
    `PENDING_VERIFICATION` en base contra lo que hay en la cola, y re-encolar lo que falte.

  Requiere: agregar el recurso Azure Service Bus (namespace + cola, tier **Basic**) en Terraform
  (`infrastructure_v2/`), aplicado en **ambos ambientes** (`environments/dev` y
  `environments/prod`, ver RT-19) — no solo producción, ya que dev/testing también necesita
  procesar contra el ambiente `TEST` de SIFEN de forma asíncrona; con la Managed Identity del
  Container App como identidad de acceso (mismo patrón que Key Vault en RT-10); dependencia
  `spring-cloud-azure-starter-servicebus` en el backend; remover el intento síncrono actual de
  `InvoiceController.issue` / `SifenInvoiceSubmissionService.submit`.

- **RT-21 [CRÍTICA] — Observabilidad real de las llamadas a SIFEN en producción.** Application
  Insights está aprovisionado en Terraform (`main.tf:82-90`, connection string inyectada al
  Container App) pero el backend no tiene ningún mecanismo que lo use (sin Actuator/Micrometer/
  OpenTelemetry, sin `-javaagent` en el `Dockerfile`) — se paga por un recurso sin datos, y no hay
  forma de ver tasas de error/latencia de SIFEN ni de alertar cuando algo se rompe. Esto agrava
  directamente RT-19 y RT-20: sin observabilidad, un fallo sistemático (ambiente mal configurado,
  SIFEN caído, certificado vencido) puede pasar días sin detectarse. Mínimo requerido: conectar
  Application Insights (o Micrometer + OpenTelemetry) al backend, con métricas de éxito/error por
  operación SIFEN (`recepcion`, `consulta`, `evento`) con `tenantId` como dimensión, y un
  correlation id propagado en los logs de cada cliente SIFEN.

- **RT-22 [IMPORTANTE] — Rate limiting hacia SIFEN, al menos por tenant.** No existe ningún límite
  de tasa, ni por tenant ni global, hacia SIFEN ni en los endpoints relacionados. Un bug o abuso de
  un solo tenant podría agotar el límite que SIFEN aplica a su certificado/RUC, o en el peor caso
  activar throttling de red que afecte al backend entero (todos los tenants comparten el mismo
  egress) — riesgo de "noisy neighbor" entre tenants.

- **RT-23 (fusionado en RT-20) —** la propuesta original de acotar concurrencia con un semáforo
  quedó obsoleta: al pasar la comunicación con SIFEN a una cola (RT-20), el request de emisión ya
  no hace ninguna llamada síncrona a SIFEN, así que no hay concurrencia que acotar en el hilo del
  request. Ver RT-20 para el diseño final.

## Integridad de datos fiscales

- **RT-24 [IMPORTANTE] — Constraint único en base de datos para `sifen_control_number` y para
  `(fiscal_stamp_id, invoice_number)`.** Hoy la unicidad depende exclusivamente del lock pesimista
  en `InvoiceService.issueInvoice` (`FiscalStampRepository.lockByIdAndTenantId`,
  `@Lock(PESSIMISTIC_WRITE)`) — correcto hoy, pero sin defensa en profundidad: un futuro bug, un
  insert directo, o un cambio que no pase por ese método, podría generar un CDC o número de factura
  duplicado, lo que para un documento fiscal aparenta fraude/duplicación ante SIFEN o ante una
  auditoría. Migración barata con alto retorno de seguridad.

- **RT-25 [IMPORTANTE] — Inutilización (anulación de numeración) con trigger automático y control
  de plazo.** El Manual V150 (pág. 113-122) exige reportarla dentro de los primeros 15 días
  naturales del mes siguiente al hecho, y la vuelve obligatoria cuando un DE rechazado obliga a
  cambiar de CDC. Hoy solo existe el builder de XML (`SifenNumberVoidingEventXmlService`),
  ejercitado nada más en tests de homologación (`SifenNumberVoidingEventXmlServiceTest`,
  `SifenHomologationEventsLiveTest`) — sin ningún endpoint ni trigger de producción. Es una brecha
  de cumplimiento real: números sin usar por facturas rechazadas podrían nunca inutilizarse, ni
  reportarse dentro del plazo.

- **RT-26 [IMPORTANTE] — Validar en la carga del certificado los requisitos de la Tabla E del
  Manual V150** (clave RSA 2048 o 4096 bits, `Extended Key Usage: clientAuth`). Hoy un certificado
  no conforme recién falla al momento de conectar a SIFEN, con un error menos claro para el
  administrador del tenant. Validarlo en el mismo endpoint que ya parsea el `.p12` da un mensaje de
  error accionable antes de que el tenant dependa de un certificado inválido.

## Recomendadas

- **RT-27 [RECOMENDADA] — `SifenBatchReceptionClient` debe aplicar el límite que su propio javadoc
  documenta** (manual: máx. 10.000 KB por lote). Hoy no se usa en el flujo de producción (solo en
  soporte de homologación), así que el riesgo actual es bajo — pero conviene blindarlo con una
  validación explícita antes de habilitarlo para uso real, para no depender de que el llamador
  recuerde el límite.

## Descartado explícitamente (evaluado, no se implementa)

- **Modo de contingencia SIFEN (offline/manual).** Ver contexto al inicio de "Resiliencia y
  observabilidad" — el Manual V150 reserva ese capítulo para una versión futura sin contenido
  definido; construirlo ahora sería trabajo especulativo.

## Pendiente / a definir

Sin ítems abiertos por el momento. Se agregarán acá los nuevos puntos a definir a medida que
surjan en próximas rondas.
