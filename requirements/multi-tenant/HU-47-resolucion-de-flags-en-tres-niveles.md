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

1. **Orden de precedencia** — Para un tenant y una flag dados, el valor efectivo se calcula así: si existe un override puntual para ese tenant, se usa ese valor; si no, si el tenant tiene un tier y ese tier define la flag, se usa el valor del tier; si no, se usa el default global.
2. **Tenant sin tier** — Un tenant sin tier asignado se resuelve igual que hoy: default global salvo override puntual.
3. **Consistencia con el mecanismo existente** — La resolución sigue siendo la que consume `GET /api/feature-flags` (vista de cualquier usuario autenticado sobre su propio tenant); ese endpoint no cambia su contrato, solo el cálculo interno.
4. **Visibilidad para Platform Admin** — La pantalla de administración de flags de un tenant (HU-49) muestra explícitamente de qué nivel proviene el valor efectivo actual (global, tier u override).
5. **Sin romper flags existentes** — Los tenants y flags existentes antes de esta historia siguen resolviendo exactamente igual que antes si no tienen tier asignado.

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
