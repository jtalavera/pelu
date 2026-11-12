# HU-66 · Ingreso con PIN en un dispositivo compartido

| Campo      | Valor                    |
| ---------- | ------------------------ |
| **ID**     | HU-66                    |
| **Módulo** | Gestión de profesionales |
| **Estado** | `Ready`                  |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** profesional del negocio,
**quiero** identificarme con mi PIN en el dispositivo compartido del salón (tablet o computadora de recepción),
**para** ver mi agenda y agendar turnos rápidamente, sin escribir email y contraseña cada vez que me toca usarlo.

**Como** administrador del negocio,
**quiero** habilitar un dispositivo del salón como "dispositivo compartido",
**para** que varias profesionales lo usen por turnos sin que una pueda actuar en nombre de otra.

---

## Contexto

HU-22 ya permite cargar un PIN numérico (4 a 7 dígitos, único por negocio, guardado hasheado) en la ficha de cada profesional, pero hoy el PIN no se usa para identificarse: la única forma de ingresar es email + contraseña (HU-01 / HU-23). Esta historia completa el propósito de HU-22.

---

## Criterios de aceptación

### Activación del dispositivo compartido

1. **Activar el modo** — Un administrador logueado puede marcar el dispositivo actual como "Dispositivo compartido del salón" desde **Configuración del negocio**. La activación pide confirmar la contraseña del administrador.
2. **Credencial del dispositivo** — Al activarse, el sistema emite una credencial propia del dispositivo, ligada al negocio, que se guarda en ese navegador. La credencial **no** da acceso a ningún dato por sí sola: solo habilita la pantalla de selección de profesional (criterio 4).
3. **Revocación** — En **Configuración del negocio**, el administrador ve el listado de dispositivos compartidos activos del negocio (nombre, fecha de activación, último uso) y puede revocar cualquiera. Un dispositivo revocado vuelve a la pantalla de login normal en su siguiente acción.

### Selección de profesional e ingreso con PIN

