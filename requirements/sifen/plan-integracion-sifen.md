# Plan de integración a SIFEN / DNIT para software multitenant de gestión de peluquerías

> **Contexto del proyecto:** Backend Java sobre Azure, arquitectura multitenant donde cada tenant (peluquería) es una persona jurídica distinta ante la DNIT, con su propio RUC y su propia identidad fiscal. El sistema debe emitir Documentos Electrónicos (DE) y transmitirlos al **SIFEN** (Sistema Integrado de Facturación Electrónica Nacional) para que sean aprobados y convertidos en **DTE** (Documentos Tributarios Electrónicos) con validez legal.
>
> **Supuestos de estimación:** 1 persona trabajando al 50% (~20 h/semana ≈ 4 h/día hábil), con asistencia de IA para toda la generación de código. Las estimaciones se expresan en **horas-esfuerzo (HE)** y, cuando una tarea depende de terceros (DNIT, prestadores de certificados), se indica además el **tiempo calendario** porque la IA no acelera la espera por aprobaciones externas.

---

## 0. Lo que conviene entender antes de escribir una línea de código

El modelo de Paraguay funciona así: tu software genera un **DE** en XML, lo **firma digitalmente** con el certificado del contribuyente emisor, y lo **transmite** al SIFEN vía Web Service. El SIFEN ejecuta validaciones (de esquema XML, de certificado/firma y de negocio) y devuelve **aprobación o rechazo**. Solo cuando es aprobado el DE pasa a ser **DTE** con validez jurídica. Existe un plazo de **72 horas** para transmitir el documento al SIFEN; superarlo expone a sanciones.

Conceptos clave que vas a usar en todo el proyecto:

| Concepto | Qué es |
|---|---|
| **DE / DTE** | Documento Electrónico (generado) / Documento Tributario Electrónico (ya validado por SIFEN) |
| **CDC** | Código de Control de 44 dígitos que identifica unívocamente cada documento |
| **KuDE** | Representación gráfica del DTE (PDF con QR) que se entrega al cliente final |
| **CSC** | Código de Seguridad del Contribuyente, usado para generar el hash del QR del KuDE |
| **Timbrado electrónico** | Autorización numérica que habilita la emisión; hay uno de **test** y otro de **producción** |
| **Marangatú** | Sistema de gestión tributaria de la DNIT donde se gestiona la habilitación y el timbrado |
| **PSC / PCSC** | Prestador (Cualificado) de Servicios de Certificación/Confianza que vende los certificados digitales |
| **e-Kuatia** | Modalidad para medianos/grandes contribuyentes con integración propia vía WS (la que vas a usar) |
| **e-Kuatia'i** | Solución gratuita de la DNIT para pequeños emisores; **no aplica** a un SaaS propio |

**Documentación obligatoria a leer (fuente primaria):**
- **Manual Técnico del SIFEN** (versión vigente; al momento de redacción la rama 150 + Notas Técnicas, p. ej. NT13). Define formato XML, XSD, firma, WS y validaciones.
- **Guía de Pruebas — Fase de Voluntariedad Abierta** (define los escenarios mínimos que debés superar).
- **Guías paso a paso de Habilitación como Facturador Electrónico** (Marangatú).
- Decreto N.° 872/2023 y resoluciones generales aplicables (RG 105/2021 y las que designan grupos obligados).

> ⚠️ **Advertencia regulatoria importante:** las versiones de XSD, las Notas Técnicas y los grupos/plazos obligatorios cambian con frecuencia. Tratá el Manual Técnico como una dependencia viva: cualquier estimación de este plan asume que vas a trabajar siempre contra la versión vigente publicada por la DNIT, no contra una copia descargada hace meses.

---

## 1. Punto crítico de arquitectura multitenant: certificados e identidad fiscal

Este es el aspecto que más condiciona el diseño, así que va primero.

**El hecho central:** cada tenant es una persona jurídica distinta con su propio RUC. En SIFEN:

