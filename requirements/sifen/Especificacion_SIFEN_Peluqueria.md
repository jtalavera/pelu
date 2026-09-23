# Especificación de integración SIFEN
### Sistema de facturación electrónica — Peluquería (multi-tenant)
*Épicas e historias de usuario — versión 3.0*

---

## Contexto y alcance

Este documento define, a nivel de requerimientos de negocio, las épicas e historias de usuario para la integración del sistema de facturación de la peluquería con el Sistema Integrado de Facturación Electrónica Nacional (SIFEN) de la DNIT, República del Paraguay.

El sistema existente genera facturas almacenadas en una tabla de base de datos. El alcance de este backlog es exclusivamente la capa de integración con SIFEN: tomar esas facturas y enviarlas, gestionar sus estados, generar el comprobante para el cliente, habilitar el sistema en producción mediante el proceso de homologación, y administrar de forma segura el certificado digital de cada cliente del sistema.

El sistema es **multi-tenant**: cada peluquería que usa el sistema (cada tenant) tiene su propio certificado digital y su propia clave privada, que deben almacenarse y utilizarse de forma completamente aislada entre tenants. Ningún tenant puede acceder, ver, ni usar el certificado de otro.

Además, toda la funcionalidad de facturación electrónica está condicionada a un **feature flag activable por tenant** (ver "Requisitos transversales" más abajo): mientras un tenant no lo tenga activado, sus facturas se siguen generando con el **generador de facturas tradicional** que el sistema ya usaba antes de esta integración, sin pasar por SIFEN. Al activar el flag, las nuevas facturas de ese tenant pasan a generarse mediante el flujo de SIFEN descrito en este documento.

En su operación diaria, cada peluquería solo emite un tipo de comprobante (factura) por la vía de envío inmediato, y solo utiliza dos eventos: la cancelación y la identificación posterior del cliente. Sin perjuicio de esto, la DNIT exige demostrar, durante la homologación, que el sistema también sabe manejar los demás tipos de comprobante, la vía de envío por lotes, y el resto de los eventos — por eso la épica EP-05 los cubre exclusivamente con fines de prueba.

El comprobante en PDF que se entrega al cliente (HU-08) se genera en formato de hoja A4. SIFEN no exige un diseño visual específico, pero sí exige qué información debe contener y algunas reglas puntuales (por ejemplo, las del código QR) que se detallan en esa historia.

---

## Glosario de conceptos

Estos conceptos se usan a lo largo del documento sin repetir su explicación en cada historia.

| Concepto | Qué significa |
|---|---|
| **Documento Electrónico (DE)** | El comprobante (factura, nota de crédito, etc.) ya generado y firmado digitalmente por la peluquería, pero todavía no confirmado por SIFEN. |
| **Documento Tributario Electrónico (DTE)** | El mismo documento, una vez que SIFEN lo aprobó. Recién en este estado tiene validez tributaria. |
| **Número de control (CDC)** | Un identificador único de 44 caracteres que se calcula para cada documento a partir de sus propios datos (tipo de documento, datos del emisor, timbrado, fecha, etc.). Sirve para que SIFEN nunca confunda ni duplique un documento. |
| **Timbrado** | La autorización numérica que la DNIT otorga a la peluquería para emitir comprobantes, con un número de establecimiento y un punto de expedición asociados. |
| **Emisor y receptor** | El emisor es la peluquería, que genera y firma el documento. El receptor es el cliente al que se le presta el servicio. |
| **Firma digital** | Un mecanismo que usa el certificado digital de la peluquería para garantizar que el documento no fue alterado y que efectivamente lo generó la peluquería. |
| **Certificado digital** | El archivo (emitido por una entidad certificadora habilitada) que identifica digitalmente a la peluquería y que se usa tanto para conectarse con SIFEN como para firmar los documentos. |
| **Archivo .p12** | El formato de archivo estándar que empaqueta el certificado digital junto con su clave privada, protegido por una contraseña. |
| **Azure Key Vault** | Servicio de Azure para almacenar y administrar de forma centralizada claves criptográficas y otros secretos, con control de acceso, auditoría y rotación, sin exponerlos en archivos de configuración ni variables de entorno. |
| **Identidad administrada (Managed Identity)** | Mecanismo de Azure que le da a un servicio (por ejemplo, el backend) una identidad propia para autenticarse ante otros servicios de Azure (como Key Vault) sin necesidad de guardar ninguna credencial o secreto de conexión. |
| **Tenant** | Cada peluquería (cliente) que usa el sistema de forma independiente, con sus propios datos, certificado y configuración, aislados de los demás tenants. |
| **Ambiente de prueba / producción** | SIFEN ofrece un ambiente de prueba (sin valor legal, usado para homologar el sistema) y un ambiente de producción (donde los documentos aprobados sí tienen valor tributario). |
| **Envío inmediato** | El documento se envía a SIFEN de a uno y la respuesta (aprobado o rechazado) llega en el momento. Es el modo que usa la peluquería en su operación diaria. |
| **Envío por lotes** | Varios documentos se agrupan y se envían juntos; SIFEN los procesa en una cola y el resultado se consulta más tarde. No se usa en la operación diaria de la peluquería, pero sí es exigido durante la homologación del sistema. |
| **Evento** | Una anotación que se registra sobre un documento ya aprobado por SIFEN (por ejemplo, para cancelarlo o para identificar al cliente después de emitido). No reemplaza al documento original, solo le agrega información. |
| **Comprobante en PDF (KuDE)** | La representación visual del documento electrónico en formato PDF, con un código QR, que se le entrega o envía al cliente. |
| **Homologación** | El proceso de pruebas exigido por la DNIT antes de habilitar el sistema en el ambiente de producción. |
| **Feature flag de facturación electrónica** | Un interruptor que activa o desactiva, de forma independiente para cada tenant, toda la funcionalidad de integración con SIFEN. Mientras está desactivado, el tenant sigue operando el sistema con normalidad, pero ninguna funcionalidad relacionada con SIFEN se ejecuta para él. |
| **Generador de facturas tradicional** | El mecanismo de facturación en PDF que el sistema ya utilizaba antes de esta integración. No genera número de control, no firma digitalmente, ni interactúa con SIFEN de ninguna forma. Es el mecanismo que se usa para un tenant mientras su feature flag de facturación electrónica está desactivado. |

---

## Requisitos transversales (cross-cutting concerns)

Estos requisitos no pertenecen a una única historia, sino que aplican de forma horizontal a todas las épicas de facturación electrónica (EP-01 a EP-05). Cualquier historia de esas épicas debe cumplirlos, aunque no se repitan en cada una de ellas.

### Activación de la facturación electrónica por tenant

Toda la lógica de facturación electrónica (preparar el documento, firmarlo, enviarlo a SIFEN, generar el comprobante, cancelar, identificar al cliente, y las pruebas de homologación) está condicionada a que el tenant tenga activado su feature flag de facturación electrónica. Este flag se administra de forma independiente para cada tenant.

**Reglas de negocio transversales:**

