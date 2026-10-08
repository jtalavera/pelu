# SIFEN · Certificado y Código de Seguridad del Contribuyente (CSC) por salón — carga solo por usuario root

| Campo      | Valor                                   |
| ---------- | --------------------------------------- |
| **ID**     | Cambio sin HU (pedido directo)          |
| **Módulo** | Plataforma → Salones → SIFEN (root); Configuración → SIFEN (salón, solo lectura) |
| **Estado** | `Implementado`                          |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

## Contexto

La DNIT entrega a **cada contribuyente** su propio CSC y lo usa para validar el hash del código QR de cada comprobante (Manual Técnico V150 §13.8.1). Hasta ahora el sistema tenía un único CSC global (los dos de prueba de la SET) en `SifenQrProperties`, sin forma de cargar uno real por salón. Como el sistema se vende a varios salones, cada uno debe tener el suyo **sin tocar código ni hacer deploy**.

Tanto el **certificado digital** como el **CSC** son material criptográfico que respalda la validez fiscal de los comprobantes; por eso **solo el usuario root (plataforma, `PLATFORM_ADMIN`) puede cargarlos** para un salón. El administrador del salón solo puede **verlos** (estado, vigencia, qué IdCSC está activo), nunca cargarlos ni activarlos.

## Historia de usuario

**Como** usuario root de la plataforma,  
**quiero** cargar el certificado y el IdCSC + CSC que la DNIT entregó a cada salón, desde la ficha del salón,  
**para** que los comprobantes y los códigos QR de ese salón se firmen con su propio material fiscal.

**Como** administrador de un salón,  
**quiero** ver en Configuración → SIFEN qué certificado y qué CSC están cargados,  
**para** saber si mi facturación electrónica está lista, sin poder alterarla.

## Criterios de aceptación

Cubiertos por `e2e/tests/sifen-csc-por-tenant.spec.ts` salvo donde se indica otro spec.

1. **Pantalla root.** En Plataforma → Salones → (salón) → «Configurar SIFEN» (`/platform/tenants/:tenantId/sifen`) el root ve el ambiente del salón, el formulario de certificado (.p12 + contraseña) y las solapas de certificados y **Código de seguridad (CSC)** con su formulario (IdCSC + CSC) y la lista.
2. **Solo root carga.** Los endpoints de carga viven solo bajo `/api/platform/tenants/{tenantId}/sifen/**` y exigen `PLATFORM_ADMIN` (401 sin sesión, 403 para administrador de salón o profesional). Los endpoints del salón (`/api/sifen/certificates`, `/api/sifen/csc`) son **solo GET**: cualquier POST responde 403/405.
3. **Salón en solo lectura.** Configuración → SIFEN muestra certificados y CSC sin formularios ni botón «Usar este código», con una nota para contactar a soporte.
4. **Validación.** El IdCSC es un entero 1–9999; el CSC son exactamente 32 letras o dígitos. Los mensajes (front y `INVALID_CSC_ID` / `INVALID_CSC_FORMAT` en la API) dicen la regla y dan un ejemplo.
5. **El CSC es un secreto de solo escritura.** Se guarda en el almacén de secretos (Azure Key Vault, un secreto por CSC con nombre `sifen-csc-t<tenantId>-<uuid>`; archivos locales en e2e) — nunca en la base de datos, nunca en la respuesta de la API, nunca en logs. El campo es `type=password` y se limpia tras guardar; luego solo se puede reemplazar.
6. **Uno activo.** El primer CSC de un salón queda activo; los siguientes quedan inactivos hasta «Usar este código» (la DNIT permite dos activos a la vez para rotar). Solo uno firma los QR.
7. **Reemplazo.** Cargar un IdCSC ya existente reemplaza su valor (no duplica filas).
8. **Aislamiento por salón.** Cada salón ve y usa solo los suyos; el root opera sobre el salón de la URL; el mismo IdCSC puede existir en dos salones con valores distintos (`mt-isolation/mt-sifen.spec.ts`, escenarios 2 y 7; el almacén rechaza referencias de otro tenant).
9. **Firma.** El QR se arma con el IdCSC y el CSC activos **del salón del comprobante** (`SifenDocumentSigningServiceTest`, `SifenQrCodeServiceTest`).
10. **Sin CSC.** En ambiente TEST se usa el CSC público de prueba de la SET (la solapa lo avisa); en **PRODUCCIÓN no se firma**: `SIFEN_CSC_NOT_CONFIGURED` (412) y la solapa muestra una alerta — nunca se sustituye por un CSC de prueba.
11. **Sin deploy.** Cargar o cambiar un CSC o certificado es configuración del salón: el mismo backend en ejecución lo usa en la siguiente petición.

## Qué hacer cuando la DNIT entrega el material de un salón

1. Entrar como usuario root → Plataforma → Salones → buscar el salón → abrir su detalle → **Configurar SIFEN**.
2. Certificado: seleccionar el .p12, ingresar la contraseña → Cargar.
3. CSC: solapa **Código de seguridad (CSC)** → cargar **IdCSC** y **CSC** → Guardar (el primero queda activo). Si ya había uno y se rota: cargar el nuevo y pulsar «Usar este código».
4. Pasar el ambiente a producción (`FEMME_SIFEN_ENVIRONMENT=PRODUCTION`) es un paso aparte y sí es configuración de la infraestructura.

> Las facturas ya emitidas conservan el QR con el CSC con que se firmaron; el cambio solo afecta a las nuevas.
