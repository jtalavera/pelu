# HU-35 · Login unificado con enrutamiento por rol

| Campo      | Valor                                       |
| ---------- | -------------------------------------------- |
| **ID**     | HU-35                                        |
| **Módulo** | Plataforma · Identidad de Platform Admin     |
| **Estado** | `Backlog`                                    |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** usuario del sistema (Platform Admin, tenant admin o profesional),
**quiero** iniciar sesión desde una única pantalla de login,
**para** que el sistema me lleve automáticamente al área que corresponde a mi rol.

---

## Criterios de aceptación

1. **Login único** — Existe una sola pantalla de login para todos los roles; no hay una URL de login separada para Platform Admin.
2. **Enrutamiento por rol** — Tras un login exitoso, un Platform Admin es redirigido al área de plataforma (`/platform`); un tenant admin o profesional es redirigido al panel de su tenant, igual que hoy.
3. **Sin selector manual** — El usuario no elige su "tipo de acceso"; el enrutamiento se basa exclusivamente en el rol devuelto por el backend.
4. **Protección de rutas** — Las rutas de plataforma solo son accesibles para `PLATFORM_ADMIN`; cualquier otro rol que intente acceder directamente por URL es redirigido fuera.
5. **Sesión** — El mismo mecanismo de expiración por inactividad definido en el PRD MVP aplica también a la sesión de Platform Admin.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-34 (rol Platform Admin), HU-01 (login existente).
- **Pruebas sugeridas:** login con cada rol y verificación del destino de redirección; acceso directo por URL a `/platform` sin ser Platform Admin; expiración de sesión por inactividad para un Platform Admin.
