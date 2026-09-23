# HU-36 · Migrar el SYSTEM_ADMIN existente a Platform Admin tenant-independiente

| Campo      | Valor                                       |
| ---------- | -------------------------------------------- |
| **ID**     | HU-36                                        |
| **Módulo** | Plataforma · Identidad de Platform Admin     |
| **Estado** | `Backlog`                                    |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** responsable técnico,
**quiero** migrar el usuario `SYSTEM_ADMIN` legado (`root@pelu`, ligado a tenant 1) al nuevo modelo tenant-independiente,
**para** no perder el acceso administrativo existente ni mantener dos modelos de administración en paralelo.

---

## Criterios de aceptación

1. **Migración de datos** — Una migración de base de datos convierte el usuario `SYSTEM_ADMIN` existente en un `PLATFORM_ADMIN` sin tenant asociado, preservando su email y contraseña.
2. **Sin duplicados** — No queda ningún usuario con rol `SYSTEM_ADMIN` tras la migración; el rol se retira del enum o se marca explícitamente como obsoleto según lo que exija la compatibilidad de datos históricos.
3. **Bypass legado retirado** — El mecanismo de bypass de `TenantPathAccess` basado en `SYSTEM_ADMIN` se retira; el nuevo `PLATFORM_ADMIN` accede a datos de tenants solo a través de las rutas de plataforma explícitas, no reutilizando rutas tenant-scoped con bypass.
4. **Continuidad de acceso** — El usuario migrado puede iniciar sesión con las mismas credenciales después de la migración, sin necesidad de reseteo de contraseña.
5. **Config de bootstrap actualizada** — `FemmeSystemAdminProperties` (o su equivalente) deja de requerir un `tenantId` por defecto.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-34 (rol Platform Admin debe existir).
- **Pruebas sugeridas:** correr la migración sobre una base con el seed legado y verificar el estado resultante; login post-migración con las mismas credenciales; verificación de que las rutas tenant-scoped ya no aceptan el bypass legado.
