# HU-56 · Remover la reconciliación CSV hardcodeada de FemmeDataInitializer (tenant id=1)

| Campo      | Valor                                                  |
| ---------- | ---------------------------------------------------------|
| **ID**     | HU-56                                                   |
| **Módulo** | Plataforma · Bootstrap y limpieza de seed                |
| **Estado** | `Backlog`                                               |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). "Sin seed hardcodeado": [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** responsable técnico,
**quiero** eliminar la lógica de `FemmeDataInitializer` que reconcilia servicios y clientes hardcodeados contra el tenant id=1,
**para** que el arranque del sistema no dependa de datos específicos de un tenant particular.

---

## Criterios de aceptación

1. **Reconciliación removida** — El código que inserta/elimina categorías de servicio, servicios y clientes contra los CSVs (`servicios_peluqueria_normalizado.csv`, `clientes_filtrado_v2.csv`) para el tenant id=1 se elimina de `FemmeDataInitializer`.
2. **Roster fijo de profesionales removido** — El seed del roster fijo de profesionales (`FemmeSalonCatalogBootstrapData.PROFESSIONALS`) se elimina.
3. **CSVs retirados del repo** — Los archivos CSV usados exclusivamente por esta reconciliación se eliminan del repositorio si no tienen otro uso (p. ej. fixtures de test).
4. **Sin regresión en configuración de plataforma** — El seed de feature flags (`GUIDED_TOUR`, `SIFEN_ELECTRONIC_INVOICING`) y de impuestos IVA por defecto, que no son específicos de un tenant, se conserva, ya que es configuración de plataforma y no datos de negocio de un tenant.
5. **Arranque limpio** — Con la bandera de inicialización habilitada, el arranque del sistema ya no crea, actualiza ni borra clientes ni servicios de ningún tenant específico.
6. **Migraciones tenant-1-específicas documentadas** — Se documenta (no necesariamente se revierte) cualquier migración Flyway existente que hardcodee datos de tenant id=1 (p. ej. `V31__enable_sifen_electronic_invoicing_tenant1.sql`), dejando explícito que no se agregan nuevas migraciones de este tipo en adelante.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-57 (el reemplazo debe existir antes de retirar el seed anterior, para no dejar el arranque sin ningún tenant utilizable en desarrollo).
- **Pruebas sugeridas:** arranque limpio no crea ni borra clientes ni servicios de ningún tenant; flags y taxes de plataforma se siguen sembrando; revisión de que no queda referencia a los CSVs retirados.
