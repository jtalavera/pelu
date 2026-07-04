# HU-32 · Paginación en tablas

| Campo      | Valor                        |
| ---------- | ---------------------------- |
| **ID**     | HU-32                        |
| **Módulo** | Servicios, Profesionales.    |
| **Estado** | `Backlog`                    |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** que las tablas de Servicios y Profesionales muestren controles de paginación,  
**para** navegar eficientemente por listados largos sin cargar todos los registros de una sola vez.

---

## Criterios de aceptación

### Estándar de paginación (aplica a todas las tablas de esta HU)

- El selector de registros por página ofrece las opciones **10**, **25** y **50**.
- El valor por defecto es **10 registros por página**.
- Se muestra el rango de registros visibles y el total (e.g. "1–10 de 47").
- Los controles de página anterior / siguiente se deshabilitan cuando no corresponde avanzar o retroceder.
- Al cambiar el tamaño de página la vista vuelve a la página 1.
- La paginación es **server-side**: el backend recibe `page` y `size` como parámetros de query y devuelve una respuesta `PageResponse<T>` con `content`, `page`, `size`, `totalElements` y `totalPages`.
- El componente de paginación a usar es `Pagination` del design-system (`src/frontend/design-system/components/`), siguiendo el mismo patrón que `BillingPage` y `ClientsPage`.

---

### 1. Tabla de Servicios (`ServicesPage`)

**Estado actual:** el endpoint `GET /api/services` devuelve todos los servicios sin paginar; el frontend los renderiza en una tabla completa.

**Cambios requeridos:**

1. **Backend** — `SalonServiceController` / `SalonServiceService` / `SalonServiceRepository`: agregar soporte a `Pageable` en el endpoint `GET /api/services`, devolviendo `PageResponse<SalonServiceResponse>`. Respetar el filtro de búsqueda por texto (`q`) ya existente.
2. **Frontend** — `ServicesPage`: reemplazar la carga completa por una llamada paginada; agregar selector de tamaño de página y controles `Pagination` debajo de la tabla, siguiendo el estándar definido arriba.
3. Al cambiar el filtro de búsqueda, la tabla vuelve a la página 1.

---

### 2. Tabla de Profesionales (`ProfessionalsPage`)

**Estado actual:** el endpoint `GET /api/professionals` devuelve todos los profesionales sin paginar; el frontend los renderiza en una tabla completa.

**Cambios requeridos:**

1. **Backend** — `ProfessionalController` / `ProfessionalService` / `ProfessionalRepository`: agregar soporte a `Pageable` en el endpoint `GET /api/professionals`, devolviendo `PageResponse<ProfessionalResponse>`. Respetar el filtro de búsqueda por texto ya existente.
2. **Frontend** — `ProfessionalsPage`: reemplazar la carga completa por una llamada paginada; agregar selector de tamaño de página y controles `Pagination` debajo de la tabla, siguiendo el estándar definido arriba.
3. Al cambiar el filtro de búsqueda, la tabla vuelve a la página 1.

---


## Tablas que YA tienen paginación (no modificar)

| Tabla | Página / Componente |
| ----- | ------------------- |
| Historial de comprobantes | `BillingPage` |
| Comprobantes del día de caja | `BillingPage` (sección caja) |
| Comprobantes del cliente | `ClientDetailPage` |
| Turnos del cliente | `ClientDetailPage` |
| Lista de clientes | `ClientsPage` |

---

## Notas

- El DTO `PageResponse<T>` ya existe en `src/backend/src/main/java/com/cursorpoc/backend/web/dto/PageResponse.java`; reutilizarlo sin modificar.
- Los selectores de tamaño de página y los textos de rango/navegación deben usar claves i18n bajo `femme.pagination.*` (ya definidas en `en.json` / `es.json`).
- Si un listado tiene menos de 10 registros en total, los controles de paginación igualmente deben mostrarse (con el selector en 10 y un único grupo de páginas), para consistencia visual.
