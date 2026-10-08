# Ajustes 8-10-26 (issue #284)

| Campo      | Valor                                              |
| ---------- | -------------------------------------------------- |
| **ID**     | Issue [#284](https://github.com/jtalavera/pelu/issues/284) |
| **Módulo** | Facturación, Tableros, Catálogo ↔ Stock, Auditoría |
| **Estado** | `Implementado`                                     |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

## Criterios de aceptación

Cubiertos por `e2e/tests/issue-284-ajustes-8-10-26.spec.ts` salvo donde se indica otro archivo.

### 1. La categoría del producto viaja a Stock

> *¿Se usa la misma tabla de categorías para Pelu y Stock?* **No.** Pelu guarda sus categorías en
> `service_categories`; Stock tiene su propia tabla (`ItemCategory`). Lo que viaja es el **nombre** de
> la categoría (`category`) y Stock lo resuelve en su tabla.

- Cada producto que se envía a Stock (alta/edición, sincronización de catálogo y carga de plataforma)
  lleva el nombre de la categoría que tiene en Pelu (`StockPayloadsTest`).
- Si se **renombra una categoría de productos**, sus productos se reenvían a Stock con el nombre
  nuevo (`ServiceCatalogServiceTest`). Renombrar una categoría de servicios no toca Stock.
- Prueba cruzada con un control-stock real: `tests/stock/issue-284-categoria-del-producto-en-stock.spec.ts`
  (suite `npm run test:stock`, no se puede correr sin un checkout de control-stock).
- Según el contrato de Stock (`docs/03-api-rest.md` de control-stock), para un producto que **ya existe**
  en Stock solo se actualizan nombre y estado: un cambio posterior de categoría depende de Stock.

### 2. Gráfico de facturación: los días sin facturación se ven y suman al promedio

- Cada día de la ventana con facturación 0 muestra una marca (anillo en la línea base) y la leyenda
  incluye «Sin facturación». Antes eran barras de altura cero, invisibles.
- Esos días **cuentan en el promedio de 7 días** (la última marca del promedio es la media de los
  últimos 7 días incluyendo los ceros). El backend ya devolvía los 30 días; el frontend los dibuja.
- Pruebas: Playwright (`ajuste 2`), `RevenueTrendChart.test.tsx`.

### 3. Método de pago vacío en «Nuevo comprobante»

- El método de pago de la primera fila y de las filas que se agregan arranca **vacío** («Seleccionar
  método de pago»); ya no se asume Efectivo.
- Mientras esté vacío el campo muestra en rojo «Seleccioná un método de pago.» (`aria-invalid`) y el
  botón «Emitir comprobante» queda deshabilitado.
- Los specs que no se ocupan del método llaman a `ensurePaymentMethodChosen` (fixtures/invoice.ts).

### 4. Fondo del menú «Descargar reporte»

- El menú que se abre con «Descargar reporte» (Historial de facturación) tiene fondo de color sólido
  (antes era transparente porque usaba `rgb(var(--color-white))` con un token hexadecimal).

### 5. Número completo en el reporte exportado

- La columna «Número» del Excel y del PDF del Historial muestra el mismo número que el KuDE:
  **establecimiento-punto de expedición-número** (ej.: `001-001-0000007`).
- Prueba: Playwright (`ajuste 5`, lee el .xlsx con exceljs y el PDF) y `InvoiceHistoryReportServiceTest`.

### 6. Títulos de los gráficos

| Antes                    | Ahora                     |
| ------------------------ | ------------------------- |
| Tendencia de facturación | **Facturación**           |
| Mezcla de medios de pago | **Medios de pago**        |
| Servicios más vendidos   | **Servicios más facturados** |

(en inglés: *Invoicing*, *Payment methods*, *Most invoiced services*). Prueba: Playwright (`ajuste 6`)
y `src/i18n/chartTitles.test.ts`. Se actualizaron los specs de los issues #219/#220/#221.

### 7. Auditoría: quién hizo qué

- Se registra, en la tabla `audit_log` (`V74`), cada operación que **modifica datos** (POST/PUT/PATCH/
  DELETE) de un usuario autenticado y que terminó bien: usuario (correo y rol), recurso y acción,
  id del registro afectado (el que va en la URL; una alta no tiene id en la URL) y momento (UTC).
- **Nunca se guarda el contenido** del pedido (sin contraseñas, certificados, CSC ni datos personales).
- No se registran lecturas, inicios de sesión, llamadas de máquinas (integración, webhook), la
  telemetría de los tours ni los endpoints de soporte de pruebas.
- **Administrador del salón**: Configuración → **Auditoría**, solo su salón, de lo más reciente a lo más
  antiguo, con filtros por fechas, «Qué» (recurso) y usuario, paginado. `GET /api/audit` (403 para
  profesionales y root).
- **Usuario root**: Plataforma → **Auditoría**, todos los salones (columna «Negocio») y sus propias
  acciones («Plataforma»), con filtro opcional por salón. `GET /api/platform/audit`.
- Rango de fechas inválido: `INVALID_DATE_RANGE` (400), traducido en el front con regla y ejemplo.
- Pruebas: Playwright (`ajuste 7`), `mt-isolation/mt-auditoria.spec.ts` (aislamiento entre salones),
  `AuditLogServiceTest`, `AuditLogControllersTest`, `AuditLogFilterTest`, `AuditLogPanel.test.tsx`.

## Fuera de alcance / limitaciones

- La auditoría no registra inicios de sesión ni intentos fallidos; tampoco las operaciones que
  terminan con error.
- No hay retención/purga de `audit_log`: la tabla crece con el uso.
- `V74` no se probó contra un SQL Server real (los tests usan H2).
