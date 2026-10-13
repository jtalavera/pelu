# Catálogo separado · Servicios y Productos

| Campo      | Valor                                   |
| ---------- | --------------------------------------- |
| **ID**     | Cambio sin HU (pedido directo)          |
| **Módulo** | Servicios, Productos, Categorías        |
| **Estado** | `Implementado`                          |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** que los ítems de tipo Servicio y los de tipo Producto se gestionen en pantallas separadas, cada una con sus propias categorías,  
**para** distinguir visualmente lo que presto de lo que vendo.

---

## Criterios de aceptación

Cada criterio está cubierto por `e2e/tests/menu-productos-separado-de-servicios.spec.ts` (salvo donde se indica otro spec).

1. **Menú.** El menú principal tiene la opción **Productos** justo debajo de **Servicios** (siempre visible, aunque el salón no tenga Stock activo). Abre `/app/products`.
2. **Separación.** **Servicios** lista SOLO ítems de tipo Servicio. **Productos** lista SOLO ítems de tipo Producto.
3. **Pantalla de Productos** es igual a la de Servicios (búsqueda, filtros, paginación, alta/edición/desactivación, lista de precios), pero:
   - no tiene el campo **Duración** (ni columna ni formulario; se guarda el mínimo de 1 internamente);
   - muestra el **Código (SKU)** en la tabla y en el formulario;
   - ninguna de las dos pantallas tiene el selector/filtro **Tipo**: el tipo lo define la pantalla.
4. **Filtros.** En cada pantalla las píldoras de categoría muestran solo categorías de ese tipo, y los filtros de estado y búsqueda se aplican solo sobre ítems de ese tipo.
5. **Categorías exclusivas.** Cada pantalla tiene su solapa **Categorías** con las categorías de su tipo. Una categoría creada en Productos no aparece en Servicios y viceversa; los formularios solo ofrecen categorías del tipo.
6. **Reglas de la API.** Un ítem solo puede estar en una categoría de su mismo tipo (`CATEGORY_KIND_MISMATCH`); una categoría no puede cambiar de tipo (`CATEGORY_KIND_IMMUTABLE`). `GET /api/services` y `GET /api/service-categories` aceptan `?kind=SERVICE|PRODUCT`.
7. **Calendario.** Al agendar un turno solo se ofrecen Servicios (nunca Productos).
8. **Lista de precios (PDF).** Servicios y Productos van en secciones separadas (`issue-217-lista-precios.spec.ts`).
9. **Importación Excel.** Se mantiene la columna `tipo`. La categoría nueva toma el tipo de la fila; una fila cuyo tipo no coincide con el de una categoría ya existente se rechaza con `IMPORT_ROW_CATEGORY_KIND_MISMATCH` (`hu-51-importar-servicios-desde-excel.spec.ts`).
10. **Multi-tenant.** Las categorías por tipo respetan el aislamiento entre salones (`mt-isolation/mt-stock.spec.ts`).

## Migración de datos (V72)

Los datos existentes se reclasifican **por categoría** (la categoría manda y se copia a todos sus ítems):

- Categorías **Servicios de peluquería**, **Servicios especiales**, **Tratamientos**, **Otros** y **Servicios profesionales** (sin distinguir mayúsculas, tildes ni espacios sobrantes) → `SERVICE`, y sus ítems quedan como Servicio.
- **Cualquier otra categoría** → `PRODUCT`, y sus ítems quedan como Producto.

Las categorías no se duplican. Los ítems que pasan a Producto no se envían solos a Stock: usar «Sincronizar catálogo con Stock» desde la ficha del salón después del despliegue (ver `docs/stock-integration.md`).

> La migración es T-SQL (SQL Server) y los tests e2e corren sobre H2 sin Flyway, por lo que **no tiene un test Playwright automatizado**; se verifica manualmente con las consultas de abajo.

```sql
-- Debe devolver 0 filas: ningún ítem con tipo distinto al de su categoría.
SELECT s.id FROM services s JOIN service_categories c ON c.id = s.category_id WHERE s.kind <> c.kind;
-- Resumen por categoría.
SELECT t.id AS tenant_id, c.name, c.kind, COUNT(s.id) AS items FROM service_categories c
JOIN tenants t ON t.id = c.tenant_id LEFT JOIN services s ON s.category_id = c.id GROUP BY t.id, c.name, c.kind;
```
