# HU-31 · Seed de productos desde archivo CSV

| Campo      | Valor                  |
| ---------- | ---------------------- |
| **ID**     | HU-31                  |
| **Módulo** | Datos semilla / Backend |
| **Estado** | `Backlog`              |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador del sistema,  
**quiero** que los productos del negocio estén precargados en la base de datos desde el archivo `articulos_normalizado.csv`,  
**para** que el tenant #1 cuente con un catálogo inicial de productos sin necesidad de cargarlos manualmente.

---

## Criterios de aceptación

1. **Fuente de datos** — Los productos se leen de la columna `Descripcion` (columna 1) del archivo `requirements/articulos_normalizado.csv`. Las demás columnas se ignoran.

2. **Entidad destino** — Cada descripción se persiste como un registro `SalonService` asignado al tenant con `id = 1`.

3. **Categoría `Productos`** — Todos los registros semilla se asocian a la categoría de servicio cuyo nombre sea `Productos`. Si la categoría ya existe, los servicios apuntan a ella; si no existe, se crea antes de insertar los servicios.

4. **Idempotencia** — El seed puede ejecutarse múltiples veces sin generar duplicados. Si un servicio con el mismo nombre ya existe bajo la categoría `Productos` para el tenant #1, se omite su inserción.

5. **Integración con el inicializador existente** — La lógica de seed se incorpora dentro del mecanismo de inicialización de datos de demostración ya existente (`FemmeDataInitializer`) para respetar el orden de carga y la gestión del ciclo de vida.

---

## Notas

- El archivo CSV usa BOM UTF-8; el lector debe ignorarlo al procesar el encabezado.
- Los criterios 3 y 4 garantizan que el seed sea seguro de ejecutar en entornos con datos previos (p. ej. tras un reset parcial de la BD semilla, como en HU-27).