| ID | Regla (testeable) |
|---|---|
| RT-01 | Mientras el feature flag de un tenant está desactivado, toda factura de ese tenant se genera mediante el generador de facturas tradicional (el mecanismo en PDF existente antes de esta integración), sin ejecutar ninguna etapa de la integración con SIFEN: no se genera número de control, no se firma digitalmente, no se envía a SIFEN, y no existen las opciones de cancelar o identificar al cliente ante SIFEN. |
| RT-02 | El usuario que emite una factura no elige manualmente el mecanismo a usar; el sistema decide automáticamente entre el generador tradicional y el flujo de SIFEN según el estado del flag del tenant en ese momento. |
| RT-03 | Activar o desactivar el flag de un tenant no afecta, bajo ninguna circunstancia, el flag ni la operación de ningún otro tenant. |
| RT-04 | Desactivar el flag de un tenant no cancela, modifica, ni oculta las facturas que ese tenant ya había enviado a SIFEN antes de la desactivación; esas facturas conservan su estado. A partir de la desactivación, las facturas nuevas de ese tenant pasan a emitirse con el generador tradicional. |
| RT-05 | Activar el flag de un tenant no reprocesa ni reenvía automáticamente a SIFEN ninguna factura anterior emitida con el generador tradicional; esas facturas quedan tal como fueron emitidas. A partir de la activación, las facturas nuevas de ese tenant pasan a emitirse mediante el flujo de SIFEN (siempre que además tenga un certificado vigente cargado). |
| RT-06 | Las pruebas de homologación (EP-05) solo pueden ejecutarse para un tenant y ambiente con el flag activado; si está desactivado, las pruebas fallan de forma explícita indicando el motivo. |
| RT-07 | El sistema admite que un mismo tenant tenga, en su historial, tanto facturas emitidas con el generador tradicional como facturas emitidas mediante SIFEN (por ejemplo, si el flag estuvo desactivado y luego se activó), sin que esta coexistencia genere errores ni inconsistencias en el listado de facturas. |

### Manejo de activos criptográficos según el ambiente de ejecución

Este requisito aplica de forma transversal a todo activo criptográfico sensible de la integración: el archivo `.p12` cargado en HU-18, la clave privada que contiene, la contraseña que lo protege, y cualquier clave maestra que el sistema use para cifrarlos en reposo. El ambiente de pruebas end-to-end (`e2e`) es una excepción deliberada a estas reglas, ya que corre siempre contra una base de datos en memoria descartable y sin conectividad a servicios de Azure.

**Reglas de negocio transversales:**

| ID | Regla (testeable) |
|---|---|
| RT-08 | Cuando el sistema corre en el perfil de pruebas end-to-end (`e2e`), los activos criptográficos pueden almacenarse cifrados en archivos y en tablas de la base de datos de la aplicación, y la clave maestra que los cifra puede administrarse mediante configuración local (variable de entorno o archivo de propiedades). |
| RT-09 | En cualquier otro ambiente (desarrollo contra Azure, homologación, producción), la clave maestra que cifra los activos criptográficos no se administra mediante variables de entorno ni archivos de configuración de la aplicación: el sistema la obtiene en tiempo de ejecución desde Azure Key Vault. |
| RT-10 | En cualquier otro ambiente que no sea `e2e`, el acceso del backend a Azure Key Vault se realiza mediante una identidad administrada (Managed Identity) de Azure asignada al servicio, sin credenciales, cadenas de conexión, ni secretos de acceso a Key Vault almacenados en el código, la configuración, o variables de entorno. |
| RT-11 | Ninguna clave privada de tenant, contraseña de certificado, ni clave maestra de cifrado se registra en logs, mensajes de error, ni trazas de la aplicación, en ningún ambiente. |

---

## Tabla resumen — épicas e historias de usuario

| Épica | Nombre de la épica | HU | Nombre de la historia |
|---|---|---|---|
| **EP-01** | Preparación del documento electrónico | HU-01 | Generar el número de control de una factura |
| | | HU-02 | Completar los datos de identificación, timbrado, emisor y receptor |
| | | HU-03 | Completar los servicios facturados y calcular los totales |
| | | HU-04 | Firmar digitalmente el documento |
| **EP-02** | Envío a SIFEN y resultado | HU-05 | Conectarse de forma segura con SIFEN |
| | | HU-06 | Enviar una factura a SIFEN y registrar el resultado |
| | | HU-07 | Verificar en SIFEN el estado de una factura pendiente |
| **EP-03** | Comprobante para el cliente | HU-08 | Generar el comprobante en PDF de una factura aprobada |
| | | HU-09 | Revalidar en SIFEN una factura desde el sistema |
| **EP-04** | Corrección de facturas ya emitidas | HU-10 | Cancelar una factura ya aprobada |
| | | HU-11 | Identificar al cliente en una factura emitida sin sus datos |
| **EP-05** | Homologación ante la DNIT | HU-12 | Probar la conexión segura contra todos los servicios de SIFEN |
| | | HU-13 | Probar el envío inmediato de facturas correctas e incorrectas |
| | | HU-14 | Probar el envío inmediato de los demás tipos de comprobante exigidos |
| | | HU-15 | Probar el envío por lotes de todos los tipos de comprobante |
| | | HU-16 | Probar el registro de todos los eventos exigidos |
| | | HU-17 | Probar la consulta de documentos y la generación de comprobantes de todos los tipos |
| **EP-06** | Gestión de activos criptográficos | HU-18 | Cargar un nuevo certificado y clave para un tenant |
| | | HU-19 | Ver el listado de certificados cargados de un tenant |
| | | HU-20 | Calcular el estado de cada certificado según su vigencia |
| | | HU-21 | Usar automáticamente el certificado vigente del tenant en las funcionalidades de facturación |
| **EP-07** | Activación de la facturación electrónica por tenant | HU-22 | Activar o desactivar la facturación electrónica para un tenant |

---

## Detalle de épicas e historias de usuario

## EP-01 — Preparación del documento electrónico

*Capacidad de tomar una factura existente del sistema y transformarla en un documento electrónico completo, correctamente firmado, listo para enviar a SIFEN.*

### HU-01 — Generar el número de control de una factura

**Épica:** EP-01 | **Historia:** HU-01

**Descripción**
Como sistema de facturación, quiero generar el número de control único de cada factura a partir de sus propios datos, de modo que cada documento enviado a SIFEN quede identificado de forma inequívoca y no se pueda confundir ni duplicar con otro.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | El número de control generado tiene exactamente 44 caracteres. |
| AC-02 | El número de control incluye un dígito de verificación que permite detectar si fue transcrito o alterado incorrectamente. |
| AC-03 | Si el RUC de la peluquería o el número de comprobante tienen menos dígitos que los requeridos, el sistema los completa con ceros a la izquierda antes de generar el número de control. |
| AC-04 | El número de control incluye un código de seguridad aleatorio que nunca coincide con el número de comprobante de la factura. |
| AC-05 | Dos facturas con datos distintos entre sí siempre generan números de control distintos. |
| AC-06 | Generar el número de control dos veces para la misma factura ya procesada produce siempre el mismo resultado (no se regenera al azar en cada intento). |

