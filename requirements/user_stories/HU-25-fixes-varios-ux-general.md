# HU-25 · Fixes varios (UX general)

| Campo | Valor |
|--------|--------|
| **ID** | HU-25 |
| **Módulo** | Varios (front) |
| **Estado** | `In Progress` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ajustes puntuales de usabilidad en el producto,  
**para** trabajar con menos fricción en flujos frecuentes.

---

## Criterios de aceptación

1. **Emitir comprobante — lista de clientes** — En Facturación → «New Issue» / emisión de factura, el desplegable de búsqueda de clientes (`ClientSearchField`) muestra en **una sola fila** el nombre, el RUC, el teléfono, el indicador de inactiva (si aplica) y el resto de metadatos, con la misma información que antes pero sin apilar en dos renglones. Texto largo se recorta con puntos suspensivos y el `title` del ítem repite la línea completa al pasar el cursor.

2. **Emitir comprobante — edición de cliente en la factura** — Si se eligió un cliente del directorio y se modifica en el formulario de emisión el **nombre** y/o el **RUC** (respecto del registro seleccionado), al confirmar la factura con éxito se ejecuta además un `PUT /api/clients/{id}` para **persistir esos datos en el directorio** (teléfono y email del registro se conservan). Se valida RUC con el mismo criterio que en Clientes; el nombre no puede quedar vacío con cliente vinculado. Si el guardado de factura sale bien y el `PUT` falla, se muestra una **advertencia** (el comprobante ya se emitió).

3. **Emitir comprobante — lista de servicios** — En el buscador de servicios de cada ítem (`ServiceSearchField`), las opciones muestran en **una sola fila** el nombre, categoría, precio en guaraníes y duración, con el mismo patrón de una fila, recorte y `title` que en clientes.

### Implementación (código)

- **Listas / UX:** `ClientSearchField.tsx`, `ServiceSearchField.tsx`
- **Sincronización de cliente con factura:** `BillingPage.tsx` (`NewInvoiceTab` — tras `POST /api/invoices` exitoso, condicional `femmePutJson` al cliente) + `lib/validateRuc.ts` (reutilizado también en `ClientsPage` y `ClientDetailPage`).
- **E2E:** `e2e/tests/hu-14-emitir-comprobante.spec.ts`

4. **Búsquedas con lista desplegable + Enter** — En campos estilo combobox con filtrado mientras se escribe (`ClientSearchField`, `ServiceSearchField`, `SearchableSelect` del calendario), si al **Enter** queda **una sola** opción en la lista, esa opción se aplica (sin forzar a hacer clic). `SearchableSelect` ya lo tenía; se unificó en clientes y servicios.

5. **Facturación — total de línea** — En el formulario de ítems, el importe **cantidad × precio unitario** se muestra **centrado** en su celda, con tipografía alineada al **precio unitario** (`text-sm` / misma sensación que el `Input`).

6. **Formato de montos (producto)** — Todos los importes en guaraníes usan separador de miles **punto** (`.`) y, cuando hay decimales, coma como separador fraccional, vía `lib/formatMoney.ts` (`es-PY`). Aplica a facturación, servicios, dashboard, etc. Regla fijada también en `.cursorrules`.

### Pruebas

- Playwright: tests «HU-25 · lista de clientes…», «HU-25 · factura con edición de nombre/RUC…», «HU-25 · lista de servicios…».
- Vitest: `ClientSearchField.test.tsx`, `ServiceSearchField.test.tsx`, `lib/formatMoney.test.ts`.

---

7. **Historial de comprobantes (rango e índice)** — Criterio cubierto en [HU-16](HU-16-historial-de-comprobantes.md#actualizaciones-2026-04-rango-e-índice).

## Notas

- Rama: `fix/general_ux`. Se irán añadiendo criterios a esta HU o historias adicionales según el alcance de cada fix.
