# HU-04 · Crear y gestionar servicios


| Campo      | Valor        |
| ---------- | ------------ |
| **ID**     | HU-04        |
| **Módulo** | Agendamiento |
| **Estado** | `Done`       |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** definir los servicios que ofrece la peluquería con su nombre, precio y duración,  
**para** poder usarlos al agendar turnos y en los flujos de venta del producto.

---

## Criterios de aceptación

1. **Categorías del negocio** — El administrador puede crear, editar y desactivar la **lista de categorías** de su negocio (por tenant); en servicios y filtros solo se usan categorías de esa lista (lista cerrada).
2. **Alta de servicio** — Se puede crear un servicio con: nombre, **categoría elegida de la lista del negocio**, precio y duración en minutos.
3. **Edición** — Cualquier servicio existente puede editarse con los mismos campos.
4. **Desactivación** — Se puede desactivar un servicio sin borrarlo; no aparece en nuevos turnos pero el historial se preserva (turnos/comprobantes previos siguen referenciando el servicio según modelo de datos).
5. **Lista con búsqueda y filtro** — La lista de servicios es buscable y filtrable por categoría.
6. **Edición vía pop-up — servicios (MVP v2)** — En la lista de **servicios**, al hacer **clic** sobre un registro se abre un **pop-up / modal de edición** con el formulario completo del servicio. La edición *inline* sobre la fila se elimina; toda modificación pasa por el pop-up. La fila también es activable por teclado (`Enter` / `Space`) para abrir el modal.
7. **Edición vía pop-up — categorías (MVP v2)** — Idem criterio 6 para la solapa **Categorías**: al hacer **clic** sobre un registro de categoría se abre un **pop-up / modal de edición** con el formulario de categoría; no se permite edición inline.

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/services` — `ServicesPage` (pestañas servicios y categorías).
- **API:** categorías y servicios bajo `/api/service-categories` y `/api/services` (ver controladores).
- **E2E:** `e2e/tests/hu-04-crear-y-gestionar-servicios.spec.ts`.

---

## Notas para estimación y pruebas

- **Pruebas:** CRUD feliz, desactivado oculto en selector de nuevos turnos, visible en historial, búsqueda/filtro con casos límite (sin resultados).

