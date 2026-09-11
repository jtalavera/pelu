# HU-43 · Desactivar / reactivar un usuario de un tenant

| Campo      | Valor                                                    |
| ---------- | ----------------------------------------------------------|
| **ID**     | HU-43                                                     |
| **Módulo** | Plataforma · Gestión de usuarios y admins de tenant       |
| **Estado** | `Backlog`                                                 |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** desactivar o reactivar el acceso de un usuario específico de un tenant,
**para** revocar el acceso de una persona puntual sin afectar al resto de los admins del mismo negocio.

---

## Criterios de aceptación

1. **Acción de desactivación** — Desde el listado de usuarios de un tenant (HU-42), el Platform Admin puede desactivar un usuario puntual.
2. **Bloqueo de login individual** — Un usuario desactivado no puede iniciar sesión; los demás usuarios del mismo tenant no se ven afectados.
3. **Reactivación** — El Platform Admin puede reactivar a un usuario previamente desactivado, restableciendo su acceso.
4. **Sesión activa** — Si el usuario desactivado tiene una sesión abierta, esta se invalida en la siguiente petición.
5. **Datos intactos** — Desactivar un usuario no borra su historial de acciones ni reasigna sus datos a otro usuario.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-41, HU-42.
- **Pruebas sugeridas:** desactivación bloquea login sin afectar a otros admins del tenant, reactivación restablece acceso, sesión activa invalidada tras la desactivación.
