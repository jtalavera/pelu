# HU-71 · Comprobante no fiscal (A4 y ticket) para negocios sin SIFEN

| Campo      | Valor        |
| ---------- | ------------ |
| **ID**     | HU-71        |
| **Módulo** | Facturación  |
| **Estado** | `In Progress` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador de un negocio del tier Estándar que no factura con SIFEN,
**quiero** descargar un comprobante propio del negocio, parecido al KuDE pero sin valor fiscal, con mi logo,
**para** entregarle a la clienta un comprobante prolijo en lugar del formulario continuo preimpreso.

---

## Contexto

Mientras la facturación electrónica SIFEN no está activa, el comprobante que se genera es el PDF para formulario continuo preimpreso (solo datos variables, sin encabezado ni logo). Esta historia lo **reemplaza** por un documento **no fiscal**. Con SIFEN activo no cambia nada: sigue el KuDE (HU-33).

Decisiones tomadas: dos formatos a elegir al descargar (hoja A4 y ticket de 80 mm), el comprobante preimpreso se elimina, el IVA va discriminado y la numeración sigue saliendo del timbrado.

---

## Criterios de aceptación

- **AC-1 · Descargar y elegir el formato.** Sin SIFEN, la pantalla del comprobante recién emitido y el detalle del comprobante ofrecen «Descargar comprobante». Al tocarlo aparecen **Hoja A4** y **Ticket 80 mm**; elegir uno lo descarga y vuelve a plegar las opciones. El detalle muestra la etiqueta «Sin valor fiscal».
- **AC-2 · Hoja A4.** Encabezado con el **logo del negocio**, nombre, RUC, dirección, teléfono y correo; recuadro «COMPROBANTE / NO FISCAL» con el número; franja «DOCUMENTO SIN VALOR FISCAL · NO ES UNA FACTURA» y marca de agua «SIN VALOR FISCAL»; fecha, condición (Contado), cliente, RUC / C.I. y quien atendió; detalle con cantidad, descripción, precio unitario y columnas **Exentas / IVA 5 % / IVA 10 %**; descuentos; subtotal, total y total en letras; **liquidación del IVA** (5 %, 10 % y total); formas de pago (con la marca de la tarjeta) y la propina aparte; mensaje de pie del negocio y aviso de que no reemplaza a la factura legal.
- **AC-3 · Ticket de 80 mm.** El mismo contenido en una columna de 80 mm, con el logo arriba; el alto de la hoja se ajusta al contenido.
- **AC-4 · Sin datos fiscales.** No lleva timbrado, vigencia, CDC, código QR ni las leyendas de copia de la factura preimpresa.
- **AC-5 · Numeración.** El número es el de siempre, que sale de la secuencia del timbrado, con el formato `001-001-0000123`. El archivo se llama `COMPROBANTE-NO-FISCAL-<aaaammdd>-<número>.pdf` (y termina en `-TICKET` para el ticket).
- **AC-6 · Logo.** Si el negocio cargó un logo, aparece en el A4 y en el ticket. Sin logo, el nombre del negocio ocupa el encabezado. Un logo inválido nunca impide descargar el comprobante.
- **AC-7 · Función del tier.** La función `NON_FISCAL_RECEIPT` viene activa para todos los tiers (Estándar incluido) y un administrador de plataforma puede apagarla por tier o por tenant. Apagada, no se ofrece el botón y el PDF responde `409 NON_FISCAL_RECEIPT_NOT_ENABLED`.
- **AC-8 · Con SIFEN no cambia nada.** Con SIFEN activo se ofrece solo el KuDE y el PDF no fiscal responde `409 SIFEN_LEGACY_PDF_DISABLED`.
- **AC-9 · Sin formulario preimpreso.** Se elimina el comprobante para formulario continuo. Ya no se exige el RUC del negocio para descargar.
- **AC-10 · Solo emitidos.** Un comprobante anulado no genera comprobante (`400 INVOICE_PDF_ONLY_FOR_ISSUED`).
- **AC-11 · «Sin nombre».** Solo se imprime lo escrito en el comprobante: una clienta registrada cuyo nombre se borró sale como «Sin nombre» y su RUC o C.I. no se filtra.
- **AC-12 · Formato inválido.** `?format=` distinto de `A4` o `TICKET` responde `400 RECEIPT_FORMAT_INVALID`. Sin el parámetro, es A4.

---

## Pruebas automatizadas

- Playwright: `e2e/tests/comprobante-no-fiscal.spec.ts` (AC-1 a AC-12).
- JUnit: `NonFiscalReceiptPdfServiceTest`. Vitest: `ReceiptDownloadButton.test.tsx`.
