# HU-39 · Listado y búsqueda de tenants

| Campo      | Valor                                 |
| ---------- | --------------------------------------|
| **ID**     | HU-39                                 |
| **Módulo** | Plataforma · Gestión de Tenants       |
| **Estado** | `Backlog`                             |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma (paginación estándar): [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** ver un listado paginado y buscable de todos los tenants,
**para** ubicar rápidamente el tenant que necesito administrar.

---

## Criterios de aceptación

1. **Listado** — La pantalla muestra nombre, dominio, tier y estado (Activo/Suspendido) de cada tenant.
2. **Búsqueda** — Un campo de búsqueda filtra por nombre o dominio; la búsqueda se dispara al enviar el formulario (Enter o botón), sin `onKeyDown` duplicado, igual que el resto de la app (ver `AdminTenantDetailPage`/`AdminUserSupportPage` como referencia de convención).
3. **Paginación** — El listado ofrece 10/25/50 filas por página (default 10), resuelto server-side, con los componentes `Pagination` + `PageSizeSelect` del design system.
4. **Acceso al detalle** — Cada fila permite navegar a la edición del tenant (HU-38).
5. **Estado vacío** — Si no hay tenants o la búsqueda no arroja resultados, se muestra un mensaje claro en vez de una tabla vacía sin contexto.
6. **Scroll horizontal** — La tabla vive dentro de un contenedor `overflow-x-auto` en pantallas angostas.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-37 (crear tenant).
- **Pruebas sugeridas:** búsqueda por nombre parcial, búsqueda por dominio, cambio de tamaño de página, paginado con más de 50 tenants, estado vacío sin resultados.
