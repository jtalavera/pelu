# HU-24 · Vista del profesional logueado

| Campo      | Valor                  |
| ---------- | ---------------------- |
| **ID**     | HU-24                  |
| **Módulo** | Agendamiento           |
| **Estado** | `Backlog`              |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** profesional del negocio,  
**quiero** iniciar sesión y ver mi propio calendario de turnos,  
**para** gestionar mi agenda y agendar nuevos turnos para mis clientes sin acceder a la información de otras profesionales.

---

## Criterios de aceptación

### Acceso y sesión

1. **Login con credenciales de profesional** — Una profesional con acceso habilitado puede iniciar sesión con su email y contraseña a través del formulario estándar de login (HU-01).
2. **Rol detectado automáticamente** — El sistema detecta que el usuario autenticado es una profesional y aplica la vista y permisos correspondientes sin requerir acción adicional del usuario.

### Calendario

3. **Calendario visible** — Tras iniciar sesión, la profesional accede al calendario de turnos.
4. **Solo su propia agenda** — El calendario muestra únicamente los turnos asignados a la profesional logueada. No se muestran turnos de otras profesionales.
5. **Sin filtro manual de profesional** — El selector o filtro de profesional no está disponible para el rol profesional (o está fijo en su propia identidad y no puede modificarse).
6. **Navegación temporal completa** — La profesional puede navegar entre días, semanas y meses en el calendario para ver sus turnos pasados y futuros.

### Agendamiento de turnos

7. **Puede agendar turnos** — La profesional puede crear nuevos turnos desde el calendario o desde el flujo estándar de agendamiento (HU-07).
8. **Solo para sí misma** — Al agendar un turno, el campo "Profesional" está fijado al usuario logueado y no puede modificarse. No es posible asignar un turno a otra profesional.
9. **Selección de cliente y servicio libre** — La profesional puede seleccionar cualquier cliente y cualquier servicio disponible del tenant al agendar un turno.
10. **No puede reasignar turnos** — Al editar un turno propio, la profesional no puede cambiar el campo "Profesional" a otra persona.

### Restricciones de acceso

11. **Sin acceso a turnos de otras profesionales** — Intentar acceder directamente (por URL u otro medio) a un turno perteneciente a otra profesional resulta en un error de acceso denegado (403 o equivalente).
12. **Sin acceso a gestión de profesionales** — La profesional no tiene acceso al módulo de gestión de profesionales (ABM de profesionales, asignación de PINs, habilitación de acceso).
13. **Sin acceso a configuración del negocio** — La profesional no tiene acceso a la configuración del tenant (HU-02), caja (HU-13/18), comprobantes (HU-14), ni otros módulos administrativos.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-01 (login), HU-06 (calendario), HU-07 (agendar turno), HU-23 (habilitación de acceso profesional).
- **Pruebas sugeridas:** login como profesional → calendario propio visible; turnos de otras profesionales no visibles; campo profesional fijo al agendar; intento de asignar turno a otra profesional → rechazado; acceso por URL a turno ajeno → 403; acceso a módulos admin → denegado.
