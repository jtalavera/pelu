# Rediseño minimalista del Catálogo

Tercera pantalla del rediseño web (rama `refactor/redesign-catalogo`). Servicios, Productos y
Profesionales pasan a ser **vistas de una sola pantalla**. Maqueta aprobada:
https://claude.ai/artifact/SccBti8kzhxPJ2AweQhzee

## Qué ve el usuario

- Ruta `/app/catalog?view=services|products|professionals` (`pages/CatalogPage.tsx`). Un solo ítem
  "Catálogo" en el menú; `/app/services`, `/app/products` y `/app/professionals` redirigen a la vista
  correspondiente.
- Control de tres vistas arriba, buscador y, en Servicios/Productos, chips de categoría.
- **Lista** en lugar de tabla: nombre, detalle corto (`Categoría · 45 min · Gs. 100.000`) y un
  **interruptor** activo/inactivo. Los inactivos quedan al final, atenuados, con "Inactivo". Tocar la
  fila abre la edición. Se mantiene el paginado.
- **"+ Nuevo …"** y **"⋯"** en el encabezado (la vista de Profesionales no tiene "⋯"):
  - "⋯" → **Descargar lista de precios** y **Administrar categorías** (diálogo con alta, edición y
    activar/desactivar categorías).
- **Alta mínima**, con lo poco común en **Más opciones**:

  | Vista | Siempre visible | Más opciones |
  | --- | --- | --- |
  | Servicio | nombre, categoría, precio, duración | tipo de impuesto |
  | Producto | nombre, categoría, precio | código SKU, impuesto |
  | Profesional | nombre, teléfono, horario | correo, PIN, acceso al sistema, foto |

- **Horario del profesional**: un profesional nuevo arranca de **lunes a sábado, 09:00 a 18:00**. Se
  ve como resumen y **Cambiar** despliega los días. Detalles y horario son un solo formulario: al
  guardar se crea/actualiza el profesional y se guarda su horario (`PUT …/schedules`). Si un error cae
  en un campo de "Más opciones" (correo, PIN, foto), la sección se abre sola.
- Las reglas de comisión (pestaña "Comisión" de un servicio con el módulo activo), el aviso de ítems
  sin comisión y los diálogos de confirmación para desactivar se conservan.

## Qué se quitó

- Pestañas Servicios/Categorías, filtros "Active only / Inactive only", tabla con menú ⋯ por fila
  ("Editar detalles / Editar horario / Desactivar"): el interruptor y la edición completa los reemplazan.
- Pestañas Detalles/Horario de Profesionales y el botón "Guardar y definir horario".
- Tour guiado: los tres pasos del menú se fundieron en uno ("Catálogo").

## Tests

- Vitest: `ServicesPage.test.tsx`, `ProductsPage.test.tsx`, `ProfessionalsPage.test.tsx`.
- Playwright: helpers en `e2e/fixtures/catalog.ts` (`goToCatalog`, `openCategoriesDialog`,
  `openCatalogMenuItem`, `openItemMoreOptions`, `setCatalogRowActive`) y los specs de servicios,
  productos, profesionales, comisiones y lista de precios adaptados.
