# HU-45 · Crear y administrar Tiers

| Campo      | Valor                                       |
| ---------- | ---------------------------------------------|
| **ID**     | HU-45                                        |
| **Módulo** | Plataforma · Tiers y Feature Flags           |
| **Estado** | `Backlog`                                    |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definición de Tier: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** crear, editar y eliminar tiers,
**para** tener paquetes reutilizables de funcionalidades que pueda asignar a los tenants.

---

## Criterios de aceptación

1. **Alta de tier** — El Platform Admin crea un tier con nombre (obligatorio, único) y descripción (opcional).
2. **Edición** — El Platform Admin puede editar el nombre y la descripción de un tier existente.
3. **Eliminación con protección** — Un tier en uso por al menos un tenant no puede eliminarse; el sistema muestra un mensaje claro indicando cuántos tenants lo usan. Un tier sin tenants asignados puede eliminarse.
4. **Listado** — El Platform Admin ve un listado de todos los tiers existentes con la cantidad de tenants que tiene cada uno.
5. **Nombre único** — El sistema rechaza crear o renombrar un tier con un nombre ya usado por otro tier.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-34 (rol Platform Admin).
- **Pruebas sugeridas:** alta/edición exitosa, nombre duplicado rechazado, eliminación de un tier en uso rechazada, eliminación de un tier sin uso exitosa.
