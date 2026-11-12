# HU-24 · Vista del profesional logueado

| Campo      | Valor                  |
| ---------- | ---------------------- |
| **ID**     | HU-24                  |
| **Módulo** | Agendamiento           |
| **Estado** | `Done`              |

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
4. **Ve todos los turnos** *(actualizado — issue #38)* — La profesional puede ver los turnos de todas las profesionales del negocio. El calendario abre mostrando su propia agenda.
5. **Filtro por profesional** *(actualizado — issue #38)* — El filtro de profesional está disponible para el rol profesional ("Todas las profesionales" o una en particular), igual que para el administrador.
6. **Navegación temporal completa** — La profesional puede navegar entre días, semanas y meses en el calendario para ver sus turnos pasados y futuros.

### Agendamiento de turnos

7. **Puede agendar turnos** — La profesional puede crear nuevos turnos desde el calendario o desde el flujo estándar de agendamiento (HU-07).
8. **Solo para sí misma** — Al agendar un turno, el campo "Profesional" está fijado al usuario logueado y no puede modificarse. No es posible asignar un turno a otra profesional.
9. **Selección de cliente y servicio libre** — La profesional puede seleccionar cualquier cliente y cualquier servicio disponible del tenant al agendar un turno.
10. **No puede reasignar turnos** — Al editar un turno propio, la profesional no puede cambiar el campo "Profesional" a otra persona.

### Restricciones de acceso

11. **Solo modifica sus propios turnos** *(actualizado — issue #38)* — Los turnos de otras profesionales se ven en modo solo lectura (sin "Editar turno" ni "Cambiar estado"). Cualquier intento de modificarlos por API (editar, tomarlos para sí o cambiar su estado) responde 403 `APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL`.
12. **Sin acceso a gestión de profesionales** — La profesional no tiene acceso al módulo de gestión de profesionales (ABM de profesionales, asignación de PINs, habilitación de acceso).
13. **Sin acceso a configuración del negocio** — La profesional no tiene acceso a la configuración del tenant (HU-02), caja (HU-13/18), comprobantes (HU-14), ni otros módulos administrativos. Se aplica en el menú, en las rutas (una URL de administración redirige a su calendario) y en el backend (política *deny-by-default* para el rol `PROFESSIONAL`: solo calendario, catálogos de lectura, su perfil y sus comisiones; todo lo demás responde 403).
14. **Sin Stock** *(issue #38)* — Por el momento la profesional no ve nada relacionado a Stock (sin botón en el menú; el SSO a Stock responde 403).

---

## Notas para estimación y pruebas

- **Dependencias:** HU-01 (login), HU-06 (calendario), HU-07 (agendar turno), HU-23 (habilitación de acceso profesional).
- **Pruebas sugeridas:** login como profesional → calendario propio visible; turnos de otras profesionales no visibles; campo profesional fijo al agendar; intento de asignar turno a otra profesional → rechazado; acceso por URL a turno ajeno → 403; acceso a módulos admin → denegado.
