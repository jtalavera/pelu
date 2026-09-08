# HU-42 · Asignar más de un Admin al mismo tenant

| Campo      | Valor                                                    |
| ---------- | ----------------------------------------------------------|
| **ID**     | HU-42                                                     |
| **Módulo** | Plataforma · Gestión de usuarios y admins de tenant       |
| **Estado** | `Backlog`                                                 |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma (tenant admin): [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** poder asignar más de un usuario como administrador de un mismo tenant,
**para** que varios usuarios puedan gestionar ese negocio si el cliente lo necesita.

---

## Criterios de aceptación

1. **Sin límite artificial** — El sistema permite crear y asignar más de un usuario con rol `ADMIN` al mismo tenant, repitiendo el flujo de HU-41.
2. **Permisos equivalentes** — Todos los admins asignados a un mismo tenant tienen exactamente los mismos permisos sobre los datos y la configuración de ese tenant; no hay jerarquía entre ellos.
3. **Listado de admins del tenant** — Desde el detalle de un tenant, el Platform Admin puede ver la lista de todos los usuarios (admins y profesionales con acceso) asociados a ese tenant.
4. **Independencia de sesiones** — Los admins de un mismo tenant operan con sesiones y credenciales independientes entre sí.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-41 (crear usuario admin).
- **Pruebas sugeridas:** asignar dos y tres admins al mismo tenant, verificar que cada uno accede con sus propias credenciales, verificar que todos tienen los mismos permisos sobre el tenant.