1. La **firma digital** del XML debe hacerse con un certificado cuyo **RUC coincida con el del contribuyente emisor**. Si no coincide, el documento se rechaza (código de rechazo *0142 – El RUC del certificado utilizado para firmar no pertenece al Contribuyente emisor*). **No podés firmar las facturas de todos los tenants con un único certificado tuyo.**
2. La **conexión al Web Service** usa **autenticación mutua TLS (mTLS)**: el certificado de cliente que presenta tu servidor debe contener, según el Manual Técnico, el **RUC del contribuyente emisor y propietario responsable de la transmisión del mensaje**, con la extensión *Extended Key Usage = clientAuth* y el RUC en el *SubjectAlternativeName*.

**Implicación de diseño:** necesitás **un certificado digital por tenant** (emitido a nombre de cada peluquería como persona jurídica), tanto para firmar como, muy probablemente, para establecer el canal mTLS. Tu backend debe poder seleccionar dinámicamente el certificado correcto según el tenant que está emitiendo.

> ❗ **Verificación obligatoria antes de diseñar:** confirmá directamente con la Mesa de Ayuda del SIFEN si la DNIT contempla una figura de **proveedor tecnológico / tercero autorizado** que pueda transmitir en nombre de varios contribuyentes (lo que permitiría un único certificado de transmisión y certificados de firma por tenant), o si exige mTLS con el certificado de cada emisor. La respuesta cambia radicalmente tu capa de conexión (pool de conexiones mTLS por tenant vs. un canal compartido). No avances en la capa de transporte sin esta confirmación por escrito.

**Tipos de certificado:** los certificados se emiten en formato **PFX/PKCS#12**, pueden expedirse a favor de personas jurídicas, y los proveedores habilitados por el MIC incluyen **eFirma (VIT S.A.)**, **Code100 S.A.** y **Documenta S.A.** La lista oficial vigente está en la Autoridad Certificadora Raíz (acraiz.gov.py). Hay variantes según el dispositivo de resguardo de la clave privada (software, token, HSM).

---

## 2. Orden lógico de implementación (resumen)

```
Fase 0  Preparación, cuentas y certificado propio de pruebas
Fase 1  Diseño de arquitectura multitenant + decisión de almacenamiento de claves
Fase 2  Generación y validación de XML (DE) contra XSD
Fase 3  Firma digital XAdES
Fase 4  Conexión a Web Services SIFEN (mTLS, síncrono y asíncrono)
Fase 5  KuDE (QR), eventos y operación de contingencia
Fase 6  Conservación de DTE y gestión de errores/reintentos
Fase 7  Pruebas de homologación con la DNIT (ambiente test)
Fase 8  Flujo de onboarding por cliente (lo que hacés por cada tenant)
Fase 9  Pase a producción y operación
```

Las fases 2 a 6 son secuenciales en cuanto a dependencias técnicas, pero podés solapar el diseño de la Fase 8 (onboarding) mientras desarrollás. La Fase 7 está **condicionada por los tiempos de respuesta de la DNIT** y por la entrega del certificado por parte del PSC.

---

## 3. Plan detallado por fases

### Fase 0 — Preparación, cuentas y certificado de pruebas

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 0.1 | Leer Manual Técnico vigente + Guía de Pruebas + guías de habilitación | 16 HE | Lectura densa; no delegable a IA. Tomá notas de validaciones y campos obligatorios |
| 0.2 | Definir la entidad jurídica/RUC con la que tu empresa hará las pruebas iniciales (puede ser tu propio RUC) | 4 HE | Necesario para habilitarte vos como facturador electrónico de prueba |
| 0.3 | Adquirir un **certificado digital de prueba** a nombre de tu RUC en un PSC (eFirma/Code100/Documenta) | 4 HE + **3–10 días calendario** | El trámite y la entrega los controla el PSC |
| 0.4 | Solicitar habilitación como facturador electrónico en Marangatú y obtener el **set de datos de prueba + timbrado de test** (lo envía el Equipo SIFEN por correo) | 4 HE + **días/semanas calendario** | Requiere RUC activo y estar al día con obligaciones |
| 0.5 | Crear repositorio, pipeline CI/CD en Azure DevOps/GitHub Actions y entorno base del backend Java | 6 HE | IA acelera mucho el boilerplate |

**Subtotal Fase 0:** ~34 HE de esfuerzo, pero **dominado por esperas externas** (certificado + habilitación). Calendario realista: 2–4 semanas.