---

### HU-02 — Completar los datos de identificación, timbrado, emisor y receptor

**Épica:** EP-01 | **Historia:** HU-02

**Descripción**
Como sistema de facturación, quiero completar en el documento electrónico los datos generales que SIFEN exige: la identificación del documento (número de control), el timbrado vigente, los datos de la peluquería como emisor y los datos del cliente como receptor, de modo que el documento tenga la información mínima necesaria para que SIFEN pueda evaluarlo.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | El documento incluye el número de control generado en HU-01. |
| AC-02 | El documento incluye el timbrado, el establecimiento y el punto de expedición vigentes configurados para la peluquería. |
| AC-03 | El documento incluye los datos de la peluquería tal como están registrados ante la DNIT (RUC, razón social, dirección, actividad económica). |
| AC-04 | Si el cliente es un consumidor final sin RUC, el documento se genera igual sin exigir sus datos de identificación. |
| AC-05 | Si el total de la venta es igual o mayor a Gs. 7.000.000, el sistema exige identificar al cliente (documento de identidad o RUC) antes de continuar, sin excepción. |
| AC-06 | Si el cliente tiene RUC, el documento incluye el RUC y el nombre o razón social del cliente. |
| AC-07 | Si se informa la dirección del cliente, el documento también incluye su departamento y ciudad. |
| AC-08 | Todo documento generado en el ambiente de prueba incluye la leyenda que indica que no tiene valor comercial ni fiscal. |

---

### HU-03 — Completar los servicios facturados y calcular los totales

**Épica:** EP-01 | **Historia:** HU-03

**Descripción**
Como sistema de facturación, quiero completar en el documento electrónico el detalle de los servicios prestados y calcular correctamente los totales e impuestos, de modo que el documento refleje con exactitud el importe cobrado al cliente y el IVA correspondiente.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | El documento incluye una línea por cada servicio facturado, con su descripción, cantidad y precio unitario. |
| AC-02 | La descripción de cada servicio admite textos largos (hasta 2000 caracteres) para detallar el servicio prestado. |
| AC-03 | El impuesto de cada servicio se calcula según la tasa que corresponda (gravado, exento, o gravado parcial) y el resultado es matemáticamente correcto para esa tasa. |
| AC-04 | El total general del documento es igual a la suma de los importes de cada servicio, incluyendo los impuestos correspondientes. |
| AC-05 | Si se aplica un descuento sobre algún servicio, el total general refleja ese descuento. |
| AC-06 | Si la venta es al contado, el documento especifica la forma de pago utilizada (efectivo, tarjeta, transferencia, etc.). |

---

### HU-04 — Firmar digitalmente el documento

**Épica:** EP-01 | **Historia:** HU-04

**Descripción**
Como sistema de facturación, quiero firmar digitalmente cada documento electrónico utilizando el certificado digital de la peluquería, de modo que el documento tenga validez legal y SIFEN pueda confirmar que no fue alterado y que efectivamente lo generó la peluquería.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | Todo documento enviado a SIFEN incluye una firma digital que cubre todo su contenido. |
| AC-02 | Si el certificado digital está vencido o revocado, el sistema no firma el documento e informa el motivo antes de intentar enviarlo. |
| AC-03 | Un documento modificado después de haber sido firmado deja de ser válido; cualquier alteración posterior es detectable. |
| AC-04 | El sistema utiliza un nivel de seguridad de firma vigente y aceptado por SIFEN, no uno obsoleto o dado de baja. |
| AC-05 | Dado un documento correctamente firmado, la validez de la firma puede verificarse de forma independiente sin errores. |
| AC-06 | El certificado y la clave privada utilizados para firmar son los del tenant al que pertenece la factura, obtenidos según lo definido en HU-21. |

---

## EP-02 — Envío a SIFEN y resultado

*Capacidad de enviar el documento a SIFEN por la vía de envío inmediato, recibir la confirmación (aprobado o rechazado) y dejar registrado el resultado en el sistema.*

### HU-05 — Conectarse de forma segura con SIFEN

**Épica:** EP-02 | **Historia:** HU-05

**Descripción**
Como sistema de facturación, quiero establecer una conexión segura con SIFEN usando el certificado digital de la peluquería, de modo que la comunicación quede autenticada antes de enviar cualquier documento.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | Dado el certificado digital vigente de la peluquería, el sistema logra conectarse exitosamente al ambiente de prueba de SIFEN. |
| AC-02 | Dado un certificado cuyo RUC no coincide con el de la peluquería configurada, la conexión es rechazada con un error identificable. |
| AC-03 | Dado un certificado no emitido por una entidad certificadora habilitada, la conexión es rechazada. |
| AC-04 | El sistema permite cambiar entre el ambiente de prueba y el ambiente de producción sin modificar el código, solo la configuración. |
| AC-05 | Cada intento de conexión queda registrado con fecha, hora, ambiente utilizado y resultado. |
| AC-06 | El certificado utilizado para conectarse es el del tenant correspondiente a la operación en curso, obtenido según lo definido en HU-21. |

---

### HU-06 — Enviar una factura a SIFEN y registrar el resultado

**Épica:** EP-02 | **Historia:** HU-06

**Descripción**
Como sistema de facturación, quiero enviar el documento firmado a SIFEN por la vía de envío inmediato y registrar el resultado que SIFEN devuelve, de modo que cada factura quede con su estado final reflejado en el sistema.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | Dado un documento firmado válido, el sistema lo envía a SIFEN y espera la respuesta en la misma conexión. |
| AC-02 | Dado que SIFEN aprueba el documento, el sistema guarda el estado 'Aprobado' junto con el número de trámite que devuelve SIFEN. |
| AC-03 | Dado que SIFEN aprueba el documento con alguna observación, el sistema guarda el estado 'Aprobado con observación' junto con el detalle de la observación. |
| AC-04 | Dado que SIFEN rechaza el documento, el sistema guarda el estado 'Rechazado' junto con el motivo del rechazo. |
| AC-05 | Dado que no se recibe respuesta de SIFEN (por un corte de comunicación), el sistema no reenvía automáticamente el mismo documento; en cambio, lo marca como 'pendiente de verificación'. |
| AC-06 | El sistema no permite volver a enviar a SIFEN una factura que ya tiene un estado 'Aprobado' registrado. |
| AC-07 | El sistema no permite enviar a SIFEN una factura firmada hace más de 72 horas sin haber sido enviada antes. |

---

### HU-07 — Verificar en SIFEN el estado de una factura pendiente

**Épica:** EP-02 | **Historia:** HU-07

