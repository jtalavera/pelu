# HU-38 · Editar datos de un tenant

| Campo      | Valor                                 |
| ---------- | --------------------------------------|
| **ID**     | HU-38                                 |
| **Módulo** | Plataforma · Gestión de Tenants       |
| **Estado** | `Backlog`                             |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma (Tier, resolución de flags): [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** editar el nombre, dominio y tier de un tenant existente,
**para** corregir datos o cambiar su paquete de funcionalidades sin tener que recrearlo.

---

## Criterios de aceptación

1. **Formulario de edición** — El Platform Admin puede abrir un tenant existente y modificar nombre, dominio y tier.
2. **Mismas validaciones que el alta** — Nombre obligatorio, dominio único (excluyendo al propio tenant que se edita).
3. **Cambio de tier con efecto inmediato** — Al guardar un cambio de tier, la resolución de feature flags de ese tenant (HU-47) refleja el nuevo tier inmediatamente, sin reiniciar el sistema.
4. **Overrides de tenant no se pierden** — Cambiar el tier no borra los overrides puntuales de feature flags que el tenant ya tuviera.
5. **Persistencia** — Los cambios persisten tras recargar la página.
6. **Auditoría** — Queda registro de quién cambió qué y cuándo, al menos para el cambio de tier.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-37 (crear tenant), HU-45 (tiers), HU-47 (resolución de flags).
- **Pruebas sugeridas:** edición exitosa de cada campo, dominio duplicado rechazado, cambio de tier refleja nuevos flags sin perder overrides existentes.
