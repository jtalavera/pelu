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
| `NewInvoiceFlow.tsx` | Nueva factura en 3 pasos (¿Qué hiciste? / ¿A quién? / ¿Cómo paga?) + "Más opciones" + barra de total fija + pantalla de éxito. |
| `InvoiceHistory.tsx` | Historial único con vista **Facturas / Cajas**. Búsqueda con Enter, chips de estado, fechas bajo "Filtros", reporte bajo "⋯". |
| `billingShared.ts` | Constantes y helpers compartidos (rangos de fecha, métodos de pago, umbral SIFEN…). |
| `../BillingPage.tsx` | Orquestador de las tres pantallas (`home` / `invoice` / `history`). Conserva los nombres `activeTab: session \| invoice \| history` que usan Clientes, Fichas y el tour. |

`components/InvoiceStatePill.tsx` deriva el estado simple desde el estado de la factura y el de SIFEN:

| Estado | Cuándo |
| --- | --- |
| Emitida | `ISSUED` sin SIFEN, o SIFEN aprobada / aprobada con observación |
| En proceso | SIFEN en cola o pendiente de verificación |
| Requiere atención | SIFEN rechazada (muestra **Corregir y reenviar**) |
| Anulada | `VOIDED` o SIFEN cancelada |

El detalle técnico de SIFEN sigue en el diálogo de la factura (`InvoiceDetailModal`, sin cambios).

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

- El historial no tiene el chip **Requieren atención**: el listado del backend filtra solo por
  `ISSUED` / `VOIDED`. Las facturas rechazadas se distinguen por su estado y por el botón
  **Corregir y reenviar**, y el inicio cuenta cuántas de hoy requieren atención. Filtrar por ese
  estado necesita un parámetro nuevo en `GET /api/invoices`.
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
