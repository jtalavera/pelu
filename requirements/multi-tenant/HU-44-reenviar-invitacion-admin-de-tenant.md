# HU-44 · Reenviar invitación / reseteo de contraseña para un admin de tenant

| Campo      | Valor                                                    |
| ---------- | ----------------------------------------------------------|
| **ID**     | HU-44                                                     |
| **Módulo** | Plataforma · Gestión de usuarios y admins de tenant       |
| **Estado** | `Backlog`                                                 |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** reenviar la invitación de activación o disparar un reseteo de contraseña para un admin de tenant,
**para** resolver casos donde el correo original no llegó o el usuario perdió su contraseña.

---

## Criterios de aceptación

1. **Reenvío de invitación** — Si un usuario nunca activó su cuenta, el Platform Admin puede reenviar el correo de activación, invalidando el enlace anterior.
2. **Reseteo de contraseña** — Si un usuario ya activó su cuenta pero perdió el acceso, el Platform Admin puede disparar el mismo flujo de "olvidé mi contraseña" (`ForgotPasswordPage`) en su nombre.
3. **Un solo enlace válido** — Al reenviar una invitación o un reseteo, cualquier enlace anterior enviado para ese usuario deja de ser válido.
4. **Confirmación** — El Platform Admin ve una confirmación de que el correo fue reenviado.
5. **Sin exposición de contraseña** — En ningún momento el Platform Admin ve ni define la contraseña del usuario.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-41 (crear usuario admin).
- **Pruebas sugeridas:** reenvío de invitación invalida el enlace previo, reseteo de contraseña para un usuario ya activado, intento de usar un enlace viejo tras el reenvío rechazado.
