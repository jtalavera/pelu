# HU-14 · Emitir un comprobante


| Campo      | Valor       |
| ---------- | ----------- |
| **ID**     | HU-14       |
| **Módulo** | Facturación |
| **Estado** | `Done`      |


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

1. **Formulario de emisión** — Existe pantalla usable (pestaña “New Invoice” u homóloga) para cargar ítems, cliente y totales con acción explícita de emisión.

2. **Ítems y totales** — Se pueden agregar uno o más servicios como ítems y registrar el pago hasta cubrir el total.

3. **Cliente** — Se puede emitir como cliente seleccionado del directorio **o** como “cliente ocasional” con el identificador genérico del sistema.

4. **RUC en línea sobre cliente** — Si la cliente viene del directorio se precarga RUC nombre; pueden corregirse para la línea fiscal de esa emisión conforme UX (incluye sincronización opcional posterior al perfil cuando aplica, ver HU-25).

5. **Descuento** — Se puede aplicar descuento como porcentaje o monto fijo sobre el total, con validaciones visibles cuando el tipo de descuento aplica.

6. **Numeración correlativa** — Al confirmarse la emisión, se asigna el siguiente correlativo dentro del timbrado activo en el formato de 7 dígitos con ceros a la izquierda (aspecto observable en la confirmación o en el PDF).

7. **Sin timbrado válido para la fecha** — Si no hay timbrado activo válido para el día actual (incluye expirados o rangos ilegibles), la emisión falla en UI **o** vía mensaje/error controlado antes de crear el documento definitivo.

8. **Sesión de caja** — Sin sesión de caja abierta, `POST /api/invoices` (o equivalente) responde con error de dominio conocido (**p. ej.** `CASH_SESSION_NOT_OPEN`); mismo criterio de negocio que impide crear el comprobante.

9. **RUC del negocio obligatorio cuando aplica** — Si falta el RUC de negocio requerido para operar fiscalmente en el modelo implementado, se muestra un aviso de producto destacado (p. ej. en dashboard) **y/o** se bloquea la emisión hasta corregirlo; el comportamiento es observable sin ambigüedad.

10. **PDF** — El comprobante emitido permite descarga con tipo de contenido `application/pdf`; el archivo debe ser legible como PDF (no puede ser página de error HTML disfrazada).

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/billing` — pestaña “New Invoice” (`Issue Invoice`): ítems, descuentos, cliente ocasional, PDF.
- **API:** emisión vía `/api/invoices` (o ruta equivalente en `InvoiceController`).
- **E2E:** `e2e/tests/hu-14-emitir-comprobante.spec.ts`.

---

## Notas para estimación y pruebas

- Enlaza con HU-02, HU-02b, HU-13, HU-10/HU-11.
- **Pruebas:** cálculo de total y descuento, numeración secuencial, borde de rango, PDF snapshot, cliente ocasional, override de RUC en línea.