**Descripción**
Como sistema de facturación, quiero poder consultar en SIFEN el estado de una factura marcada como 'pendiente de verificación', de modo que pueda confirmar si SIFEN efectivamente la recibió y cuál fue su resultado final.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | Dado el número de control de una factura aprobada en SIFEN, la consulta confirma su aprobación y el sistema actualiza el estado a 'Aprobado'. |
| AC-02 | Dado el número de control de una factura que SIFEN no reconoce o rechazó, el sistema actualiza el estado a 'No existe / Rechazado'. |
| AC-03 | El resultado de la consulta muestra el contenido completo del documento cuando SIFEN confirma que fue aprobado. |
| AC-04 | Desde la pantalla de una factura en estado 'pendiente de verificación', el usuario puede disparar la consulta manualmente con un botón. |
| AC-05 | La consulta también se dispara automáticamente cuando el sistema detecta una factura pendiente al reintentar el envío. |

---

## EP-03 — Comprobante para el cliente

*Capacidad de generar el comprobante en PDF (KuDE) de una factura aprobada, para entregar o enviar al cliente, y de revalidarla ante SIFEN cuando haga falta.*

### HU-08 — Generar el comprobante en PDF de una factura aprobada

**Épica:** EP-03 | **Historia:** HU-08

**Descripción**
Como sistema de facturación, quiero generar el comprobante en PDF, en formato de hoja A4, de una factura aprobada por SIFEN, con todos los datos de la venta y un código QR de validación, de modo que pueda entregarse o enviarse al cliente como respaldo del servicio prestado. El comprobante es una representación visual de la factura ya enviada a SIFEN: no es un documento nuevo ni puede contener información que no exista en la factura original.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | El comprobante en PDF solo puede generarse para facturas en estado 'Aprobado' o 'Aprobado con observación'. |
| AC-02 | El comprobante se genera en formato de hoja A4, en una o varias páginas según la cantidad de servicios facturados. |
| AC-03 | El comprobante incluye un encabezado con los datos de la peluquería (nombre o razón social, nombre de fantasía si tiene, actividad económica, dirección, ciudad) y los datos del timbrado (RUC, número de timbrado, fecha de inicio y fin de vigencia, número de comprobante). |
| AC-04 | El encabezado incluye también los datos generales de la venta: fecha y hora de emisión, condición de venta (contado o crédito, y cantidad de cuotas si aplica), moneda y tipo de cambio si corresponde. |
| AC-05 | Si la factura tiene un cliente identificado, el encabezado incluye sus datos: documento de identidad o RUC, nombre o razón social, dirección, teléfono, correo electrónico y el tipo de transacción. |
| AC-06 | El comprobante incluye una tabla con el detalle de cada servicio facturado: código, descripción, unidad de medida, cantidad, precio unitario, descuento si corresponde, y el valor de venta separado según la tasa de impuesto aplicada (exento, 5% o 10%). |
| AC-07 | El comprobante incluye el subtotal, el total de la operación, el total en guaraníes, el detalle de la liquidación de impuesto por tasa, y el total de impuesto. |
| AC-08 | El comprobante incluye el número de control completo de la factura, agrupado visualmente en once bloques de cuatro caracteres para facilitar su lectura manual. |
| AC-09 | El comprobante incluye la leyenda que identifica el documento como una representación gráfica de un documento electrónico. |
| AC-10 | El comprobante incluye la dirección web de consulta pública de SIFEN correspondiente al ambiente utilizado (prueba o producción), junto con el número de control, para que el cliente pueda verificar el documento manualmente. |
| AC-11 | Ningún dato mostrado en el comprobante proviene de información que no exista en la factura ya enviada a SIFEN, con dos únicas excepciones permitidas: el logo de la peluquería (opcional) y un mensaje libre configurable que nunca se envía a SIFEN. |
| AC-12 | Si el comprobante ocupa más de una página, cada página indica su número en relación con el total de páginas (por ejemplo, '2/3'), y el subtotal y el total solo se muestran en la última página. |
| AC-13 | El comprobante incluye un código QR visible al menos en la primera página, con un tamaño mínimo de 25 milímetros de ancho. |
| AC-14 | El código QR, al ser escaneado o consultado manualmente en el sitio de SIFEN, permite validar que el documento es auténtico y que sus datos coinciden con los registrados en SIFEN. |
| AC-15 | Un comprobante generado en el ambiente de prueba incluye la leyenda que indica que no tiene valor comercial ni fiscal, y su código QR apunta al sitio de consulta del ambiente de prueba. Un comprobante de producción apunta al sitio de consulta de producción. |
| AC-16 | El comprobante está disponible para descargar desde la pantalla de detalle de la factura. |
| AC-17 | El comprobante puede enviarse por correo electrónico al cliente directamente desde el sistema. |

**Recursos y referencias**
- Portal de documentación técnica de la DNIT (Manual Técnico, capítulo 13 — KuDE): https://www.dnit.gov.py/web/e-kuatia/documentacion-tecnica
- Sitio de consulta pública SIFEN — ambiente de producción: https://ekuatia.set.gov.py/consultas/
- Sitio de consulta pública SIFEN — ambiente de prueba: https://ekuatia.set.gov.py/consultas-test/
- Prevalidador de documentos electrónicos SIFEN: https://ekuatia.set.gov.py/prevalidador/
- Estándar internacional del código QR (ISO/IEC 18004): https://www.iso.org/standard/83389.html

---

### HU-09 — Revalidar en SIFEN una factura desde el sistema

**Épica:** EP-03 | **Historia:** HU-09

**Descripción**
Como usuario del sistema, quiero poder revalidar en tiempo real, en un solo clic, si SIFEN todavía reconoce como vigente una factura ya registrada, de modo que pueda confirmar ante el cliente o ante un control tributario que el documento sigue siendo válido, sin depender únicamente de lo que muestra el propio sistema. Esta revalidación reconstruye la misma dirección de verificación que está codificada en el código QR del comprobante (los datos ya se conocen porque el sistema los usó al generar el comprobante en HU-08) y abre esa dirección en una nueva pestaña del navegador, delegando en la propia página de SIFEN la confirmación del resultado. No incluye la lectura de una imagen de QR ni la validación de comprobantes ajenos al sistema.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | Desde la pantalla de detalle de una factura aprobada, existe un botón para revalidarla en SIFEN. |
| AC-02 | Al presionar el botón, el sistema abre una nueva pestaña del navegador con la dirección de verificación de SIFEN correspondiente a esa factura, sin necesidad de escanear ni leer ninguna imagen. |
| AC-03 | La dirección abierta corresponde al ambiente en el que se generó la factura: si se generó en el ambiente de prueba, abre el sitio de verificación de prueba; si se generó en producción, abre el de producción. |
| AC-04 | El resultado de la verificación lo muestra la propia página de SIFEN en la nueva pestaña; el sistema no necesita interpretar ni reprocesar esa respuesta. |
| AC-05 | La opción de revalidar está disponible tanto para facturas activas como para facturas canceladas. |
| AC-06 | Esta funcionalidad no admite subir o escanear una imagen de un comprobante ajeno al sistema; solo revalida facturas que ya existen registradas. |

---

## EP-04 — Corrección de facturas ya emitidas

*Capacidad de anular una factura aprobada dentro del plazo permitido, o de identificar al cliente en una factura que se emitió inicialmente sin sus datos.*