---

### Fase 1 — Diseño de arquitectura multitenant y almacenamiento de claves

Esta fase define cómo guardás y usás los certificados de cada tenant. Es la decisión de seguridad más sensible del proyecto.

**Opciones de almacenamiento de claves privadas (de mayor a menor recomendación para tu caso):**

1. **Azure Key Vault (Premium, respaldado por HSM) — recomendado.** Un certificado por tenant, importado como objeto *certificate/secret*. La clave privada no sale del Vault o, en tier Premium, queda en HSM validado FIPS 140-2. Control de acceso por *managed identity* del backend, auditoría completa y rotación gestionada. Costo por operación y por certificado, pero es el estándar para SaaS sobre Azure.
2. **Azure Key Vault Standard.** Igual modelo, sin HSM dedicado. Aceptable si el costo del Premium es prohibitivo al inicio; migrable después.
3. **PFX cifrado en almacenamiento propio (Blob + clave en Key Vault).** Más barato pero traslada a vos la responsabilidad de custodia de la clave en memoria; mayor superficie de riesgo. Solo como puente temporal.
4. **Token/HSM físico por cliente.** Inviable para un SaaS en la nube (requiere hardware presente). Descartado.

> 🔐 **Consideraciones legales sobre la clave privada:** la normativa paraguaya (Ley 4017/10) establece que el titular debe mantener la clave de creación de firma **bajo su exclusivo control**. Que vos custodies operativamente el certificado de un cliente para firmar en su nombre debe quedar **explícitamente autorizado por contrato/mandato** con cada peluquería, y conviene validar el esquema con el PSC emisor y con un asesor legal. Documentá el consentimiento como parte del onboarding.

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 1.1 | Confirmar con SIFEN el esquema de transmisión (tercero autorizado vs. mTLS por emisor) | 4 HE + espera | **Bloqueante** para 1.3 |
| 1.2 | Diseñar el modelo de datos multitenant (aislamiento por tenant: esquema, RUC, timbrado, establecimiento, punto de expedición, numeración) | 8 HE | Cada tenant lleva su propia secuencia de numeración por timbrado/establecimiento/punto |
| 1.3 | Diseñar la capa de gestión de certificados (carga dinámica desde Key Vault por tenant, cacheo seguro, manejo de expiración) | 10 HE | Núcleo del multitenant |
| 1.4 | Definir arquitectura de servicios (módulo de generación, módulo de firma, módulo de transporte, cola de reintentos) | 8 HE | Recomendable async con cola (Azure Service Bus / Storage Queue) por el modelo de lotes |
| 1.5 | Aprovisionar Azure Key Vault y wiring de *managed identity* | 4 HE | |

**Subtotal Fase 1:** ~34 HE.

---

### Fase 2 — Generación y validación del XML (DE)

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 2.1 | Modelar las clases del DE a partir de los **XSD v vigente** (Factura Electrónica como prioridad 1) | 12 HE | Podés autogenerar desde XSD (JAXB/xjc) con ayuda de IA |
| 2.2 | Implementar el cálculo del **CDC (44 dígitos)** y su dígito verificador | 6 HE | Algoritmo definido en el Manual Técnico; testeable con vectores conocidos |
| 2.3 | Mapear campos obligatorios del emisor por tenant (RUC, timbrado, establecimiento, punto de expedición, actividad económica, domicilio) | 8 HE | Datos que vienen de la config de cada tenant |
| 2.4 | Generar tipos de documento: Factura Electrónica, Nota de Crédito y Nota de Débito (los relevantes para una peluquería) | 10 HE | Autofactura y Nota de Remisión solo si tu negocio las necesita |
| 2.5 | Validación local contra XSD antes de transmitir | 4 HE | Evita rechazos por esquema; barato y muy rentable |

**Subtotal Fase 2:** ~40 HE.

> 💡 Una peluquería típica vende servicios y, a veces, productos. En la práctica te alcanzará al inicio con **Factura Electrónica + Nota de Crédito** (devoluciones/anulaciones). Priorizá eso y diferí el resto.

---

