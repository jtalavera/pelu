# HU-04 · Crear y gestionar servicios

| Campo | Valor |
|--------|--------|
| **ID** | HU-04 |
| **Módulo** | Agendamiento |
| **Estado** | `Backlog` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** definir los servicios que ofrece la peluquería con su nombre, precio y duración,  
**para** poder usarlos al agendar turnos y al emitir comprobantes.

---

## Criterios de aceptación

1. **Categorías del negocio** — El administrador puede crear, editar y desactivar la **lista de categorías** de su negocio (por tenant); en servicios y filtros solo se usan categorías de esa lista (lista cerrada).
2. **Alta de servicio** — Se puede crear un servicio con: nombre, **categoría elegida de la lista del negocio**, precio y duración en minutos.
3. **Edición** — Cualquier servicio existente puede editarse con los mismos campos.
4. **Desactivación** — Se puede desactivar un servicio sin borrarlo; no aparece en nuevos turnos pero el historial se preserva (turnos/comprobantes previos siguen referenciando el servicio según modelo de datos).
5. **Lista con búsqueda y filtro** — La lista de servicios es buscable y filtrable por categoría.

---

## Notas para estimación y pruebas

- **Pruebas:** CRUD feliz, desactivado oculto en selector de nuevos turnos, visible en historial, búsqueda/filtro con casos límite (sin resultados).