### HU-10 — Cancelar una factura ya aprobada

**Épica:** EP-04 | **Historia:** HU-10

**Descripción**
Como usuario del sistema, quiero poder cancelar una factura aprobada dentro del plazo permitido, de modo que quede anulada ante SIFEN y no tenga efecto tributario.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La opción de cancelar una factura solo está disponible para facturas en estado 'Aprobado' o 'Aprobado con observación'. |
| AC-02 | El sistema muestra cuánto tiempo queda disponible para cancelar la factura (48 horas desde su aprobación). Pasado ese plazo, la opción queda deshabilitada con una explicación visible. |
| AC-03 | Dado que SIFEN aprueba la cancelación, el sistema actualiza el estado de la factura a 'Cancelada'. |
| AC-04 | Dado que SIFEN rechaza la cancelación (por ejemplo, porque venció el plazo), el sistema muestra el motivo del rechazo y mantiene el estado anterior de la factura. |
| AC-05 | El sistema deja un registro histórico de la cancelación: fecha, hora, usuario que la realizó y resultado de SIFEN. |

---

### HU-11 — Identificar al cliente en una factura emitida sin sus datos

**Épica:** EP-04 | **Historia:** HU-11

**Descripción**
Como usuario del sistema, quiero poder identificar al cliente en una factura que se emitió inicialmente a consumidor final sin datos, de modo que quede correctamente asociada a ese cliente ante SIFEN sin necesidad de cancelarla y volver a emitirla.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La opción de identificar al cliente solo aparece en facturas aprobadas que se emitieron sin datos del cliente y que no fueron identificadas previamente. |
| AC-02 | El formulario solicita, como mínimo, si el cliente es una empresa o una persona, su documento de identificación o RUC, y su nombre o razón social. |
| AC-03 | Si el cliente es una empresa, el sistema exige su RUC y valida que tenga un formato correcto antes de continuar. |
| AC-04 | Si el cliente es del exterior, el sistema exige también su dirección. |
| AC-05 | Dado que SIFEN aprueba la identificación del cliente, el sistema registra en el historial de la factura los datos del cliente identificado. |
| AC-06 | Dado que SIFEN rechaza la identificación (por ejemplo, datos inconsistentes), el sistema muestra el motivo del rechazo. |

---

## EP-05 — Homologación ante la DNIT

*Pruebas automatizadas que demuestran ante la DNIT que el sistema cumple con todos los escenarios mínimos exigidos para habilitarse en producción, incluyendo aquellos que la peluquería no usará en su operación diaria.*

### HU-12 — Probar la conexión segura contra todos los servicios de SIFEN

**Épica:** EP-05 | **Historia:** HU-12

**Descripción**
Como equipo de desarrollo, quiero una prueba automatizada que verifique la conexión segura contra cada uno de los servicios de SIFEN en el ambiente de prueba, tanto con un certificado válido como con uno inválido, de modo que quede acreditado este requisito de homologación aunque en la operación diaria solo se use uno de esos servicios.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La prueba se conecta con certificado válido a cada uno de los servicios exigidos por la DNIT para la homologación (envío inmediato, envío por lotes, consulta de facturas, consulta de resultado de lotes, consulta de documentos, registro de eventos y consulta de contribuyentes). |
| AC-02 | Para cada servicio, la prueba confirma que la conexión con certificado válido es aceptada. |
| AC-03 | La prueba repite la conexión a los mismos servicios con un certificado inválido y confirma que todas son rechazadas. |
| AC-04 | La prueba genera un reporte que indica, por cada servicio, el resultado esperado y el resultado obtenido. |

---

### HU-13 — Probar el envío inmediato de facturas correctas e incorrectas

**Épica:** EP-05 | **Historia:** HU-13

**Descripción**
Como equipo de desarrollo, quiero una prueba automatizada que envíe facturas con datos correctos y facturas con datos incorrectos por la vía de envío inmediato, y verifique que las primeras son aprobadas y las segundas rechazadas, de modo que quede acreditada la cantidad mínima de pruebas exigida por la DNIT.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La prueba genera y envía 5 facturas con datos correctos (con al menos dos servicios cada una) y confirma que las 5 son aprobadas por SIFEN. |
| AC-02 | La prueba genera y envía 5 facturas con datos incorrectos, cada una con un error distinto, y confirma que las 5 son rechazadas por SIFEN con un motivo identificable. |
| AC-03 | Cada factura de prueba tiene un número de control distinto, sin repetir números ya usados en ejecuciones anteriores. |
| AC-04 | El reporte final indica, por cada factura enviada, si era correcta o incorrecta, el resultado esperado y el resultado obtenido de SIFEN. |
| AC-05 | La prueba falla de forma explícita si alguna factura correcta es rechazada o alguna incorrecta es aprobada. |

---

### HU-14 — Probar el envío inmediato de los demás tipos de comprobante exigidos

**Épica:** EP-05 | **Historia:** HU-14

**Descripción**
Como equipo de desarrollo, quiero una prueba automatizada que envíe, por la vía de envío inmediato, 5 comprobantes correctos y 5 incorrectos de cada uno de los demás tipos de documento que exige la homologación (nota de crédito, nota de débito, autofactura y nota de remisión), aunque la peluquería no los use en su operación diaria, de modo que quede acreditada esta exigencia de la DNIT.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La prueba cubre los cuatro tipos de documento adicionales exigidos: nota de crédito, nota de débito, autofactura y nota de remisión. |
| AC-02 | Para cada tipo, 5 documentos con datos correctos son aprobados por SIFEN y 5 con errores distintos son rechazados. |
| AC-03 | Cada nota de crédito y nota de débito de prueba hace referencia a una factura previamente aprobada. |
| AC-04 | El reporte final consolida el resultado por tipo de documento, indicando cuántos fueron aprobados y cuántos rechazados según lo esperado. |

---

### HU-15 — Probar el envío por lotes de todos los tipos de comprobante

**Épica:** EP-05 | **Historia:** HU-15

**Descripción**
Como equipo de desarrollo, quiero una prueba automatizada que agrupe y envíe por lotes los cinco tipos de documento exigidos, verificando que cada lote es recibido y que su resultado final puede consultarse correctamente, de modo que quede acreditada esta vía de envío exigida por la DNIT aunque la peluquería no la use en producción.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La prueba envía un lote de 5 facturas correctas, confirma que SIFEN lo recibe para procesamiento, espera el tiempo mínimo recomendado antes de consultar, y luego confirma que las 5 quedaron aprobadas. |
| AC-02 | La prueba repite el mismo flujo para cada uno de los otros cuatro tipos de documento. |
| AC-03 | La prueba envía un lote de 5 facturas incorrectas (con errores distintos) y confirma que las 5 quedan rechazadas al consultar el resultado. |
| AC-04 | La prueba confirma que un lote que mezcla documentos de distintos clientes emisores es rechazado antes de ser procesado. |
| AC-05 | La prueba confirma que un lote que mezcla distintos tipos de documento es rechazado antes de ser procesado. |

---

