# Femme — Gestión multi-tenant · Platform Admin (v1)

> **Alcance:** Identidad de Platform Admin, gestión de tenants, gestión de
> usuarios/admins de tenant, tiers y feature flags, importación de datos
> base vía Excel, y eliminación del seed hardcodeado específico de tenant
> id=1.
> **Rol nuevo en esta etapa:** Platform Admin (tenant-independiente),
> además de los roles existentes de [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md)
> (Admin/tenant admin, Profesional).
> **Formato:** Como [rol], quiero [acción], para [beneficio].
> **Criterios de aceptación** listados por historia, en archivos individuales
> `HU-NN-slug.md` dentro de esta misma carpeta.

Este documento no reemplaza al [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md);
lo extiende. Las historias de este alcance continúan la numeración global de
`HU-NN` (a partir de HU-34) pero se archivan en `requirements/multi-tenant/`
por tratarse de un programa separado (gestión de la plataforma, no del
negocio de un tenant).

---

## Definiciones transversales (multi-tenant / plataforma)

| Tema | Decisión |
|------|----------|
| **Platform Admin** | Rol **tenant-independiente**: no pertenece a ningún tenant (`AppUser.tenant` es nulo para este rol). Su JWT no lleva `tid`. Opera sobre `/platform/*`, un área separada del panel de negocio de cada tenant. No reemplaza al `SYSTEM_ADMIN` legado descrito en el PRD MVP: HU-34/HU-36 migran ese modelo al nuevo. |
| **Tenant admin** | Sigue siendo el "Administrador" descrito en el PRD MVP: un `AppUser` con rol `ADMIN`, ligado a un único tenant. Un tenant puede tener **uno o más** admins (HU-42); todos los admins asignados a un tenant tienen los mismos permisos sobre ese tenant. |
| **Tier** | Agrupación que el Platform Admin define y administra (HU-45), usada para dar de alta un **paquete por defecto de feature flags** a los tenants que la tienen asignada (HU-46/HU-47). No implica facturación ni pricing en este alcance — es puramente un mecanismo de habilitación de funcionalidades. |
| **Resolución de feature flags** | Tres niveles, de menor a mayor prioridad: **default global** → **default del tier** del tenant (si tiene uno asignado) → **override puntual del tenant** (si existe). Extiende el mecanismo de override ya implementado (`FeatureFlag` + `TenantFeatureFlag`, ver HU-49) sin reemplazarlo. |
| **Formato estándar de Excel** | Cada entidad importable (servicios, clientes, profesionales) tiene una única plantilla de columnas fija, documentada en HU-50, con columnas obligatorias y opcionales explícitas y validación fila por fila. |
| **Alcance de la importación** | Solo el Platform Admin puede importar datos para un tenant, y únicamente como parte del alta/onboarding de ese tenant (HU-50 a HU-55). No es autoservicio para el tenant admin en este alcance. |
| **Sin seed hardcodeado** | Ningún tenant, usuario, servicio, cliente o profesional se crea automáticamente al arrancar el sistema, salvo el primer Platform Admin (bootstrap, HU-57). Todo lo demás se crea vía UI/API del Platform Admin (tenants, admins) o vía importación Excel (catálogo inicial). |
| **Moneda** | Los montos (precio de servicio) se muestran en Guaraníes con separador de miles por punto y sin decimales (p. ej. `150.000`), igual que el resto de la aplicación. |
| **Paginación** | Todo listado nuevo (tenants, usuarios) ofrece 10/25/50 filas por página (default 10), server-side, con los componentes `Pagination` + `PageSizeSelect` del design system. |
| **Multi-tenant (heredado)** | Se mantiene la definición del PRD MVP: cada tenant está completamente aislado de los demás; ningún dato de negocio cruza tenants. El Platform Admin es la única excepción explícita y auditable a esa regla. |

---

## Épicas

