# HU-25 · Fixes varios (UX general)


| Campo      | Valor          |
| ---------- | -------------- |
| **ID**     | HU-25          |
| **Módulo** | Varios (front) |
| **Estado** | `In Progress`  |


## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ajustes puntuales de usabilidad en el producto,  
**para** trabajar con menos fricción en flujos frecuentes.

---

## Criterios de aceptación

1. **Facturación — fila única cliente** — En el campo de búsqueda de clientes (`ClientSearchField`) en emisión de factura, cada opción desplegable muestra en una sola fila línea nombre, datos de contacto e indicadores necesarios (texto largo recorta con puntos suspensivos; ítem con `title` con el texto completo).
2. **Facturación — sincronización cliente tras emisión** — Si se modificó nombre y/o RUC respecto del cliente seleccionado, tras emitir exitosamente se intenta sincronizar al directorio mediante `PUT /api/clients/{id}`; si el guardado posterior falla, se muestra advertencia porque el comprobante ya existe.
3. **Facturación — fila única servicio** — El buscador de servicios por ítem muestra opciones en una sola línea (nombre, categoría, precio, duración) con patrón de truncado coherentemente con cliente.
4. **Combobox + Enter** — En `ClientSearchField`, `ServiceSearchField` y `SearchableSelect` del calendario, si tras pulsar Enter queda solo una opción filtrada, esa opción se aplica como selección.
5. **Facturación — alineación de importes de línea** — El campo que muestra cantidad × precio en cada ítem de factura está alineado y estilizado de forma uniforme respecto del precio unitario.
6. **Montos Guaraníes** — Las cantidades monetarias siguen formato `es-PY` vía `lib/formatMoney.ts` (punto miles, coma decimal) en vistas críticas (factura, lista de servicios, dashboard al menos en caminos donde se modificó HU-25).
7. **Historial — rango máximo / índice** — Cobertura de reglas de fecha e índice documentadas en HU-16 (implementación compartida; no duplicar aquí texto funcional más allá de la referencia cruzada).
8. **Calendario — banda temporal** — Al mover el puntero para inspeccionar un slot temporal, la resal visual refleja el intervalo de tiempo correcto para la interacción (30 min donde aplica).

---

## Implementación actual (código, 2026-04)

- **Listas / UX:** `ClientSearchField.tsx`, `ServiceSearchField.tsx`.
- **Sincronización cliente con factura:** `BillingPage.tsx` (`NewInvoiceTab`).
- **E2E:** ver `hu-14-emitir-comprobante.spec.ts`, `hu-19-fixes-varios-calendario.spec.ts`.

---

## Tests automatizados (referencias)

| Criterio | Playwright (`e2e/tests/`) |
| -------- | ------------------------- |
| 1–3 | `hu-14-emitir-comprobante.spec.ts` (prefijo `HU-25`) |
| 4–6 | No cubiertos en una sola aserción E2E específica; ver Vitest mencionados en PR / `formatMoney`; Enter en combinación de campos donde aplica HU-07 |
| 7 | Detalle en HU-16 |

---

## Notas

- Este documento sólo agrupa mejoras UX; la numeración estable de historia no debe **incrustar dependencias ascendentes** hacia HU-XX mayores mediante criterios (la referencia HU-16 arriba es documental, no requisito de implementación paralela).

