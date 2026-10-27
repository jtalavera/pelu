# HU-71 · Skin por tenant (acento de marca según el tipo de salón)

| Campo      | Valor                                 |
| ---------- | --------------------------------------|
| **ID**     | HU-71                                 |
| **Módulo** | Plataforma · Gestión de Tenants       |
| **Estado** | `In Progress`                         |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Definiciones específicas de plataforma: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

**Marca (Flowbit).** El manual de marca define una variación por tipo de negocio dentro de la app ("Variación en Interfaces"): *un logo, un acento por tipo de negocio*. Solo cambian el color del peine y del punto de la "i" del logo y los detalles de acento; el resto de la interfaz mantiene la paleta principal (teal, tinta noche, lino).

| Skin       | Acento    | Tipo de salón sugerido |
| ---------- | --------- | ---------------------- |
| `DURAZNO`  | `#F3C6AE` | Spa (por defecto)      |
| `CELESTE`  | `#C9D9E6` | Barbería               |
| `ROSA`     | `#F1AFC2` | Peluquería             |

El tipo de salón es solo una sugerencia: el Platform Admin puede asignar cualquier skin a cualquier tenant.

---

## Historia de usuario

**Como** Platform Admin,
**quiero** elegir el skin de cada tenant según su tipo de salón,
**para** que su equipo vea la interfaz de Flowbit con el acento que corresponde a su negocio.

---

## Criterios de aceptación

1. **Entrada "Skin" en el administrador** — La navegación de la plataforma incluye la opción **Skin**, que abre `/platform/skin`.
2. **Todas las variaciones a la vista** — La página muestra una previsualización de cada variación (Durazno, Celeste, Rosa) con su acento, el logo y el tipo de salón sugerido, incluso antes de elegir un tenant. Mientras no hay tenant elegido no se puede seleccionar ni guardar.
3. **Elegir y guardar** — El Platform Admin busca un tenant, ve su skin actual, elige otra variación y guarda. Aparece un mensaje de éxito y el skin actual pasa a ser el nuevo (también tras recargar).
4. **Valor por defecto** — Todo tenant nuevo y todo tenant existente tiene el skin `DURAZNO` hasta que se cambie.
5. **El tenant ve su skin** — Al abrir la app, los usuarios del tenant ven el logo con el peine y el punto de la "i" en el acento de su skin (`/api/me` expone `skin`).
6. **Validación** — Un skin inexistente o vacío se rechaza con el código `TENANT_SKIN_INVALID` (HTTP 400, traducido en la UI); un tenant inexistente responde `TENANT_NOT_FOUND`; solo el Platform Admin puede cambiar el skin.
7. **Aislamiento entre tenants** — Cambiar el skin de un tenant no modifica el de otro.
8. **Tema claro/oscuro y celular** — El acento se aplica igual en tema claro y oscuro y la pantalla se ve en celular sin scroll horizontal.
9. **Zona de plataforma y pantallas previas al login** — La zona de plataforma y las pantallas previas al login (login, recuperar contraseña) no llevan skin: usan siempre el acento por defecto.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-37 (crear tenant), HU-38 (editar tenant). Endpoint: `PUT /api/platform/tenants/{id}/skin`.
- **Fuera de alcance:** un skin que cambie el color primario o la paleta completa; conocer el tenant antes del login (el login siempre usa el acento por defecto); KuDE, PDFs y emails.
- **Pruebas sugeridas:** guardar cada skin y ver `data-skin` y el color del peine en la app del tenant; skin inválido; aislamiento entre tenants (mt-isolation); claro/oscuro y móvil.