### HU-16 — Probar el registro de todos los eventos exigidos

**Épica:** EP-05 | **Historia:** HU-16

**Descripción**
Como equipo de desarrollo, quiero una prueba automatizada que registre todos los tipos de eventos exigidos por la homologación (cancelaciones, anulación de numeración no usada, y los eventos que puede registrar un cliente sobre una factura recibida), aunque la peluquería en su operación diaria solo use la cancelación y la identificación de cliente, de modo que quede acreditada esta exigencia completa de la DNIT.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La prueba cancela exitosamente 5 documentos previamente aprobados de cualquier tipo. |
| AC-02 | La prueba registra la anulación de numeración no utilizada para cada uno de los tipos de documento exigidos. |
| AC-03 | La prueba registra, actuando como si fuera el cliente que recibe la factura, los distintos eventos que un receptor puede dejar sobre una factura (confirmarla, cuestionarla, desconocerla, notificar que la recibió, y corregir un evento anterior), con la cantidad mínima exigida de cada uno. |
| AC-04 | Para cada evento registrado, la prueba confirma que SIFEN lo aprueba y guarda el resultado en el reporte. |
| AC-05 | La prueba confirma que un segundo intento de cancelar un documento ya cancelado es rechazado por SIFEN. |

---

### HU-17 — Probar la consulta de documentos y la generación de comprobantes de todos los tipos

**Épica:** EP-05 | **Historia:** HU-17

**Descripción**
Como equipo de desarrollo, quiero una prueba automatizada que consulte documentos aprobados por su número de control y por su código QR, y que genere el comprobante en PDF de al menos un documento de cada tipo, de modo que quede acreditada esta última exigencia de homologación y se consolide el resultado de toda la batería de pruebas.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La prueba consulta, por número de control, al menos 3 documentos aprobados de cada uno de los cinco tipos exigidos, y confirma que la consulta devuelve el contenido completo del documento. |
| AC-02 | La prueba valida el código QR de al menos 2 documentos de cada tipo y confirma que SIFEN reconoce el documento como válido. |
| AC-03 | La prueba genera el comprobante en PDF de al menos un documento aprobado de cada tipo y confirma que el archivo se genera correctamente y contiene el número de control correspondiente. |
| AC-04 | La prueba confirma que el código QR incluido en cada comprobante generado corresponde al ambiente de prueba. |
| AC-05 | El resultado de esta prueba, junto con el de las pruebas anteriores de esta épica, se consolida en un único reporte final que indica el estado de cada escenario exigido por la DNIT. |

---

## EP-06 — Gestión de activos criptográficos

*Capacidad de cargar, almacenar de forma segura y aislada por tenant, y utilizar el certificado digital y la clave privada que cada peluquería necesita para firmar documentos y conectarse con SIFEN.*

### HU-18 — Cargar un nuevo certificado y clave para un tenant

**Épica:** EP-06 | **Historia:** HU-18

**Descripción**
Como usuario administrador de un tenant, quiero cargar el archivo que contiene el certificado digital y la clave privada de mi negocio, ingresando la contraseña que lo protege, de modo que el sistema extraiga y guarde de forma segura la información necesaria para firmar documentos y conectarme con SIFEN, sin que ningún otro tenant pueda acceder a ella.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | La opción "Cargar nuevo certificado y clave" está disponible dentro de Configuración → SIFEN. |
| AC-02 | El formulario de carga solicita el archivo (.p12) y la contraseña que lo protege. |
| AC-03 | Dada una contraseña incorrecta para el archivo cargado, el sistema informa el error específico y no guarda ningún dato del archivo. |
| AC-04 | Dado un archivo que no corresponde al formato esperado o está corrupto, el sistema informa el error y no guarda ningún dato. |
| AC-05 | Dado un archivo y una contraseña correctos, el sistema extrae el certificado y la clave privada y los almacena asociados exclusivamente al tenant que realizó la carga. |
| AC-06 | Una vez cargados, ni la clave privada ni la contraseña del archivo quedan disponibles para visualizar o descargar desde la interfaz, ni siquiera por el propio tenant que los cargó. |
| AC-07 | Un tenant no puede, bajo ninguna circunstancia, cargar, ver, ni acceder a los certificados o claves de otro tenant. |
| AC-08 | Al completar la carga exitosamente, el nuevo certificado aparece de inmediato en el listado de certificados del tenant (HU-19), con su fecha de carga, fecha de expedición y fecha de vencimiento correctamente extraídas del archivo. |
| AC-09 | El sistema registra qué usuario realizó la carga y en qué fecha y hora, a efectos de trazabilidad. |
| AC-10 | Cargar un nuevo certificado no elimina ni afecta a los certificados cargados anteriormente por el mismo tenant; todos permanecen en el listado (HU-19). |

---

### HU-19 — Ver el listado de certificados cargados de un tenant

**Épica:** EP-06 | **Historia:** HU-19

**Descripción**
Como usuario administrador de un tenant, quiero ver el listado de todos los certificados que cargué anteriormente para mi negocio, con su fecha de carga, fecha de expedición, fecha de vencimiento y estado actual, de modo que pueda saber en todo momento qué certificados tengo disponibles y cuál está vigente.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | El listado se muestra dentro de Configuración → SIFEN, en la misma sección donde se cargan nuevos certificados. |
| AC-02 | Por cada certificado cargado, el listado muestra únicamente estos cuatro datos: fecha de carga, fecha de expedición, fecha de vencimiento y estado. |
| AC-03 | El listado no muestra en ningún momento la clave privada, la contraseña del archivo, ni ningún otro dato del certificado más allá de los cuatro campos indicados. |
| AC-04 | El listado solo muestra los certificados cargados por el tenant que está consultando; nunca aparecen certificados de otro tenant. |
| AC-05 | Si el tenant todavía no cargó ningún certificado, el listado se muestra vacío junto con una indicación de que no hay certificados cargados y un acceso directo a la opción de carga. |
| AC-06 | El listado incluye todos los certificados cargados históricamente por el tenant, no solo el más reciente. |

---

### HU-20 — Calcular el estado de cada certificado según su vigencia

**Épica:** EP-06 | **Historia:** HU-20

**Descripción**
Como sistema, quiero calcular automáticamente el estado de cada certificado cargado (vigente, expirado, o no vigente aún) comparando la fecha actual con su fecha de expedición y su fecha de vencimiento, de modo que el usuario siempre vea información actualizada en el listado sin tener que verificarla manualmente.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | Dado un certificado cuya fecha actual está entre su fecha de expedición y su fecha de vencimiento (ambas inclusive), el estado mostrado es "Vigente". |
| AC-02 | Dado un certificado cuya fecha de vencimiento ya pasó respecto a la fecha actual, el estado mostrado es "Expirado". |
| AC-03 | Dado un certificado cuya fecha de expedición todavía no llegó respecto a la fecha actual, el estado mostrado es "No vigente aún". |
| AC-04 | El estado se calcula en el momento de mostrar el listado, tomando la fecha actual real, y no un valor guardado en el momento de la carga. |
| AC-05 | Un tenant puede tener más de un certificado con estado "Vigente" al mismo tiempo sin que el sistema lo impida ni marque error; cuál de ellos se utiliza para operar se resuelve según lo definido en HU-21. |
| AC-06 | Un certificado que estaba "No vigente aún" pasa a mostrarse como "Vigente" automáticamente al llegar su fecha de expedición, sin ninguna acción manual. |
| AC-07 | Un certificado que estaba "Vigente" pasa a mostrarse como "Expirado" automáticamente al superar su fecha de vencimiento, sin ninguna acción manual. |