### Fase 3 — Firma digital XAdES

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 3.1 | Implementar la firma **XAdES** sobre el XML según el estándar del Manual Técnico (referencia al CDC en el atributo URI del tag *Reference*, precedido de `#`) | 14 HE | Apóyate en la librería open source `rshk-jsifenlib` (Maven: `com.roshka.sifen:rshk-jsifenlib`) que ya implementa firma y WS |
| 3.2 | Integrar la firma con la carga de certificado por tenant desde Key Vault (no leer PFX desde disco) | 10 HE | La lib de referencia carga PFX desde archivo; probablemente debas adaptar/forkear para firmar con clave gestionada por Key Vault |
| 3.3 | Validar que el RUC del certificado coincide con el RUC del emisor antes de firmar (pre-chequeo para evitar rechazo 0142) | 4 HE | |
| 3.4 | Pruebas unitarias de firma (verificación de integridad y cadena de confianza) | 6 HE | |

**Subtotal Fase 3:** ~34 HE.

> 🧩 **Decisión técnica clave:** evaluá temprano si `rshk-jsifenlib` te sirve tal cual o si la custodia en Key Vault te obliga a adaptarla. Reutilizar la librería puede ahorrarte ~30–40% del esfuerzo de las Fases 3 y 4; adaptarla a Key Vault te suma trabajo. Hacé un spike de 1 día antes de comprometer el enfoque.

---

### Fase 4 — Conexión a los Web Services del SIFEN

El SIFEN expone servicios **síncronos** (`siRecepDE` recepción de un DE, `siRecepEvento`, `siConsDE` consulta de DE, `siConsRUC` consulta de RUC) y **asíncronos** (`siRecepLoteDE` recepción de lote, `siResultLoteDE` consulta de resultado de lote). El síncrono devuelve resultado inmediato; el asíncrono devuelve un número de lote/protocolo que luego consultás.

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 4.1 | Implementar cliente SOAP con **mTLS** apuntando al ambiente de **test** | 12 HE | El certificado de cliente y su selección por tenant dependen de lo confirmado en 1.1 |
| 4.2 | Implementar **recepción síncrona** de DE y parseo de respuesta (aprobación/rechazo + nº de transacción) | 8 HE | Camino principal para volumen bajo (peluquería) |
| 4.3 | Implementar **recepción de lote (asíncrono)** + consulta de resultado de lote | 10 HE | Útil para reprocesos y picos |
| 4.4 | Implementar **consulta de RUC** y **consulta de DE** | 6 HE | Consulta RUC sirve para validar datos del cliente receptor |
| 4.5 | Mapear todos los **códigos de rechazo** del Manual Técnico a errores accionables del sistema | 8 HE | Crítico para soporte; cada código tiene una causa concreta |
| 4.6 | Cola de transmisión con reintentos y control del **plazo de 72 h** | 8 HE | Service Bus + política de reintentos exponenciales |

**Subtotal Fase 4:** ~52 HE.

---

### Fase 5 — KuDE (QR), eventos y contingencia

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 5.1 | Generar el **KuDE** (PDF con representación gráfica + **código QR**) usando el **CSC** del timbrado | 14 HE | El QR permite al consumidor validar el documento; el CSC se gestiona por tenant |
| 5.2 | Implementar **eventos**: cancelación, inutilización, y eventos del receptor según corresponda | 12 HE | Imprescindible cancelación; el resto según necesidad de negocio |
| 5.3 | Implementar **operación de contingencia** (emisión cuando el SIFEN no responde) y posterior regularización | 10 HE | Definida en el Manual Técnico; necesaria para continuidad operativa |
| 5.4 | Entrega del KuDE al cliente (descarga, email; opcionalmente WhatsApp) | 6 HE | |

**Subtotal Fase 5:** ~42 HE.

---

### Fase 6 — Conservación de DTE, observabilidad y errores

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 6.1 | Almacenamiento y **conservación de los XML/DTE** firmados y aprobados (requisito legal) con aislamiento por tenant | 8 HE | Definí política de retención; Blob con inmutabilidad es buena opción |
| 6.2 | Trazabilidad/auditoría por documento (estado, nº transacción, lote, reintentos) | 8 HE | |
| 6.3 | Tablero de monitoreo y alertas (documentos rechazados, cola atascada, certificados por expirar) | 8 HE | |
| 6.4 | Alertas de **expiración de certificados** por tenant | 4 HE | Un certificado vencido frena la facturación de ese cliente |

