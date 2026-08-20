# HU-34 · Definir rol Platform Admin tenant-independiente

| Campo      | Valor                                       |
| ---------- | -------------------------------------------- |
| **ID**     | HU-34                                        |
| **Módulo** | Plataforma · Identidad de Platform Admin     |
| **Estado** | `Backlog`                                    |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol nuevo definido en esta historia. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma (Platform Admin, Tier, formato Excel): [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** responsable de la operación de la plataforma,
**quiero** que exista un rol Platform Admin que no dependa de ningún tenant,
**para** poder administrar todos los tenants sin estar atado a los datos de uno en particular.

---

## Criterios de aceptación

1. **Rol dedicado** — Existe un rol `PLATFORM_ADMIN` distinto de `SYSTEM_ADMIN`, `ADMIN` y `PROFESSIONAL`.
2. **Sin tenant asociado** — Un usuario con rol `PLATFORM_ADMIN` puede crearse sin tenant asignado (`tenant` nulo); el sistema no exige tenant para este rol.
3. **JWT sin tid** — El token emitido a un Platform Admin no incluye el claim `tid`; el backend lo acepta como válido para rutas de plataforma.
4. **Endpoints de tenant siguen exigiendo tid** — Ningún endpoint tenant-scoped existente cambia su comportamiento: siguen rechazando tokens sin `tid`.
5. **Acceso exclusivo a rutas de plataforma** — Un Platform Admin no puede acceder a datos de negocio de ningún tenant a través de las rutas tenant-scoped existentes, ni siquiera con un bypass; solo a través de las nuevas rutas de plataforma explícitas.
6. **Un solo lugar de verdad para el rol** — El enum de roles y las validaciones de autorización reflejan el nuevo rol de forma consistente en backend y frontend.

---

## Notas para estimación y pruebas

- **Dependencias:** Ninguna — historia base del programa multi-tenant.
- **Pruebas sugeridas:** login como Platform Admin con un token sin `tid`; intento de acceso a un endpoint tenant-scoped rechazado; creación de un `AppUser` sin tenant asociado; verificación de que un endpoint tenant-scoped sigue rechazando tokens sin `tid` para cualquier otro rol.
