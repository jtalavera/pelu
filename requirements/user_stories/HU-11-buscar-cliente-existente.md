# HU-11 · Buscar una cliente existente

| Campo | Valor |
|--------|--------|
| **ID** | HU-11 |
| **Módulo** | Cliente básico |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** buscar una cliente por nombre, teléfono o RUC en el directorio **y desde el alta de turno**,  
**para** vincularla rápidamente sin salir del flujo.

---

## Criterios de aceptación

1. **Listado principal** — En la pantalla de clientes existe un listado combinado con búsqueda por nombre, teléfono o RUC.
2. **Búsqueda incremental** — La búsqueda se dispara mientras se escribe (desde 2 caracteres) por nombre, teléfono o RUC.
3. **Resultados** — Cada resultado muestra nombre, teléfono y RUC (si existe) para identificar sin ambigüedad.
4. **Buscador inline en nueva cita** — En el modal de nueva cita existe un buscador de cliente que exhibe nombre (y datos relevantes) al seleccionar.

---

## Implementación actual (código, 2026-04)

- **UI:** búsqueda en listado y campos de búsqueda inline (`SearchInput` / filtros).
- **API:** listados y búsqueda de clientes (`/api/clients` con query).
- **E2E:** `e2e/tests/hu-11-buscar-cliente-existente.spec.ts`; cobertura de facturación (autocompletado, cliente ocasional) en **HU-10 / HU-14**.

---

## Notas para estimación y pruebas

- **Pruebas:** debounce/threshold de 2 caracteres, sin resultados; coherencia con **HU-07** al seleccionar cliente en nueva cita.