**Subtotal Fase 6:** ~28 HE.

---

### Fase 7 — Pruebas de homologación con la DNIT (ambiente test)

La **Guía de Pruebas** define los escenarios mínimos. A grandes rasgos debés demostrar:

- Comunicación y **autenticación mutua** con los WS (síncrono, asíncrono, consulta resultado lote, consulta DE, recepción de evento), incluyendo un caso con **certificado NO válido** que debe ser rechazado correctamente.
- **Transmisión de DE** por WS síncrono y asíncrono que deben ser **aprobados**.
- Transmisión de DE con **información incorrecta** que deben ser **rechazados** (validación de esquema, certificado/firma y negocio).
- **Recepción, registro y asociación de eventos** a los DE/DTE.

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 7.1 | Construir la batería de casos de prueba según la Guía (datos correctos e incorrectos) | 12 HE | |
| 7.2 | Ejecutar y depurar contra el ambiente test hasta pasar todos los escenarios | 20 HE + **calendario variable** | Iterativo; cada rechazo se diagnostica con el código del MT. Usá la Mesa de Ayuda del SIFEN |
| 7.3 | Documentar evidencias de cada escenario superado | 6 HE | |

**Subtotal Fase 7:** ~38 HE de esfuerzo, pero **calendario dependiente de la DNIT** (idas y vueltas con la Mesa de Ayuda). Referencias de mercado hablan de 2–4 semanas para una integración completa de homologación, pero puede extenderse.

---

### Fase 8 — Flujo de onboarding por cliente (lo que hacés por CADA tenant)

Esto es lo que se repite cada vez que sumás una peluquería. **Idealmente lo automatizás y/o lo convertís en un checklist guiado dentro del producto.** Por cada tenant:

1. **Verificar prerrequisitos del cliente:** RUC activo, al día con obligaciones tributarias, con acceso a Marangatú.
2. **Certificado digital:** el cliente adquiere (o vos gestionás en su nombre, con autorización) un certificado a nombre de su persona jurídica en un PSC habilitado. Debe contener su RUC.
3. **Habilitación como facturador electrónico** en Marangatú y obtención del **timbrado electrónico** (primero el de prueba si corresponde, luego el de producción), seleccionando los tipos de comprobante.
4. **Carga segura del certificado** en Key Vault asociado al tenant + registro de **CSC**, timbrado, establecimiento(s) y punto(s) de expedición en la config del tenant.
5. **Captura del mandato/autorización** del cliente para que tu sistema firme y transmita en su nombre.
6. **Prueba de emisión real controlada** (un primer documento) antes de habilitar el flujo normal.
7. **Recordatorio:** tras obtener el timbrado de producción, el contribuyente tiene **6 meses** para migrar toda su emisión a electrónico.

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 8.1 | Construir el **wizard de onboarding** (alta de tenant, carga de certificado, datos de timbrado/CSC/establecimiento) | 16 HE | Reduce drásticamente el costo marginal por cliente |
| 8.2 | Validaciones automáticas de configuración (consulta RUC, coincidencia RUC↔certificado, vigencia) | 8 HE | |
| 8.3 | Plantilla de contrato/mandato y registro de consentimiento | 4 HE + legal | Coordiná con asesor legal |
| 8.4 | Documentación de usuario para el cliente (cómo obtener certificado y timbrado) | 6 HE | |

**Subtotal Fase 8 (one-time, construcción del flujo):** ~34 HE.
**Costo marginal recurrente por cliente** una vez automatizado: principalmente la espera de su certificado y timbrado (externo) + minutos de configuración.

---

### Fase 9 — Pase a producción y operación

| # | Tarea | Esfuerzo | Notas |
|---|---|---|---|
| 9.1 | Repuntar la integración al **ambiente de producción** del SIFEN (URLs, timbrado de producción por tenant) | 6 HE | |
| 9.2 | Hardening de seguridad (rotación de claves, principio de mínimo privilegio, revisión de logs sin datos sensibles) | 10 HE | |
| 9.3 | Runbook de incidentes (qué hacer si SIFEN cae, si un certificado vence, si un lote queda atascado) | 6 HE | |
| 9.4 | Piloto con 1 peluquería real y ajuste | 12 HE + calendario | |