---

### HU-21 — Usar automáticamente el certificado vigente del tenant en las funcionalidades de facturación

**Épica:** EP-06 | **Historia:** HU-21

**Descripción**
Como sistema, quiero que toda funcionalidad de facturación electrónica que necesite el certificado digital o la clave privada (firmar un documento, conectarse con SIFEN, registrar un evento) obtenga automáticamente el certificado vigente del tenant correspondiente desde el mismo almacenamiento central, de modo que cada tenant use siempre su propio certificado sin que el usuario deba seleccionarlo manualmente en cada operación.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | Toda operación que requiere firmar un documento o conectarse con SIFEN (HU-04, HU-05, HU-10, HU-11 y las pruebas de homologación de EP-05) obtiene el certificado y la clave privada del tenant actual desde el mismo almacenamiento central, sin que el usuario deba indicarlo manualmente en cada factura o evento. |
| AC-02 | Dado un tenant que no tiene ningún certificado en estado "Vigente", el sistema impide ejecutar cualquier operación que dependa del certificado (firmar, conectar, registrar eventos) y muestra un mensaje indicando que debe cargar un certificado vigente en Configuración → SIFEN. |
| AC-03 | Dado un tenant con más de un certificado en estado "Vigente", el sistema selecciona siempre el mismo (por ejemplo, el de vencimiento más lejano) de forma consistente entre operaciones, sin requerir que el usuario elija manualmente en cada factura. |
| AC-04 | Ninguna operación de un tenant puede utilizar, bajo ninguna circunstancia, el certificado o la clave privada de otro tenant, incluso si ambas operaciones ocurren en el mismo instante. |
| AC-05 | Si el certificado que el sistema venía utilizando para un tenant cambia de estado a "Expirado" entre una operación y la siguiente, la siguiente operación ya no lo utiliza y se comporta según lo definido en AC-02. |
| AC-06 | Cargar un nuevo certificado vigente para un tenant (HU-18) hace que las siguientes operaciones de ese tenant lo utilicen, sin necesidad de reiniciar el sistema ni realizar ninguna configuración adicional. |

---

## EP-07 — Activación de la facturación electrónica por tenant

*Capacidad de activar o desactivar, de forma independiente para cada tenant, la integración con SIFEN. Mientras está desactivada, el tenant sigue facturando con normalidad a través del generador de facturas tradicional existente.*

### HU-22 — Activar o desactivar la facturación electrónica para un tenant

**Épica:** EP-07 | **Historia:** HU-22

**Descripción**
Como administrador del sistema, quiero poder activar o desactivar la integración con SIFEN para un tenant específico, de modo que pueda habilitar la facturación electrónica únicamente para los tenants que están listos para usarla; mientras un tenant no la tenga activada, sus facturas se siguen generando con el generador tradicional existente, sin ninguna interrupción de su operación diaria.

**Criterios de aceptación**

| ID | Criterio de aceptación (testeable) |
|---|---|
| AC-01 | Existe una opción para activar o desactivar la facturación electrónica de un tenant específico. |
| AC-02 | El estado del flag (activado/desactivado) es independiente para cada tenant; cambiarlo para uno no modifica el de ningún otro. |
| AC-03 | Al desactivar el flag de un tenant, las facturas nuevas de ese tenant pasan a generarse de inmediato con el generador de facturas tradicional, sin ejecutar ninguna etapa de la integración con SIFEN. |
| AC-04 | Al activar el flag de un tenant, las facturas nuevas de ese tenant pasan a generarse de inmediato mediante el flujo de SIFEN, siempre que además tenga un certificado vigente cargado (HU-18 a HU-21); si no tiene un certificado vigente, el sistema informa esta condición antes de permitir emitir. |
| AC-05 | El sistema deja un registro histórico de cada cambio de estado del flag: fecha, hora, usuario que lo realizó, y valor anterior y nuevo. |
| AC-06 | Desactivar el flag de un tenant no cancela, oculta, ni modifica las facturas que ese tenant ya tiene registradas o enviadas a SIFEN. |
| AC-07 | Una factura emitida con el generador tradicional mientras el flag estaba desactivado nunca se convierte retroactivamente en un documento SIFEN al activar el flag más adelante. |
| AC-08 | El resto de las funcionalidades del sistema, ajenas a la facturación electrónica, continúan funcionando con normalidad para el tenant independientemente del estado de este flag. |

---

## Plan de implementación por fases

Este plan organiza las 22 historias de usuario en fases ejecutables, priorizando llegar lo antes posible a una primera interacción real con el Web Service de SIFEN, y agregando luego capacidades cada vez más complejas en incrementos verticales. La última fase incorpora las capacidades que se postergaron deliberadamente en las fases iniciales para no demorar los primeros hitos.

### Resumen de fases

| Fase | Objetivo | Historias incluidas |
|---|---|---|
| **Fase 1** | Primera interacción real con el Web Service de SIFEN | HU-18, HU-20, HU-21, HU-05, HU-01, HU-02, HU-03, HU-04, HU-06 |
| **Fase 2** | Cerrar el ciclo de vida de la factura ya enviada | HU-07, HU-08, HU-09, HU-19 |
| **Fase 3** | Primeras interacciones complejas adicionales: eventos sobre DTE aprobados | HU-10, HU-11 |
| **Fase 4** | Homologación ante la DNIT | HU-12, HU-13, HU-14, HU-15, HU-16, HU-17 |
| **Fase 5** | Incorporación de lo postergado: activación real por tenant y convivencia con el mecanismo tradicional | HU-22 |

---

### Fase 1 — Primera interacción real con el Web Service de SIFEN

**Objetivo:** lograr, lo antes posible, que el sistema envíe exitosamente una factura al ambiente de prueba de SIFEN y reciba una respuesta. Se trabaja con un tenant piloto que ya tiene su certificado cargado manualmente; la activación real por tenant y la convivencia con el generador tradicional se postergan a la Fase 5 para no demorar este primer hito.

**Orden de ejecución:**

