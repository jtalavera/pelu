# HU-37 · Crear tenant

| Campo      | Valor                                 |
| ---------- | --------------------------------------|
| **ID**     | HU-37                                 |
| **Módulo** | Plataforma · Gestión de Tenants       |
| **Estado** | `Backlog`                             |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma (Platform Admin, Tier): [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** dar de alta un nuevo tenant con su nombre, dominio y tier inicial,
**para** comenzar a operar un nuevo negocio en la plataforma.

---

## Criterios de aceptación

1. **Formulario de alta** — El Platform Admin accede a un formulario para crear un tenant con los campos: nombre (obligatorio), dominio (opcional, único en toda la plataforma) y tier inicial (obligatorio, seleccionado de los tiers existentes — ver HU-45).
2. **Validación de nombre** — El sistema rechaza un nombre vacío, mostrando un mensaje de error claro.
3. **Validación de dominio único** — Si se ingresa un dominio ya usado por otro tenant, el sistema lo rechaza con un mensaje de error claro.
4. **Estado inicial** — Todo tenant creado queda en estado `Activo`.
5. **Sin datos de negocio** — Crear un tenant no crea servicios, clientes ni profesionales; esos se cargan después vía importación Excel (HU-51 a HU-53) o manualmente por el tenant admin.
6. **Confirmación** — Al crear el tenant exitosamente, el sistema muestra una confirmación y el tenant aparece inmediatamente en el listado (HU-39).
7. **Aislamiento** — El tenant recién creado no tiene visibilidad de datos de ningún otro tenant.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-34 (rol Platform Admin), HU-45 (los tiers deben existir para poder seleccionarse).
- **Pruebas sugeridas:** alta exitosa, nombre vacío rechazado, dominio duplicado rechazado, dominio vacío permitido, verificación de aislamiento tras el alta.