4. **Pantalla de selección** — En un dispositivo compartido, la pantalla inicial muestra las profesionales **activas** del negocio que tienen PIN asignado (nombre y foto), sin datos de contacto. Las profesionales inactivas o sin PIN no aparecen.
5. **Teclado de PIN** — Al tocar una profesional se abre un teclado numérico (botones de al menos 44×44 px, usable en tablet y celular). Los dígitos se muestran enmascarados (`••••`).
6. **Ingreso exitoso** — Con el PIN correcto, la profesional entra con una sesión propia y ve **solo el calendario**, con los mismos permisos sobre turnos que una profesional logueada con email y contraseña (HU-24 y su actualización del issue #38): ve todos los turnos, filtra por profesional y solo crea o modifica los propios.
7. **Solo calendario** — En una sesión por PIN no se muestran "Mis comisiones", "Mi perfil" ni ninguna otra opción del menú, y el backend rechaza (403) cualquier endpoint fuera de los del calendario (turnos, profesionales, servicios y clientes en modo lectura), aunque la profesional tenga acceso a ellos con email y contraseña.
8. **PIN incorrecto** — Un PIN incorrecto muestra un error genérico ("PIN incorrecto") sin revelar si la profesional existe o tiene acceso. El error debe incluir cuántos intentos quedan antes del bloqueo.
9. **Identificación en pantalla** — Mientras la sesión por PIN está activa, la barra superior muestra de forma visible el nombre de la profesional y un botón **"Cambiar de profesional"**.

### Seguridad

10. **Límite de intentos** — Tras 5 PINs incorrectos seguidos para una misma profesional en un mismo dispositivo, el ingreso con PIN de esa profesional se bloquea 15 minutos en ese dispositivo. En la pantalla de selección, la profesional bloqueada se muestra como "Bloqueada" con la hora de desbloqueo y no abre el teclado.
11. **Límite por dispositivo** — Además, un dispositivo compartido que acumula 20 PINs incorrectos en 15 minutos (sumando todas las profesionales) bloquea el ingreso con PIN por 15 minutos; la pantalla de selección lo informa con la hora de desbloqueo.

### Desbloqueo por el administrador

12. **Ver bloqueos** — En la ficha de la profesional (sección PIN) el administrador ve si su ingreso con PIN está bloqueado, en qué dispositivo(s) y hasta qué hora. En el listado de dispositivos compartidos (Configuración del negocio) ve si el dispositivo está bloqueado y hasta qué hora.
13. **Desbloquear profesional** — Un botón "Desbloquear PIN" en la ficha de la profesional levanta el bloqueo de inmediato en todos los dispositivos y reinicia el contador de intentos fallidos.
14. **Desbloquear dispositivo** — Un botón "Desbloquear" en el listado de dispositivos compartidos levanta el bloqueo del dispositivo de inmediato y reinicia su contador.
15. **Solo administradores** — Desbloquear está disponible solo para administradores (una profesional, por API o por URL, recibe 403) y cada desbloqueo queda en la auditoría con el administrador que lo hizo.
16. **PIN como credencial** — El PIN se verifica contra un hash fuerte con sal (mismo tratamiento que las contraseñas). El fingerprint actual de HU-22 se mantiene solo para validar unicidad. Las profesionales que ya tienen PIN deben poder usarlo sin que el administrador lo vuelva a cargar, o bien se define un mecanismo de migración documentado.
17. **Alcance de la sesión por PIN** — La sesión obtenida con PIN solo vale en el dispositivo compartido que la emitió, y nunca permite cambiar la contraseña ni el email de la profesional.
18. **Auditoría** — Cada ingreso con PIN (exitoso o fallido), cada bloqueo y cada activación o revocación de dispositivo queda registrado en la auditoría del negocio, indicando dispositivo y profesional.

### Fin de la sesión

19. **Cambiar de profesional** — El botón "Cambiar de profesional" cierra la sesión de la profesional y vuelve a la pantalla de selección, sin cerrar el modo dispositivo compartido.
20. **Cierre por inactividad** — La sesión por PIN se cierra sola tras **5 minutos** sin interacción y vuelve a la pantalla de selección. Formularios abiertos sin guardar se descartan.
21. **Profesional desactivada o sin PIN** — Si el administrador desactiva a la profesional, le borra el PIN o le cambia el PIN, cualquier sesión por PIN abierta de esa profesional deja de funcionar en su siguiente acción.

### Relación con el acceso por email y contraseña

22. **Independencia del acceso al sistema** — Para ingresar con PIN alcanza con tener PIN asignado y estar activa; **no** se requiere tener habilitado "Acceso al sistema" (HU-23) ni email.
23. **Login normal intacto** — En un dispositivo compartido, la pantalla de selección ofrece también "Ingresar con email y contraseña" para administradores; un administrador que ingresa así lo hace con su sesión normal.

---

## Decisiones

- **PIN sin "Acceso al sistema":** alcanza con tener PIN y estar activa (criterio 22).
- **Tiempos:** 5 minutos de inactividad; bloqueo de 15 minutos tras 5 intentos por profesional o 20 por dispositivo. El administrador puede desbloquear antes (criterios 12–15).
- **Activación:** desde Configuración del negocio (criterios 1 y 3).
- **Alcance:** en el dispositivo compartido la profesional ve solo el calendario (criterios 6 y 7).

---

## Notas para estimación y pruebas

- **Dependencias:** HU-22 (PIN), HU-23 / issue #38 (acceso al sistema), HU-24 (vista y permisos de la profesional), auditoría (issue #284).
- **Backend:** credencial de dispositivo compartido (alta, listado, revocación), endpoint de ingreso con PIN con límite de intentos, hash fuerte del PIN, invalidación de sesiones al desactivar o cambiar PIN, eventos de auditoría.
- **Frontend:** pantalla de selección de profesional (con estado "Bloqueada"), teclado de PIN responsive (celular y tablet), barra con "Cambiar de profesional" y sin otras opciones de menú, cierre por inactividad de 5 minutos, gestión de dispositivos (activar, revocar, desbloquear) en Configuración del negocio, estado y botón "Desbloquear PIN" en la ficha de la profesional.
- **Pruebas sugeridas (Playwright, celular y tablet):** activar modo con contraseña del admin → pantalla de selección; solo aparecen profesionales activas con PIN; PIN correcto → calendario propio con permisos de HU-24; PIN incorrecto → error genérico y contador de intentos; 5 fallos → bloqueo 15 min ("Bloqueada" en la selección); el admin ve el bloqueo en la ficha y lo levanta con "Desbloquear PIN"; 20 fallos por dispositivo → bloqueo del dispositivo y desbloqueo desde Configuración; una profesional no puede desbloquear (403); sesión por PIN ve solo el calendario y el backend rechaza "Mis comisiones" y "Mi perfil"; "Cambiar de profesional" vuelve a la selección; inactividad 5 min → vuelve a la selección; desactivar profesional o cambiar su PIN corta la sesión abierta; revocar el dispositivo lo devuelve al login; la sesión por PIN no sirve fuera del dispositivo ni para cambiar contraseña o email; eventos visibles en la auditoría.
