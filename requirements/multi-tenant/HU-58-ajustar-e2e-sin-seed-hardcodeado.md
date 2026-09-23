# HU-58 · Ajustar el entorno e2e para no depender del seed hardcodeado

| Campo      | Valor                                                  |
| ---------- | ---------------------------------------------------------|
| **ID**     | HU-58                                                   |
| **Módulo** | Plataforma · Bootstrap y limpieza de seed                |
| **Estado** | `Backlog`                                               |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). "Sin seed hardcodeado": [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** responsable de calidad,
**quiero** que la suite Playwright arme sus propios tenants, usuarios y catálogo en vez de depender del seed hardcodeado de tenant id=1,
**para** que los tests de multi-tenant sean confiables y no rompan al remover ese seed.

---

## Criterios de aceptación

1. **Sin dependencia del seed retirado** — Ningún test Playwright asume la existencia del tenant id=1, del usuario demo (`isabelzymanscki@gmail.com`) ni del catálogo hardcodeado que HU-56 elimina.
2. **Fixtures explícitos** — Los tests que necesitan un tenant con datos (servicios, clientes, profesionales) lo crean explícitamente al inicio del test o vía un fixture reutilizable, usando los flujos nuevos (creación de tenant, importación Excel) o un mecanismo de test equivalente documentado.
3. **Perfil e2e intacto** — La suite sigue corriendo contra `SPRING_PROFILES_ACTIVE=e2e` (H2 en memoria, email deshabilitado), sin reintroducir dependencia de datos hardcodeados en ese perfil.
4. **Sin falsos negativos masivos** — Tras el ajuste, correr la suite completa no produce fallas nuevas atribuibles a la ausencia del seed retirado.
5. **Tests nuevos cubiertos** — Cada historia de HU-34 a HU-57 que introduce un flujo de usuario final (crear tenant, crear admin, importar Excel, suspender tenant, etc.) tiene su propio test Playwright, según la regla general del proyecto de que toda historia de usuario debe estar cubierta por un test automatizado.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-56, HU-57, y todas las historias de UI de las épicas A a E (cada una aporta su propio test).
- **Pruebas sugeridas:** correr la suite completa en un ambiente sin el seed legado y verificar que pasa; revisar que ningún spec existente referencia datos del seed retirado.