**Subtotal Fase 9:** ~34 HE.

---

## 4. Resumen de esfuerzo y calendario

| Fase | Esfuerzo (HE) | Comentario de calendario |
|---|---|---|
| 0 — Preparación | ~34 | Dominado por esperas externas (2–4 sem.) |
| 1 — Arquitectura y claves | ~34 | |
| 2 — XML (DE) | ~40 | |
| 3 — Firma XAdES | ~34 | |
| 4 — Web Services | ~52 | |
| 5 — KuDE/eventos/contingencia | ~42 | |
| 6 — Conservación/observabilidad | ~28 | |
| 7 — Homologación DNIT | ~38 | Calendario dependiente de la DNIT |
| 8 — Onboarding por cliente | ~34 | |
| 9 — Producción | ~34 | |
| **Total** | **~370 HE** | |

**Traducción a calendario** a 20 h/semana efectivas: ~370 HE ≈ **18–19 semanas de trabajo neto**. Sumando las esperas externas no paralelizables (entrega de certificado, habilitación, ciclos de homologación con la DNIT) y el solapamiento posible entre fases, una estimación realista de punta a punta es **5 a 7 meses calendario**. El mayor riesgo de cronograma no es el código —que la IA acelera— sino los tiempos de respuesta de la DNIT y del PSC, y la confirmación del esquema de transmisión multitenant (tarea 1.1), que es bloqueante.

**Dónde la IA ayuda más:** generación de clases desde XSD, boilerplate de clientes SOAP, mapeo de códigos de rechazo, tests, KuDE/PDF, wizard de onboarding. **Dónde NO ayuda:** lectura/interpretación normativa, trámites ante DNIT/PSC, decisiones de arquitectura de seguridad, y los ciclos de validación con la Mesa de Ayuda.

---

## 5. Riesgos principales

1. **Esquema de transmisión multitenant (tarea 1.1):** si la DNIT exige mTLS con el certificado de cada emisor, tu capa de transporte se complica (selección dinámica de certificado de cliente por conexión). Resolvelo antes de codificar la Fase 4.
2. **Cambios de versión del Manual Técnico / Notas Técnicas:** pueden invalidar XSD o agregar campos. Mantené el código parametrizado por versión.
3. **Custodia legal de claves de terceros:** asegurá el mandato contractual por tenant; es tanto un tema legal como de confianza.
4. **Vencimiento de certificados:** un certificado vencido detiene la facturación de un cliente; las alertas (6.4) no son opcionales.
5. **Plazo de 72 h:** tu cola de reintentos debe garantizar transmisión dentro del plazo o escalar.

---

# Backlog — Épicas y User Stories

> Formato: cada épica agrupa user stories con **criterios de aceptación (CA)** verificables.

## Épica 1 — Gestión multitenant de identidad fiscal y certificados

**US 1.1 — Alta de tenant (peluquería)**
Como administrador de la plataforma, quiero dar de alta una peluquería como tenant para que pueda emitir sus propias facturas.
- **CA1:** puedo registrar RUC, razón social, domicilio fiscal, actividad económica, establecimiento(s) y punto(s) de expedición.
- **CA2:** el sistema valida el RUC contra el servicio de consulta de RUC del SIFEN y rechaza un RUC inactivo.
- **CA3:** los datos de un tenant son inaccesibles desde el contexto de otro tenant (aislamiento verificado por prueba).

**US 1.2 — Carga segura del certificado del tenant**
Como administrador, quiero cargar el certificado digital de una peluquería para que el sistema firme en su nombre.
- **CA1:** acepta archivos PFX/PKCS#12 y los almacena en Azure Key Vault asociados al tenant.
- **CA2:** el sistema verifica que el RUC del certificado coincide con el RUC del tenant; si no, rechaza la carga con mensaje claro.
- **CA3:** la clave privada nunca se escribe en logs ni en almacenamiento sin cifrar.
- **CA4:** se registra fecha de expiración del certificado.