| Épica | Historias | Resumen |
|---|---|---|
| **A — Identidad de Platform Admin** | HU-34, HU-35, HU-36 | Rol tenant-independiente, login con enrutamiento por rol, migración del `SYSTEM_ADMIN` legado. |
| **B — Gestión de Tenants** | HU-37, HU-38, HU-39, HU-40 | Alta, edición, listado/búsqueda y suspensión/reactivación de tenants. |
| **C — Gestión de usuarios y admins de tenant** | HU-41, HU-42, HU-43, HU-44 | Alta de usuarios, asignación de uno o más admins por tenant, desactivación, reenvío de invitación. |
| **D — Tiers y Feature Flags** | HU-45, HU-46, HU-47, HU-48, HU-49 | Tiers, asociación tier↔flags, resolución en 3 niveles, asignación de tier a tenant, documentación de la configuración de flags ya existente. |
| **E — Importación de datos vía Excel** | HU-50, HU-51, HU-52, HU-53, HU-54, HU-55 | Formato estándar y flujo de importación de servicios, clientes y profesionales. |
| **F — Bootstrap y eliminación de seed hardcodeado** | HU-56, HU-57, HU-58 | Remoción del seed específico de tenant id=1, bootstrap limpio del primer Platform Admin, ajuste del entorno e2e. |

---

## Consideraciones generales de este alcance

| Tema | Decisión |
|---|---|
| Estado de tenant | Un tenant puede estar `Activo` o `Suspendido`. Suspendido bloquea el login de todos los usuarios de ese tenant, pero no borra sus datos. |
| Eliminación de datos | Igual que en el resto del producto: ningún tenant, usuario o registro importado se elimina; solo se desactiva/suspende. |
| Auditoría | Cambios de tier, de flags y de estado de tenant quedan registrados con quién y cuándo, siguiendo el mismo patrón que `TenantFeatureFlagChange`. |
| Importación | Es transaccional por archivo: si una fila falla, las filas válidas igual se importan; el reporte (HU-54) detalla fila por fila qué se importó y qué no. |

---

## Estado de implementación

> Mantenido por el loop de implementación (`/loop` + skill `implement-user-story`), trabajando directamente sobre la rama `feat/multi_tenant`, en el orden en que aparecen las épicas arriba. Se actualiza HU por HU a medida que se completan (implementación + tests automatizados + CI en verde + commit/push).

| HU | Título | Estado |
|---|---|---|
| HU-34 | Rol Platform Admin tenant-independiente | Done |
| HU-35 | Login unificado, enrutamiento por rol | Done |
| HU-36 | Migrar SYSTEM_ADMIN a Platform Admin | Done |
| HU-37 | Crear tenant | Done |
| HU-38 | Editar tenant | Done |
| HU-39 | Listado y búsqueda de tenants | Done |
| HU-40 | Suspender/reactivar tenant | Done |
| HU-41 | Crear usuario admin de tenant | Done |
| HU-42 | Asignar múltiples admins a un tenant | Done |
| HU-43 | Desactivar/reactivar usuario de tenant | Done |
| HU-44 | Reenviar invitación admin de tenant | Done |
| HU-45 | Crear y administrar tiers | Done |
| HU-46 | Asociar feature flags a un tier | Done |
| HU-47 | Resolución de flags en tres niveles | Done |
| HU-48 | Asignar tier a tenant | Done (implementada en HU-37/HU-38: selector de tier, obligatoriedad, efecto inmediato en HU-47 y auditoría vía `TenantTierChange`; HU-48 formalizó y sumó cobertura Playwright dedicada, `e2e/tests/hu-48-asignar-tier-a-tenant.spec.ts`) |
| HU-49 | Configuración global y per-tenant de feature flags | Done (funcionalidad preexistente, documentada retroactivamente) |
| HU-50 | Formato estándar de planillas Excel | Pendiente |
| HU-51 | Importar servicios desde Excel | Pendiente |
| HU-52 | Importar clientes desde Excel | Pendiente |
| HU-53 | Importar profesionales desde Excel | Pendiente |
| HU-54 | Reporte de resultados de importación | Pendiente |
| HU-55 | Descargar planillas de ejemplo | Pendiente |
| HU-56 | Remover seed hardcodeado tenant 1 | Pendiente |
| HU-57 | Bootstrap inicial de Platform Admin | Pendiente |
| HU-58 | Ajustar e2e sin seed hardcodeado | Pendiente |

---

*Femme SaaS · Gestión multi-tenant · Platform Admin · v1*
