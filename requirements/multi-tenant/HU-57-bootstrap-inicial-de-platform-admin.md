# HU-57 · Bootstrap inicial: crear únicamente el primer Platform Admin

| Campo      | Valor                                                  |
| ---------- | ---------------------------------------------------------|
| **ID**     | HU-57                                                   |
| **Módulo** | Plataforma · Bootstrap y limpieza de seed                |
| **Estado** | `Backlog`                                               |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). "Sin seed hardcodeado": [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** responsable técnico,
**quiero** que el primer arranque del sistema cree únicamente el primer usuario Platform Admin, sin datos de negocio hardcodeados,
**para** poder operar la plataforma desde cero usando el mismo camino que un ambiente productivo.

---

## Criterios de aceptación

1. **Bootstrap mínimo** — Si no existe ningún usuario `PLATFORM_ADMIN` en la base, el arranque crea exactamente uno, con email y contraseña configurables por variables de entorno, sin valores hardcodeados en el código.
2. **Sin tenant de demo** — El bootstrap no crea ningún tenant, ni usuarios `ADMIN`/`PROFESSIONAL`, ni servicios, clientes o profesionales.
3. **Idempotencia** — Si ya existe al menos un `PLATFORM_ADMIN`, el arranque no crea ni modifica ninguno nuevo.
4. **Camino único** — A partir de este Platform Admin inicial, todo tenant, usuario y dato de catálogo se crea exclusivamente a través de la UI/API de plataforma (HU-37 a HU-55); no hay un segundo camino de seed paralelo.
5. **Configuración documentada** — Las variables de entorno necesarias para definir el email/contraseña del primer Platform Admin están documentadas (README o equivalente).

---

## Notas para estimación y pruebas

- **Dependencias:** HU-34 (el rol Platform Admin debe existir), HU-56 (reemplaza al bootstrap anterior).
- **Pruebas sugeridas:** arranque en base vacía crea un único Platform Admin; arranque repetido no duplica; arranque con un Platform Admin ya existente no lo modifica.