**US 1.3 — Alertas de expiración de certificado**
Como administrador, quiero recibir alertas antes de que venza un certificado para que ningún cliente quede sin poder facturar.
- **CA1:** se genera alerta a 30, 15 y 5 días de la expiración.
- **CA2:** un certificado vencido bloquea la emisión del tenant y muestra motivo accionable.

**US 1.4 — Registro de mandato/autorización**
Como responsable de cumplimiento, quiero registrar la autorización del cliente para firmar/transmitir en su nombre.
- **CA1:** no se habilita la emisión productiva de un tenant sin un consentimiento registrado (fecha, versión del documento).

## Épica 2 — Generación de Documentos Electrónicos (DE)

**US 2.1 — Emitir Factura Electrónica**
Como cajero de la peluquería, quiero emitir una factura electrónica por un servicio para entregarla al cliente.
- **CA1:** se genera un XML válido contra el XSD vigente con todos los campos obligatorios del emisor y del ítem.
- **CA2:** se calcula correctamente el CDC de 44 dígitos con dígito verificador válido.
- **CA3:** la numeración respeta la secuencia por timbrado/establecimiento/punto de expedición del tenant, sin huecos ni duplicados.
- **CA4:** un XML que no valida contra el XSD no se transmite y muestra el campo en falta.

**US 2.2 — Emitir Nota de Crédito**
Como cajero, quiero emitir una nota de crédito asociada a una factura para registrar una devolución o anulación.
- **CA1:** la nota referencia el CDC del documento original.
- **CA2:** los montos y el IVA se calculan de forma consistente con el documento referenciado.

**US 2.3 — Cálculo de impuestos**
Como sistema, quiero calcular IVA y totales según la normativa para que el documento sea aceptado.
- **CA1:** soporta tasas de IVA aplicables y exentos.
- **CA2:** los totales del XML cuadran con la suma de ítems (validación interna previa al envío).

## Épica 3 — Firma digital

**US 3.1 — Firmar el DE con el certificado del tenant**
Como sistema, quiero firmar digitalmente el XML con el certificado correcto para que el SIFEN lo acepte.
- **CA1:** la firma es XAdES y referencia el CDC en el atributo URI del *Reference* precedido por `#`.
- **CA2:** se firma con el certificado del tenant emisor recuperado de Key Vault, nunca con otro.
- **CA3:** si el RUC del certificado no coincide con el del emisor, se aborta antes de transmitir (previene rechazo 0142).
- **CA4:** la firma verifica correctamente con una validación independiente en las pruebas.

## Épica 4 — Transmisión al SIFEN

**US 4.1 — Transmisión síncrona de DE**
Como sistema, quiero enviar un DE de forma síncrona y conocer el resultado de inmediato.
- **CA1:** establece conexión mTLS válida con el WS correspondiente.
- **CA2:** ante aprobación, persiste el número de transacción y marca el documento como DTE.
- **CA3:** ante rechazo, persiste el/los código(s) de rechazo con su descripción legible.

**US 4.2 — Transmisión por lote (asíncrona)**
Como sistema, quiero enviar lotes de DE y consultar su resultado para procesar volumen y reprocesos.
- **CA1:** recibe y persiste el número de lote/protocolo.
- **CA2:** consulta el resultado del lote y actualiza el estado de cada documento.

**US 4.3 — Cola de transmisión con control de plazo de 72 h**
Como sistema, quiero reintentar transmisiones fallidas garantizando el plazo regulatorio.
- **CA1:** los fallos transitorios se reintentan con backoff exponencial.
- **CA2:** si un documento se acerca al límite de 72 h sin aprobarse, se genera una alerta de alta prioridad.
- **CA3:** ningún documento queda en estado indefinido sin visibilidad para soporte.

**US 4.4 — Consulta de RUC del receptor**
Como cajero, quiero validar el RUC del cliente para reducir rechazos.
- **CA1:** la consulta devuelve estado y datos del RUC; un RUC inválido se advierte antes de emitir.

## Épica 5 — KuDE y entrega al cliente

