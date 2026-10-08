# SIFEN · Código de Seguridad del Contribuyente (CSC) por salón

| Campo      | Valor                                   |
| ---------- | --------------------------------------- |
| **ID**     | Cambio sin HU (pedido directo)          |
| **Módulo** | Configuración → SIFEN                   |
| **Estado** | `Implementado`                          |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

## Contexto

La DNIT entrega a **cada contribuyente** su propio CSC y lo usa para validar el hash del código QR de cada comprobante (Manual Técnico V150 §13.8.1). Hasta ahora el sistema tenía un único CSC global (los dos de prueba de la SET) en `SifenQrProperties`, sin forma de cargar uno real por salón. Como el sistema se vende a varios salones, cada uno debe cargar el suyo **sin tocar código ni hacer deploy**.

## Historia de usuario

**Como** administrador de un salón,  
**quiero** cargar en Configuración → SIFEN el IdCSC y el CSC que me entregó la DNIT,  
**para** que los códigos QR de mis comprobantes electrónicos se firmen con mi propio CSC.

## Criterios de aceptación

Cubiertos por `e2e/tests/sifen-csc-por-tenant.spec.ts` salvo donde se indica otro spec.

1. **Solapa.** Configuración → SIFEN tiene la solapa **Código de seguridad (CSC)** con el formulario (IdCSC + CSC) y la lista de códigos cargados.
2. **Validación.** El IdCSC es un entero 1–9999; el CSC son exactamente 32 letras o dígitos. Los mensajes (front y `INVALID_CSC_ID` / `INVALID_CSC_FORMAT` en la API) dicen la regla y dan un ejemplo.
3. **El CSC es un secreto de solo escritura.** Se guarda en el almacén de secretos (Azure Key Vault, un secreto por CSC con nombre `sifen-csc-t<tenantId>-<uuid>`; archivos locales en e2e) — nunca en la base de datos, nunca en la respuesta de la API, nunca en logs. El campo es `type=password` y se limpia tras guardar; luego solo se puede reemplazar.
4. **Uno activo.** El primer CSC de un salón queda activo; los siguientes quedan inactivos hasta «Usar este código» (la DNIT permite dos activos a la vez para rotar). Solo uno firma los QR.
5. **Reemplazo.** Cargar un IdCSC ya existente reemplaza su valor (no duplica filas).
6. **Aislamiento por salón.** Cada salón ve, activa y usa solo los suyos; el mismo IdCSC puede existir en dos salones con valores distintos (`mt-isolation/mt-sifen.spec.ts`, escenario 7; y el almacén rechaza referencias de otro tenant).
7. **Firma.** El QR se arma con el IdCSC y el CSC activos **del salón del comprobante** (`SifenDocumentSigningServiceTest`, `SifenQrCodeServiceTest`).
8. **Sin CSC.** En ambiente TEST se usa el CSC público de prueba de la SET (la solapa lo avisa); en **PRODUCCIÓN no se firma**: `SIFEN_CSC_NOT_CONFIGURED` (412) y la solapa muestra una alerta — nunca se sustituye por un CSC de prueba.
9. **Sin deploy.** Cargar o cambiar un CSC es configuración del salón: el mismo backend en ejecución lo usa en la siguiente petición.

## Qué hacer cuando la DNIT entrega el CSC de un salón

1. Entrar como administrador del salón → Configuración → SIFEN → **Código de seguridad (CSC)**.
2. Cargar el **IdCSC** y el **CSC** → Guardar (el primero queda activo). Si ya había uno y se rota: cargar el nuevo y pulsar «Usar este código».
3. Pasar el ambiente a producción (`FEMME_SIFEN_ENVIRONMENT=PRODUCTION`) es un paso aparte y sí es configuración de la infraestructura.

> Las facturas ya emitidas conservan el QR con el CSC con que se firmaron; el cambio solo afecta a las nuevas.