1. **HU-18** — Cargar un nuevo certificado y clave para un tenant. *(Primer paso obligatorio: sin certificado no hay nada más que construir.)*
2. **HU-20** — Calcular el estado de cada certificado según su vigencia. *(Depende de HU-18; se necesita saber si el certificado cargado está vigente.)*
3. **HU-21** — Usar automáticamente el certificado vigente del tenant en las funcionalidades de facturación. *(Depende de HU-20.)*

   A partir de aquí, dos frentes pueden avanzar en paralelo, ya que ninguno depende del otro:

   - **Frente A:**
     4. **HU-05** — Conectarse de forma segura con SIFEN. *(Solo depende de HU-21, para obtener el certificado.)*
   - **Frente B:**
     4. **HU-01** — Generar el número de control de una factura.
     5. **HU-02** — Completar los datos de identificación, timbrado, emisor y receptor. *(Depende de HU-01.)*
     6. **HU-03** — Completar los servicios facturados y calcular los totales. *(Depende de HU-02.)*

   Ambos frentes convergen en:

   7. **HU-04** — Firmar digitalmente el documento. *(Depende de HU-03, para tener el documento completo, y de HU-21, para el certificado.)*
   8. **HU-06** — Enviar una factura a SIFEN y registrar el resultado. *(Depende de HU-04 y de HU-05.)*

Al completar HU-06, el sistema ya envió y registró el resultado de al menos una factura real contra SIFEN — el hito buscado en esta fase.

---

### Fase 2 — Cerrar el ciclo de vida de la factura ya enviada

**Objetivo:** completar lo que ocurre después de que SIFEN aprueba una factura: poder confirmar su estado si quedó pendiente, entregarle un comprobante al cliente, y revalidarlo cuando haga falta. También se agrega la visibilidad operativa sobre los certificados cargados.

**Orden de ejecución:**

1. **HU-07** — Verificar en SIFEN el estado de una factura pendiente. *(Depende de HU-06, de la Fase 1, que es la que puede dejar una factura en estado pendiente.)*
2. **HU-08** — Generar el comprobante en PDF de una factura aprobada. *(Depende de HU-06; requiere una factura ya aprobada.)*
3. **HU-09** — Revalidar en SIFEN una factura desde el sistema. *(Depende de HU-08, ya que reconstruye la misma dirección de verificación que se usó para generar el comprobante.)*
4. **HU-19** — Ver el listado de certificados cargados de un tenant. *(Solo depende de HU-18 y HU-20, de la Fase 1; puede construirse en paralelo con HU-07, HU-08 y HU-09.)*

---

### Fase 3 — Primeras interacciones complejas adicionales: eventos sobre DTE aprobados

**Objetivo:** incorporar el primer tipo de interacción distinta al envío de documentos — el registro de eventos — probando rápidamente dos casos de uso reales y de valor inmediato para el negocio.

**Orden de ejecución:**

1. **HU-10** — Cancelar una factura ya aprobada. *(Depende de HU-06, de la Fase 1, para tener una factura aprobada sobre la cual actuar.)*
2. **HU-11** — Identificar al cliente en una factura emitida sin sus datos. *(Depende de HU-06; puede desarrollarse en paralelo con HU-10, ya que ambas son eventos independientes entre sí.)*

---

### Fase 4 — Homologación ante la DNIT

**Objetivo:** cubrir la batería completa de pruebas que exige la DNIT para habilitar el sistema en producción, incluyendo los escenarios que la peluquería no usa en su operación diaria (otros tipos de documento, envío por lotes, y el resto de los eventos).

**Orden de ejecución:**

1. **HU-12** — Probar la conexión segura contra todos los servicios de SIFEN. *(Primero, porque valida la base de conectividad que todas las demás pruebas de esta fase necesitan.)*
2. **HU-13** — Probar el envío inmediato de facturas correctas e incorrectas. *(Depende de HU-12; reutiliza directamente lo construido en la Fase 1.)*

   A partir de aquí, tres frentes pueden avanzar en paralelo, ya que cada uno prueba una capacidad distinta:

   - **Frente A:**
     3. **HU-14** — Probar el envío inmediato de los demás tipos de comprobante exigidos. *(Depende de HU-12; introduce la generación de nota de crédito, nota de débito, autofactura y nota de remisión.)*
   - **Frente B:**
     3. **HU-15** — Probar el envío por lotes de todos los tipos de comprobante. *(Depende de HU-12; introduce la integración con el Web Service asíncrono, no utilizado hasta esta fase.)*
   - **Frente C:**
     3. **HU-16** — Probar el registro de todos los eventos exigidos. *(Depende de HU-10 y HU-11, de la Fase 3, ya que reutiliza y amplía ese mismo mecanismo de eventos a más tipos.)*

   Los tres frentes convergen en:

   4. **HU-17** — Probar la consulta de documentos y la generación de comprobantes de todos los tipos. *(Depende de HU-14, HU-15 y HU-16, ya que necesita documentos aprobados de cada tipo para poder consultarlos y generar sus comprobantes.)*

---

### Fase 5 — Incorporación de lo postergado: activación real por tenant

**Objetivo:** conectar, ahora que todo el flujo de SIFEN ya está construido y homologado, el mecanismo real que decide, por tenant, si una factura se emite mediante SIFEN o mediante el generador tradicional. Esta capacidad se postergó deliberadamente desde la Fase 1 para no demorar la primera interacción con SIFEN, ya que hasta este punto todas las fases anteriores trabajaron asumiendo un tenant piloto con SIFEN siempre activo.

**Orden de ejecución:**

1. **HU-22** — Activar o desactivar la facturación electrónica para un tenant. *(Depende de todas las fases anteriores, ya que su criterio de aceptación de enrutamiento — AC-03 y AC-04 — exige que tanto el flujo de SIFEN como el generador tradicional ya existan y funcionen correctamente antes de conectar el interruptor real entre ambos.)*

Al completar esta fase, el sistema queda listo para habilitar la facturación electrónica de forma controlada, tenant por tenant, en producción.

---

## Configuración del ambiente de pruebas (datos provistos por la SET)

Estos son los parámetros oficiales que la SET/DNIT entregó para operar en el ambiente de prueba de SIFEN. El sistema debe usar estos valores exactos al generar los documentos de prueba de la Fase 1 y de la Fase 4 (homologación) de este plan.

### Código de Seguridad del Contribuyente (CSC)

El CSC es el código secreto que se usa para calcular el hash del código QR de cada comprobante (ver HU-08). En producción, la DNIT entrega un CSC propio y distinto para cada contribuyente; estos dos son exclusivamente para el ambiente de prueba.

| Id CSC | CSC |
|---|---|
| 1 | ABCD0000000000000000000000000000 |
| 2 | EFGH0000000000000000000000000000 |

### Datos del emisor para las pruebas de transmisión de Documentos Electrónicos

Estos valores alimentan directamente los datos de timbrado que completa HU-02 durante las pruebas de las Fases 1 y 4.

| Parámetro | Valor |
|---|---|
| Timbrado | 1137152 |
| Fecha de inicio de vigencia | 27/07/2026 |
| Establecimiento | 001 |
| Puntos de expedición | 001, 002, 003 |

### Tipos de documento habilitados para pruebas

Con este timbrado, la SET habilitó los cinco tipos de documento que exige la homologación (ver EP-05):

- Factura Electrónica
- Nota de Crédito Electrónica
- Nota de Débito Electrónica
- Autofactura Electrónica
- Nota de Remisión Electrónica
