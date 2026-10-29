# Rediseño minimalista de Facturación

Primera pantalla del rediseño web (rama `refactor/redesign-web-minimalista`). Objetivo: que la
facilidad de uso sea una propuesta de valor y que esta pantalla sirva de base para la futura
versión *lite* de smartphones y tablets.

## Principios

1. Una pantalla, una tarea principal (en Facturación: cobrar).
2. Lo común a la vista, lo raro plegado bajo "Más opciones". Nada desaparece: todo sigue disponible.
3. Valores por defecto inteligentes: cliente "Sin nombre", el monto de pago sigue al total.
4. Lenguaje de salón, no fiscal: un solo estado por factura.
5. Mobile-first, una columna, total y acción principal siempre a mano.

## Pantallas (`src/frontend/src/pages/billing/`)

| Archivo | Qué es |
| --- | --- |
| `BillingHome.tsx` | Inicio: título, chip de caja, total del día, botón **+ Nueva factura**, "Facturas de hoy" plegado. Caja cerrada: formulario de apertura + "Ver historial". Panel de caja (modal): datos de la apertura, movimientos, cierre y acceso al historial de cajas. |
| `NewInvoiceFlow.tsx` | Nueva factura en 3 pasos (¿Qué servicios o productos facturamos? / ¿A quién? / ¿Cómo paga?) + "Más opciones" + barra de total fija + pantalla de éxito. |
| `InvoiceHistory.tsx` | Historial único con vista **Facturas / Cajas**. Búsqueda con Enter, chips de estado, fechas bajo "Filtros", reporte bajo "⋯". |
| `billingShared.ts` | Constantes y helpers compartidos (rangos de fecha, métodos de pago, umbral SIFEN…). |
| `../BillingPage.tsx` | Orquestador de las tres pantallas (`home` / `invoice` / `history`). Conserva los nombres `activeTab: session \| invoice \| history` que usan Clientes, Fichas y el tour. |

`components/InvoiceStatePill.tsx` deriva el estado simple desde el estado de la factura y el de SIFEN:

| Estado | Cuándo |
| --- | --- |
| Aprobada | `ISSUED` sin SIFEN, o SIFEN aprobada / aprobada con observación |
| En proceso | SIFEN en cola o pendiente de verificación |
| Requiere atención | SIFEN rechazada (muestra **Corregir y reenviar**) |
| Anulada | `VOIDED` o SIFEN cancelada |

El historial filtra por estado con un chip por estado: **Todas / Aprobadas / En proceso / Requieren atención /
Anuladas**. `GET /api/invoices` y `GET /api/invoices/report` aceptan, en `status`, además de `ISSUED` / `VOIDED`
(estado de la factura): `APPROVED` (emitida y aprobada por SIFEN, o nunca enviada a SIFEN), `PROCESSING` (en cola o
esperando respuesta) y `ATTENTION` (emitida y rechazada por SIFEN). La traducción vive en
`InvoiceService.resolveStatusFilter`, que usan el listado y el reporte; los chips no se pisan entre sí.

## Detalle de la factura (`components/InvoiceDetailModal.tsx`)

Una sola vista, sin pestañas:

1. Encabezado: cliente, fecha, total y el estado simple.
2. Si SIFEN rechazó la factura, la sección **Resolver factura rechazada** (motivo, **Corregir y reenviar**,
   **Anular**) va arriba. Si está en proceso, una nota avisa que se actualiza sola.
3. Ítems (con su descuento debajo, si lo hay), totales y pagos.
4. Acciones: la principal (**Descargar KuDE** o **Descargar PDF**), **Compartir** (correo / WhatsApp) como
   botón propio y **⋯ Más acciones**.
5. En **⋯**: Anular factura, Cancelar en SIFEN, Revalidar en SIFEN, Identificar cliente, Asignar
   profesionales, Descargar muestra (estilo producción, solo en el ambiente de prueba) y **Detalle técnico**
   (timbrado, estado SIFEN real, CDC, protocolo, mensajes y contenido del documento).

Cada opción abre su panel debajo de las acciones, de a uno por vez: elegir otra lo reemplaza, y se cierra con su ✕, con la misma opción o volviendo a tocar **⋯** (que además vuelve a mostrar el menú). Los formularios y las reglas de
SIFEN son los de siempre; solo cambió dónde viven. Los helpers de e2e son `openInvoicePanel` / `closeInvoicePanel` (un panel a la vez), `openInvoiceSifenTab`
(detalle técnico) y `clickInvoiceMenuItem`.

## Reglas de negocio que se conservan

- Issue #284: el método de pago **no** se preselecciona; no se puede emitir hasta elegirlo.
- El monto del primer pago sigue al total; "Dividir pago" abre las filas con monto y método propios.
- Marca de tarjeta obligatoria con tarjeta (issue #170); descripción si la marca es "Otra".
- Total de Gs. 7.000.000 o más exige identificar al cliente (SIFEN HU-02 AC-05).
- Correo del destinatario obligatorio con SIFEN activo y cliente identificado (issue #173).
- Fecha de emisión editable solo al desbloquearla, dentro de -30 / +5 días (issue #174 AC-04).
- Descuento global y por ítem, propinas por profesional, profesional por línea (HU-COM-10) y aviso de
  stock (HU-66): ahora bajo "Más opciones" (el aviso de stock y el de "sin comisión" siguen junto al ítem).

## Decisiones de la propuesta

- **Cliente por defecto "Sin nombre"** (consumidor final). Buscar o crear un cliente, o elegir
  "Cliente ocasional", muestra sus datos fiscales. Vaciar el buscador vuelve a "Sin nombre".
- **Descuento y propinas** en "Más opciones".
- **Historial de cajas** como segunda vista del historial de facturas.

## Diferencias respecto a la maqueta aprobada

- La pantalla de éxito ofrece **Descargar PDF**, **+ Nueva factura** y **Volver al inicio**. El envío
  por email no está: hoy solo existe dentro del diálogo de la factura.
- El correo del cliente se muestra en el paso 2 (no en "Más opciones") porque es obligatorio con SIFEN.
- Hay cinco botones de método de pago (débito y crédito siguen siendo métodos distintos).
- La fecha de envío a SIFEN, que era una columna, pasa a la línea de datos de cada fila del historial.

## Tests

- Vitest: `BillingPage.test.tsx`, `InvoiceStatePill.test.tsx`.
- Playwright: `e2e/tests/billing-redesign.spec.ts` cubre los criterios de la propuesta; el resto de los
  specs de facturación se actualizaron a los nuevos controles. Helpers en `e2e/fixtures/billing.ts`
  (`goToBillingHome`, `goToInvoiceHistory`, `goToCashHistory`, `searchInvoiceHistory`, `openCashPanel`,
  `choosePaymentMethod`, `addPaymentMethodRow`, `showPaymentAmounts`, `fillPaymentAmount`,
  `openMoreOptions`, `ensureCashSessionOpen`).
