# HU-AST-04 · Compartir la factura con el cliente

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **ID**     | HU-AST-04                                                                          |
| **Módulo** | Asistente conversacional · Facturación                                             |
| **Estado** | `In Progress`                                                                      |
| **Flag**   | `ASSISTANT_CHATBOT` (el compartir del comprobante no fiscal sigue a `NON_FISCAL_RECEIPT`) |
| **Plan**   | [Plan de implementación del asistente](../asistente/plan_asistente.md) · fase 2    |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** mandarle al cliente su comprobante por email o WhatsApp apenas se emite la factura,  
**para** entregárselo sin salir del chat ni buscarlo en Facturación.

---

## Contexto

Hasta ahora «Compartir» del detalle de una factura solo existía para el KuDE (SIFEN). Esta historia lo habilita también para el **comprobante no fiscal** (salones sin SIFEN): por email con un endpoint nuevo (`POST /api/invoices/{id}/pdf/email`) y por WhatsApp con el PDF del comprobante. El cambio vale en toda la app, no solo en el asistente.

---

## Criterios de aceptación

1. **Desde la tarjeta — Directo a «Compartir».** En la tarjeta de una factura emitida, «Compartir con el cliente» abre el detalle de esa factura directamente en su panel «Compartir».
2. **Desde la tarjeta — Ver factura.** «Ver factura» abre el detalle de la factura emitida.
3. **También sin asistente — Comprobante no fiscal.** En Facturación, el detalle de una factura emitida sin SIFEN muestra el botón «Compartir» (antes solo lo tenía el KuDE), con el panel de email y WhatsApp.
4. **Email — Envía el comprobante.** El panel manda el PDF del comprobante por email a la dirección escrita; si se deja en blanco usa la del comprobante o la del cliente. El campo viene precargado con el email del cliente. Se confirma con un mensaje de éxito.
5. **Email — Errores traducidos.** Sin ninguna dirección, o con una mal escrita, el panel muestra un error traducido que da un ejemplo del formato.
6. **WhatsApp — PDF y chat.** «Enviar por WhatsApp» descarga el PDF del comprobante y abre el chat de WhatsApp (con el teléfono del cliente si lo tiene) con un mensaje que menciona el número y el total.
7. **Cuándo se ofrece.** El comprobante no fiscal solo se comparte si el salón tiene el comprobante no fiscal habilitado y no usa SIFEN; con SIFEN sigue el compartir del KuDE de siempre, sin cambios.

---

## Fuera de alcance

- El menú de fila de «Comprobantes de hoy» (Facturación) sigue ofreciendo solo el KuDE.
- Cambiar el formato del PDF (A4 por defecto; el ticket de 80 mm se imprime desde el detalle).

## Notas

- Frontend: `InvoiceDetailModal` (prop `initialPanel`, panel `receipt-share-*`), `lib/invoiceKudeShare.ts`, `api/downloadInvoicePdf.ts`.
- Backend: `NonFiscalReceiptEmailService`; errores `RECEIPT_EMAIL_REQUIRED`, `RECEIPT_EMAIL_INVALID`; textos `email.receipt.*` en las tres `messages*.properties`.
- Se actualizó el spec existente que daba por hecho que sin SIFEN no había «Compartir» (`sifen-hu-07-verificar-estado.spec.ts`).
