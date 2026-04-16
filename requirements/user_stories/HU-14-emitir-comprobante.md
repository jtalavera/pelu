# HU-14 · Emitir un comprobante

| Campo | Valor |
|--------|--------|
| **ID** | HU-14 |
| **Módulo** | Facturación |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** generar un comprobante de pago al finalizar un servicio,  
**para** registrar la venta y entregar un recibo fiscal a la cliente.

---

## Criterios de aceptación

1. **Origen del flujo** — Se puede iniciar un comprobante desde un turno completado o de forma independiente.
2. **Ítems** — Se pueden agregar uno o varios servicios como ítems (extensible a productos en el futuro).
3. **Cliente** — Se puede vincular a una cliente existente o emitir como “cliente ocasional” usando el **identificador genérico** del sistema (ver PRD — Definiciones transversales).
4. **RUC en comprobante** — Si la cliente tiene RUC, se muestra automáticamente; puede ajustarse solo para esa factura sin cambiar el perfil permanente.
5. **Descuento** — Se puede aplicar descuento en monto fijo o porcentaje sobre el total (reglas de cálculo documentadas).
6. **Método de pago** — Se selecciona método: efectivo, débito, crédito, transferencia u otro (lista cerrada o extensible según diseño).
7. **Numeración** — Al confirmar, se asigna el siguiente número disponible dentro del rango del timbrado activo; se muestra con 7 dígitos y ceros a la izquierda (ej. `0000043`).
8. **Sin timbrado válido** — Si no hay timbrado activo vigente, se bloquea la emisión y se muestra el error correspondiente.
9. **PDF** — El comprobante es descargable en PDF e incluye: datos del negocio, número de timbrado, número de factura, RUC del negocio, datos de la cliente (con RUC si aplica), ítems, subtotal, descuento, total y método de pago.

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/billing` — pestaña “New Invoice” (`Issue Invoice`): ítems, descuentos, cliente ocasional, PDF.
- **API:** emisión vía `/api/invoices` (o ruta equivalente en `InvoiceController`).
- **E2E:** `e2e/tests/hu-14-emitir-comprobante.spec.ts`.

---

## Notas para estimación y pruebas

- Enlaza con HU-02, HU-02b, HU-13, HU-10/HU-11.
- **Pruebas:** cálculo de total y descuento, numeración secuencial, borde de rango, PDF snapshot, cliente ocasional, override de RUC en línea.
