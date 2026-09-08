# HU-48 · Asignar / cambiar el Tier de un tenant

| Campo      | Valor                                       |
| ---------- | ---------------------------------------------|
| **ID**     | HU-48                                        |
| **Módulo** | Plataforma · Tiers y Feature Flags           |
| **Estado** | `Done`                                       |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definición de Tier: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** asignar o cambiar el tier de un tenant desde su edición,
**para** controlar qué paquete de funcionalidades tiene disponible.

---

## Criterios de aceptación

1. **Selector de tier** — El formulario de edición de tenant (HU-38) incluye un selector con todos los tiers existentes.
2. **Tier obligatorio** — Todo tenant tiene siempre un tier asignado; no existe el estado "sin tier" para un tenant activo. El tier inicial se define al crear el tenant (HU-37).
3. **Cambio con efecto inmediato** — Cambiar el tier de un tenant actualiza inmediatamente la resolución de sus feature flags (HU-47), sin reiniciar el sistema.
4. **Auditoría** — Queda registro de cuándo y por quién se cambió el tier de un tenant, y de qué tier a qué tier.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-37 (crear tenant), HU-38 (editar tenant), HU-45 (tiers), HU-47 (resolución de flags). Esta historia formaliza el campo tier ya referenciado en HU-37/HU-38; se mantiene separada para poder estimar y probar el efecto en la resolución de flags de forma aislada.
- **Pruebas sugeridas:** cambio de tier refleja nuevas flags, historial de cambios de tier visible.
