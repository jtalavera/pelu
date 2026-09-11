# HU-47 · Resolución de flags en 3 niveles: global → tier del tenant → override del tenant

| Campo      | Valor                                       |
| ---------- | ---------------------------------------------|
| **ID**     | HU-47                                        |
| **Módulo** | Plataforma · Tiers y Feature Flags           |
| **Estado** | `Done`                                       |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Resolución de flags en 3 niveles: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** que el valor efectivo de una feature flag para un tenant se resuelva combinando el default global, el default de su tier y su override puntual,
**para** poder gestionar funcionalidades de forma escalable sin configurar tenant por tenant.

---

## Criterios de aceptación

> **Revisión 2026-09-09:** la resolución pasa de *precedencia* a *conjunción (AND)*. Ver la nota de implementación al final.

1. **Resolución conjuntiva** — Para un tenant y una flag dados, el valor efectivo es `global AND tier AND tenant`: la flag está activa solo si está activa en el default global, en el valor del tier del tenant (si tiene tier) y en el valor propio del tenant. Un OFF en cualquier nivel apaga el efectivo. Una fila ausente en el nivel tier o tenant significa "heredar" (ON).
2. **Tenant sin tier** — Defensivo: `tenants.tier_id` es obligatorio desde `V54`, pero un tenant sin tier resuelve con el término tier en ON (solo cuentan global y tenant).
3. **Consistencia con el mecanismo existente** — La resolución sigue siendo la que consume `GET /api/feature-flags` (vista de cualquier usuario autenticado sobre su propio tenant); ese endpoint no cambia su contrato, solo el cálculo interno.
4. **Visibilidad para Platform Admin** — La pantalla de administración de flags de un tenant (HU-49) muestra los 3 valores (global, tier, tenant) y el efectivo; cuando el efectivo es OFF, indica en qué nivel(es) está apagado. El modal del tier (HU-46) muestra el valor global, el del tier y el efectivo a nivel tier.
5. **Migración sin cambio de comportamiento efectivo** — La migración `V53` preserva el valor efectivo actual de cada tenant (incluye invertir el default global de `SIFEN_ELECTRONIC_INVOICING` a ON e insertar filas OFF a nivel tenant donde corresponde).

---

## Notas para estimación y pruebas

- **Dependencias:** HU-45, HU-46 (tiers y su asociación con flags), HU-48 (asignación de tier a tenant), HU-49 (flags existentes).
- **Pruebas sugeridas:** resolución con solo default global; con tier sin override; con tier y override puntual; con tenant sin tier; cambio de tier reflejado sin perder el override existente.

## Nota de implementación (2026-08-21)

`FeatureFlagService#isEnabled`/`resolveAll`/`listTenantView` ahora resuelven en 3 niveles:
override puntual (`TenantFeatureFlag`) > default del tier del tenant (`TierFeatureFlag`, solo si el
tenant tiene un tier asignado y ese tier define la flag) > default global (`FeatureFlag`). `GET
/api/feature-flags` no cambió de contrato (AC-3): sigue devolviendo `{ flags: { KEY: boolean } }`,
solo cambió el cálculo interno de `resolveAll`.

Se agregó `FeatureFlagSource` (`GLOBAL`/`TIER`/`OVERRIDE`) y se extendió
`TenantFeatureFlagRowResponse` con `hasTier`/`tierEnabled`/`effectiveEnabled`/`effectiveSource`
(AC-4): la pantalla de administración de flags de un tenant (`/platform/feature-flags`) ahora
muestra un tercer nivel "Tier default" y una insignia explícita de origen ("From global
default"/"From tier default"/"From organization override") junto al valor efectivo.

Con esta historia se cierra también la nota pendiente de HU-46 (AC-4 "efecto inmediato para
tenants sin override"): incluir una flag en el paquete de un tier cambia inmediatamente el valor
resuelto de cualquier tenant de ese tier sin override propio, sin ningún write a nivel de tenant —
cubierto por `e2e/tests/hu-47-resolucion-de-flags-en-tres-niveles.spec.ts`.

Cobertura de pruebas: unit tests en `FeatureFlagServiceTest` (los 3 niveles, precedencia,
tenant sin tier, tier sin opinión sobre una flag, fuente efectiva en `listTenantView`) y Playwright
en `e2e/tests/hu-47-resolucion-de-flags-en-tres-niveles.spec.ts` (AC-1 a AC-4 vía API y UI; AC-5
cubierto junto con AC-2 contra el tenant DEMO sin tier).

## Nota de implementación (2026-09-09) — resolución conjuntiva (AND)

Se reemplazó la precedencia "override > tier > global" por una **conjunción**: el valor efectivo es
`globalEnabled && tierValue && tenantValue`, donde `tierValue`/`tenantValue` valen `true` cuando no
hay fila en ese nivel. Motivación: desde el modal de un tier el Platform Admin solo podía *incluir*
(forzar ON) una flag; no había forma de que un tier **apague** una flag activa a nivel global.

Cambios:
- `FeatureFlagService#isEnabled`/`resolveAll`/`listTenantView` calculan el AND. `listTenantView` ya
  no expone `effectiveSource` (se eliminó el enum `FeatureFlagSource`): la UI deriva "apagado en:
  global/tier/organización" de los booleanos por nivel.
- `TierFeatureFlag.enabled` pasa a guardar un booleano real (antes siempre `true`).
  `TierAdminService#setTierFeatureFlagValue` hace upsert del valor; `PUT
  /api/platform/tiers/{id}/feature-flags/{flagKey}` recibe `{ "enabled": boolean }`.
  `TierFeatureFlagRowResponse` agrega `tierEnabled` y `effectiveEnabled` (= global AND tier).
- Migración `V53`: invierte el default global de `SIFEN_ELECTRONIC_INVOICING` a ON, inserta filas
  OFF a nivel tenant para los que hoy no lo resuelven ON, y borra filas `enabled = 1` redundantes.
- `V54` + `Tenant#tier` con `optional=false`: todo tenant tiene tier obligatorio (backfill con
  `Estándar`); el caso "tenant sin tier" queda como código defensivo.
- Docs relacionadas actualizadas: HU-46 (activar/desactivar por tier), HU-49 (el override solo
  restringe), PRD (definición de resolución de flags y de tenant/tier).
