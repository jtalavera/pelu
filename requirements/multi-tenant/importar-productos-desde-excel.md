# Importar productos desde Excel

| Campo      | Valor                                        |
| ---------- | -------------------------------------------- |
| **ID**     | Cambio sin HU (pedido directo)               |
| **Módulo** | Importación de datos (Platform Admin)        |
| **Estado** | `Implementado`                               |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).
Extiende [HU-50](HU-50-formato-estandar-de-planillas-excel.md), [HU-51](HU-51-importar-servicios-desde-excel.md), [HU-54](HU-54-reporte-de-resultados-de-importacion.md) y [HU-55](HU-55-descargar-planillas-de-ejemplo.md), y sigue el [catálogo separado](../user_stories/catalogo-separado-servicios-productos.md).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** importar los productos de un salón desde su propio Excel, separado del de servicios,
**para** cargar cada catálogo con sus columnas, sin mezclar servicios y productos.

---

## Criterios de aceptación

Cubiertos por `e2e/tests/importar-productos-desde-excel.spec.ts` (salvo donde se indica otro spec).

1. **Solapa Productos.** La pantalla de importación (`/platform/import`) tiene la solapa **Productos** junto a **Servicios**, con su plantilla: `categoria`, `nombre`, `precio` (obligatorias) e `impuesto`, `activo`, `sku` (opcionales). No tiene `duracion_minutos` ni `tipo`.
2. **Importación.** Cada fila válida crea un ítem de tipo **Producto** en el salón elegido, con duración 1 (mínimo interno, igual que la pantalla de Productos) y el SKU indicado. Una categoría inexistente se crea como categoría de **productos**.
3. **Mismas reglas que servicios.** Precio numérico > 0, impuesto existente, duplicados nombre+categoría, SKU ≤ 64 caracteres; cada fila inválida se rechaza sola. Una fila cuya categoría ya existe como categoría de servicios se rechaza con `IMPORT_ROW_CATEGORY_KIND_MISMATCH`.
4. **Archivo inválido.** Un archivo sin una columna obligatoria se rechaza entero indicando la columna faltante.
5. **Planilla de ejemplo y reporte.** Se puede descargar `plantilla_ejemplo_productos.xlsx` (`hu-55-descargar-planillas-de-ejemplo.spec.ts`) y el último reporte de importación de productos se guarda por salón como el de las demás entidades (HU-54).
6. **Servicios acepta solo servicios.** La plantilla de **Servicios** queda en `categoria`, `nombre`, `precio`, `duracion_minutos`, `impuesto`, `activo` (sin `tipo` ni `sku`): toda fila crea un Servicio y su categoría nueva se crea como de servicios. Si un archivo viejo trae columnas `tipo`/`sku`, se ignoran. Una fila cuya categoría ya existe como de productos se rechaza con `IMPORT_ROW_CATEGORY_KIND_MISMATCH` (`hu-51-importar-servicios-desde-excel.spec.ts`).
7. **Sin sincronización automática con Stock.** Ninguna importación (servicios ni productos) envía nada a Stock. Para llevar los productos importados a Stock, el Platform Admin usa **«Sincronizar catálogo con Stock»** en la ficha del salón (`stock/hu-62-sincronizar-catalogo.spec.ts`).