**US 5.1 — Generar KuDE con QR**
Como cajero, quiero entregar al cliente la representación gráfica de la factura.
- **CA1:** el KuDE incluye los datos obligatorios y un QR generado con el CSC del tenant.
- **CA2:** el QR permite la verificación del documento en el consultor público del SIFEN.

**US 5.2 — Entregar el KuDE**
Como cajero, quiero enviar el KuDE por email o descargarlo.
- **CA1:** puedo descargar el PDF y/o enviarlo por email al cliente.
- **CA2:** queda registro de la entrega.

## Épica 6 — Eventos y contingencia

**US 6.1 — Cancelar un documento**
Como administrador de la peluquería, quiero cancelar un documento emitido por error.
- **CA1:** se transmite el evento de cancelación y se actualiza el estado del documento según la respuesta del SIFEN.
- **CA2:** la cancelación respeta los plazos y condiciones del Manual Técnico.

**US 6.2 — Operar en contingencia**
Como cajero, quiero seguir emitiendo si el SIFEN no responde.
- **CA1:** el sistema permite emisión en contingencia conforme al Manual Técnico.
- **CA2:** al restablecerse el servicio, los documentos en contingencia se regularizan automáticamente y se notifica el resultado.

## Épica 7 — Conservación, auditoría y observabilidad

**US 7.1 — Conservar DTE**
Como responsable de cumplimiento, quiero conservar los XML aprobados según la normativa.
- **CA1:** cada DTE aprobado se almacena de forma íntegra y recuperable, aislado por tenant.
- **CA2:** existe una política de retención configurada y documentada.

**US 7.2 — Trazabilidad por documento**
Como soporte, quiero ver el ciclo de vida completo de un documento.
- **CA1:** puedo consultar estado, número de transacción, lote, reintentos y códigos de rechazo de cualquier documento.

**US 7.3 — Tablero operativo**
Como administrador de la plataforma, quiero un panel de salud de la facturación.
- **CA1:** muestra documentos rechazados, cola pendiente, certificados por vencer y errores recientes.
- **CA2:** dispara alertas configurables.

## Épica 8 — Onboarding de clientes

**US 8.1 — Wizard de habilitación del tenant**
Como administrador, quiero un asistente que me guíe en la puesta a punto de una peluquería.
- **CA1:** el wizard cubre: datos fiscales, carga de certificado, timbrado, CSC, establecimiento(s)/punto(s) y autorización.
- **CA2:** valida cada paso (consulta RUC, coincidencia RUC↔certificado, vigencia) antes de permitir avanzar.
- **CA3:** al finalizar, un documento de prueba real se emite y aprueba en test antes de habilitar producción.

**US 8.2 — Guía para el cliente**
Como cliente nuevo, quiero saber cómo obtener mi certificado y mi timbrado.
- **CA1:** el sistema muestra instrucciones y enlaces a PSC habilitados y al proceso de Marangatú.

## Épica 9 — Homologación y pase a producción

**US 9.1 — Batería de pruebas de homologación**
Como desarrollador, quiero ejecutar los escenarios de la Guía de Pruebas para validar la integración.
- **CA1:** se cubren los escenarios mínimos: autenticación mutua (incluido certificado inválido), transmisión síncrona y asíncrona aprobadas, transmisión con datos incorrectos rechazada, y recepción de eventos.
- **CA2:** cada escenario tiene evidencia registrada (request/response/código).

**US 9.2 — Conmutación a producción**
Como administrador, quiero pasar un tenant a producción de forma controlada.
- **CA1:** el sistema usa URLs y timbrado de producción del tenant.
- **CA2:** existe un runbook de rollback y de incidentes documentado.

---

### Nota final

Este plan se apoya en la documentación pública vigente de la DNIT/SIFEN al momento de su redacción. Antes de ejecutar, **descargá la versión actual del Manual Técnico y la Guía de Pruebas** desde el portal de la DNIT y **confirmá con la Mesa de Ayuda del SIFEN** los dos puntos que más condicionan tu arquitectura: (1) el esquema de transmisión para un proveedor que factura en nombre de múltiples contribuyentes, y (2) la versión de XSD/Notas Técnicas obligatoria. No soy abogado ni asesor tributario: los aspectos de mandato para custodiar certificados de terceros y de conservación documental conviene validarlos con un profesional en Paraguay.
