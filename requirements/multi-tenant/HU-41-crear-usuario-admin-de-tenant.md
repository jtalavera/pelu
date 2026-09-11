# HU-41 · Platform Admin crea un usuario y lo asigna a un tenant como Admin

| Campo      | Valor                                                    |
| ---------- | ----------------------------------------------------------|
| **ID**     | HU-41                                                     |
| **Módulo** | Plataforma · Gestión de usuarios y admins de tenant       |
| **Estado** | `Backlog`                                                 |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** crear un usuario y asignarlo a un tenant con rol de administrador,
**para** que ese negocio tenga a alguien que pueda operar el sistema.

---

## Criterios de aceptación

1. **Formulario de alta** — El Platform Admin crea un usuario indicando email y el tenant al que se asigna; el usuario queda con rol `ADMIN` para ese tenant.
2. **Sin contraseña inicial visible** — El sistema no le pide ni le muestra una contraseña en texto plano al Platform Admin; el usuario la define él mismo al activarse.
3. **Email único por tenant** — El sistema rechaza el alta si ya existe un usuario con ese email en ese mismo tenant, con un mensaje de error claro (mismo criterio de unicidad que hoy: `(tenant_id, email)`).
4. **Invitación por activación** — Al crear el usuario, se envía un correo con un enlace de activación (mismo patrón que `ProfessionalActivationToken`/`ActivatePage`) donde el usuario define su contraseña por primera vez.
5. **Estado antes de activar** — El usuario creado no puede iniciar sesión hasta completar la activación.
6. **Confirmación** — El Platform Admin ve una confirmación de que la invitación fue enviada.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-37 (el tenant debe existir).
- **Pruebas sugeridas:** alta exitosa y envío de invitación, email duplicado en el mismo tenant rechazado, mismo email en tenants distintos permitido, intento de login antes de activar rechazado.
