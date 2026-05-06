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

11. **Máscara de miles en *Precio Unitario* (MVP v2)** — En el formulario de emisión, el campo *Precio Unitario* de cada ítem usa una **máscara con separador de miles** (`.` para `es-PY`). El usuario solo escribe dígitos; la máscara muestra los miles separados al ingresar y al editar el valor. El monto enviado al backend es el valor numérico sin separadores.

12. **Máscara de miles en *Monto* de pagos (MVP v2)** — Idem criterio 11 para el campo *Monto* de cada método de pago: separador de miles `.` para `es-PY`, dígitos como entrada del usuario, número limpio al backend.

13. **Botón *Emitir comprobante* deshabilitado por validación (MVP v2)** — El botón **Emitir comprobante** permanece **deshabilitado** hasta que se cumplan **simultáneamente** las tres condiciones:
    - **Datos del cliente** completos: cliente seleccionado del directorio **o** marcada la casilla *Cliente ocasional*.
    - **Al menos un ítem de servicio** con precio unitario válido (> 0).
    - **Al menos un método de pago** con monto válido (> 0).

    Si cualquiera de las tres condiciones deja de cumplirse, el botón vuelve a deshabilitarse en tiempo real.

14. **Hora del comprobante en zona horaria de Paraguay (MVP v2)** — Al emitirse un comprobante, su `issuedAt` se persiste en **UTC** en la base de datos pero se **muestra siempre en hora local de Paraguay** (`America/Asuncion`, GMT-3) en la UI (lista de comprobantes y detalle) y en el **PDF**. La conversión es responsabilidad del frontend / del servicio de PDF; el modelo no cambia.

15. **Volver a Nuevo Comprobante tras crear cliente (MVP v2)** — Si desde el formulario de emisión el usuario abre el flujo *Nuevo cliente*, al guardar el cliente la aplicación **vuelve a la pestaña *Nuevo Comprobante*** con el cliente recién creado **preseleccionado** en el campo de cliente (vía `location.state` o equivalente, sin recarga del estado de los ítems / pagos ya cargados). Si el usuario cancela la creación, se vuelve a la misma pestaña sin pre-selección.

16. **PDF — limpieza de comprobante (MVP v2)** — El PDF de comprobante (HU-14, criterio 10) **no incluye**:
    - El número de **timbrado** ni la **vigencia** del timbrado (van pre-impresos en la papelería).
    - Los **encabezados de columna** *Cant.*, *Descripción*, *P. unit.* y *10%*.
    - Los **rótulos de método de pago** *Efec.*, *Deb.*, *Cred.*, *Transf.*, *Otro* (solo se imprimen los montos).
    - Los textos de **copia** *COPIA: ARCHIVO TRIBUTARIO* y *ORIGINAL: ADQUIRENTE*.

    Además, los datos de **RUC** y **Nombre del cliente** quedan **alineados** al campo *Fecha* (mismo eje horizontal X) para encajar con la papelería pre-impresa.

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/billing` — pestaña “New Invoice” (`Issue Invoice`): ítems, descuentos, cliente ocasional, PDF.
- **API:** emisión vía `/api/invoices` (o ruta equivalente en `InvoiceController`).
- **E2E:** `e2e/tests/hu-14-emitir-comprobante.spec.ts`.

---

## Notas para estimación y pruebas

- Enlaza con HU-02, HU-02b, HU-13, HU-10/HU-11.
- **Pruebas:** cálculo de total y descuento, numeración secuencial, borde de rango, PDF snapshot, cliente ocasional, override de RUC en línea.