# HU-46 · Asociar feature flags a un Tier

| Campo      | Valor                                       |
| ---------- | ---------------------------------------------|
| **ID**     | HU-46                                        |
| **Módulo** | Plataforma · Tiers y Feature Flags           |
| **Estado** | `Backlog`                                    |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definición de Tier y resolución de flags: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** definir qué feature flags están habilitadas por defecto para cada tier,
**para** que dar de alta un tenant en un tier active automáticamente el paquete de funcionalidades correspondiente.

---

## Criterios de aceptación

1. **Matriz de flags por tier** — Desde el detalle de un tier, el Platform Admin ve todas las feature flags existentes y puede marcar cuáles están incluidas (habilitadas) en ese tier.
2. **Persistencia** — Los cambios en la asociación tier↔flag se guardan y persisten tras recargar la página.
3. **Sin afectar overrides existentes** — Cambiar qué flags incluye un tier no modifica los overrides puntuales que ya tengan los tenants de ese tier.
4. **Efecto inmediato para tenants sin override** — Un tenant en ese tier que no tenga un override puntual para una flag ve reflejado el cambio del tier inmediatamente.
5. **Auditoría** — Queda registro de qué flags se agregaron o quitaron de un tier, cuándo y por quién.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-45 (tiers), HU-49 (deben existir flags para asociar).
- **Pruebas sugeridas:** activar/desactivar una flag en un tier y verificar el efecto en un tenant de ese tier sin override; verificar que un tenant con override puntual no cambia.
