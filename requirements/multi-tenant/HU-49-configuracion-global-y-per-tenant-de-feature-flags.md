# HU-49 · Configuración global y per-tenant de feature flags

| Campo      | Valor                                       |
| ---------- | ---------------------------------------------|
| **ID**     | HU-49                                        |
| **Módulo** | Plataforma · Tiers y Feature Flags           |
| **Estado** | `Done`                                       |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

> Esta historia documenta funcionalidad **ya implementada** antes de existir este programa de requisitos, para que quede trazada junto con HU-45 a HU-48 (que la extienden con el concepto de Tier).

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Resolución de flags: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** activar o desactivar una feature flag de forma global o para un tenant específico,
**para** controlar el despliegue gradual de funcionalidades.

---

## Criterios de aceptación

1. **Default global** — El Platform Admin puede ver y modificar el valor por defecto (habilitado/deshabilitado) de cada feature flag a nivel plataforma.
2. **Override por tenant** — El Platform Admin puede ver el valor efectivo de cada flag para un tenant específico (usando el mecanismo de "tenant en previsualización") y definir un override puntual que prevalece sobre el default global.
3. **Reset a global** — El Platform Admin puede eliminar el override de un tenant para que la flag vuelva a resolver por el default global (o, tras HU-47, por el default de su tier).
4. **Historial de cambios** — Cada cambio de override por tenant queda registrado con el valor anterior, el nuevo valor, quién lo hizo y cuándo.
5. **Vista de solo lectura para el resto de roles** — Cualquier usuario autenticado puede consultar el valor efectivo de las flags de su propio tenant, pero no modificarlas.
6. **Claves de flag validadas** — El sistema solo acepta claves de flag con el formato `MAYUSCULAS_CON_GUION_BAJO`.

---

## Implementación actual (código)

- Backend: `FeatureFlagController` (`GET/PUT /api/admin/feature-flags`, `GET/PUT/DELETE /api/admin/feature-flags/tenants/{tenantId}/{flagKey}`), `FeatureFlagService` (resolución "override si existe, si no default global"), entidades `FeatureFlag` / `TenantFeatureFlag` / `TenantFeatureFlagChange` (auditoría separada de la fila de override).
- Frontend: `FeatureFlagsPage.tsx` — toggles de "Global Default" y "This Tenant" por flag, botón "Reset to Global" y texto de último cambio; usa `me.previewTenantId` para elegir el tenant en previsualización.

## Notas para estimación y pruebas

- **Dependencias:** ninguna — ya implementado.
- **Pruebas sugeridas:** ya cubiertas por la suite existente relacionada a `feature-flags` en `e2e/`; HU-46/HU-47 agregan casos nuevos para la capa de tier sobre esta base.
