# HU-12 · Ver y editar el perfil de una cliente

| Campo | Valor |
|--------|--------|
| **ID** | HU-12 |
| **Módulo** | Cliente básico |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ver y editar los datos de una cliente,  
**para** mantener la información actualizada.

---

## Criterios de aceptación

1. **Listado** — Existe pantalla de listado de clientes con búsqueda por nombre, teléfono o RUC.
2. **Columnas** — El listado muestra: nombre, teléfono, RUC (si tiene) y cantidad de visitas.
3. **Perfil** — En el perfil se ven datos básicos y un historial simple de turnos y comprobantes asociados a esa cliente.
4. **Edición** — Se pueden editar nombre, teléfono, email y RUC con las mismas validaciones que en alta.
5. **RUC y unicidad al editar** — Al cambiar teléfono, email o RUC, se aplican las mismas reglas que en alta: validación de formato/RUC y unicidad **solo para valores no vacíos** (sin duplicados fantasma por campos vacíos).
6. **Baja lógica** — No se puede eliminar una cliente con historial asociado; solo desactivarla (historial conservado).

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/clients/:id` — `ClientDetailPage` (pestañas información, historial).
- **API:** `GET/PUT /api/clients/{id}`; citas y facturas relacionadas según endpoints existentes.
- **E2E:** `e2e/tests/hu-12-ver-y-editar-perfil-cliente.spec.ts`.

---

## Notas para estimación y pruebas

- **Pruebas:** búsqueda, orden, perfil con/sin historial, edición conflictiva de RUC, intento de borrado vs desactivación.
