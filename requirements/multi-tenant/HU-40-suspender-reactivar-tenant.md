# HU-40 · Suspender / reactivar un tenant

| Campo      | Valor                                 |
| ---------- | --------------------------------------|
| **ID**     | HU-40                                 |
| **Módulo** | Plataforma · Gestión de Tenants       |
| **Estado** | `Backlog`                             |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma (estado de tenant): [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#consideraciones-generales-de-este-alcance).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** suspender o reactivar el acceso de un tenant,
**para** bloquear temporalmente a un negocio sin borrar su información.

---

## Criterios de aceptación

1. **Acción de suspensión** — Desde el detalle del tenant, el Platform Admin puede cambiar su estado a `Suspendido`.
2. **Bloqueo de login** — Ningún usuario (admin ni profesional) de un tenant suspendido puede iniciar sesión mientras dure la suspensión; el mensaje de error no distingue "tenant suspendido" de "credenciales inválidas" de forma que ayude a un intento de enumeración.
3. **Sesiones activas** — Las sesiones ya iniciadas de usuarios de un tenant recién suspendido se invalidan en la siguiente petición, no se mantienen indefinidamente activas.
4. **Reactivación** — El Platform Admin puede volver el estado a `Activo`, restableciendo el acceso inmediatamente.
5. **Datos intactos** — Suspender un tenant no borra ni modifica sus datos de negocio (clientes, servicios, profesionales, comprobantes).
6. **Visibilidad del estado** — El estado (Activo/Suspendido) es visible en el listado (HU-39) y en el detalle del tenant.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-37, HU-38, HU-39.
- **Pruebas sugeridas:** suspensión bloquea login inmediatamente, reactivación restablece acceso, datos de negocio no se alteran, sesión activa se invalida tras la suspensión.
