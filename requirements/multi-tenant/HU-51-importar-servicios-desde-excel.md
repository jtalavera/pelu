# HU-51 · Importar catálogo de servicios desde Excel

| Campo      | Valor                                            |
| ---------- | --------------------------------------------------|
| **ID**     | HU-51                                             |
| **Módulo** | Plataforma · Importación de datos vía Excel       |
| **Estado** | `Backlog`                                         |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, formato de moneda, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Formato estándar de importación: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** importar el catálogo de servicios de un tenant desde una planilla Excel,
**para** cargar su oferta inicial sin tener que crear cada servicio manualmente.

---

## Criterios de aceptación

1. **Selección de archivo y tenant** — El Platform Admin elige el tenant destino y sube un archivo `.xlsx` con el formato de HU-50.
2. **Creación de categorías faltantes** — Si una fila referencia una categoría que no existe aún en ese tenant, el sistema la crea automáticamente antes de crear el servicio.
3. **Validación de precio y duración** — Filas con precio no numérico, precio negativo o cero, o duración no numérica o menor a 1 minuto, se rechazan individualmente sin detener la importación del resto del archivo.
4. **Impuesto opcional** — Si la columna `impuesto` referencia un impuesto que no existe en el tenant, la fila se rechaza con un motivo claro; si la columna está vacía, el servicio se crea sin impuesto asociado.
5. **Sin duplicados exactos** — Si dentro del mismo archivo hay dos filas con el mismo nombre de servicio y misma categoría, solo la primera se importa; la segunda se reporta como duplicada.
6. **Formato de precio en la UI** — Una vez importado, el servicio se visualiza con el mismo formato de moneda que el resto de la aplicación (separador de miles por punto, sin decimales).
7. **Aislamiento** — Los servicios importados quedan asociados exclusivamente al tenant seleccionado.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-50 (formato estándar), HU-37 (el tenant debe existir).
- **Pruebas sugeridas:** importación exitosa con categorías nuevas y existentes; fila con precio inválido rechazada sin detener el resto; fila con impuesto inexistente rechazada; duplicado dentro del mismo archivo reportado; verificación de formato de moneda tras la importación.
