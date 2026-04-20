# HU-23 · Acceso al sistema para profesionales

| Campo      | Valor                    |
| ---------- | ------------------------ |
| **ID**     | HU-23                    |
| **Módulo** | Gestión de profesionales |
| **Estado** | `Backlog`                |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador del negocio (tenant admin),  
**quiero** habilitar o deshabilitar el acceso al sistema para cada profesional,  
**para** que las profesionales autorizadas puedan iniciar sesión y gestionar su propia agenda.

---

## Criterios de aceptación

### Campo de acceso en el formulario

1. **Campo "Acceso al sistema"** — El formulario de edición de profesional incluye un control de tipo toggle o checkbox con dos estados: "Permitir acceso" y "Denegar acceso". El valor por defecto al crear una profesional es "Denegar acceso".
2. **Persistencia del estado** — El estado del campo se guarda correctamente y se refleja al reabrir el formulario de la profesional.

### Flujo "Permitir acceso"

3. **Validación de email obligatorio** — Al cambiar el estado a "Permitir acceso" e intentar guardar, si la profesional no tiene email configurado, el sistema muestra un mensaje de error claro y **no** habilita el acceso.
4. **Envío de email de activación** — Si la profesional tiene email configurado, el sistema envía un email a esa dirección con un link de activación único. El link incluye un token firmado que permite al sistema identificar al usuario y verificar la validez del link.
5. **Token de activación seguro** — El token del link tiene un tiempo de expiración (ej. 48 horas). El sistema rechaza tokens expirados o inválidos.
6. **Vínculo token–profesional** — El sistema valida que el token del link corresponda exactamente a la profesional a la que fue emitido. Un token no puede usarse para activar otra cuenta.
7. **Formulario de creación de contraseña** — Al acceder al link válido, el sistema muestra un formulario con dos campos: "Contraseña" y "Confirmar contraseña".
8. **Reglas de seguridad de contraseña** — La contraseña debe cumplir al menos las siguientes condiciones (aplicadas con validación en frontend y backend):
   - Mínimo 8 caracteres.
   - Al menos una letra mayúscula.
   - Al menos una letra minúscula.
   - Al menos un dígito.
   - Al menos un carácter especial (ej. `!@#$%^&*`).
9. **Confirmación de contraseña** — Si los campos "Contraseña" y "Confirmar contraseña" no coinciden, el sistema muestra un error y no crea el usuario.
10. **Creación de usuario** — Tras completar correctamente el formulario, el sistema crea un registro de usuario con el email de la profesional como `username` y la contraseña hasheada. El registro de profesional queda vinculado a este usuario.
11. **Tabla unificada de usuarios** — Todos los usuarios del sistema (admins, profesionales, etc.) se almacenan en la misma tabla de usuarios. La tabla de profesionales contiene una referencia (FK) al usuario asociado.
12. **Link de un solo uso** — Una vez usado el link para crear la contraseña, el token queda invalidado. Intentar usarlo nuevamente muestra un mensaje de error apropiado.
13. **Reenvío de link** — Si el administrador vuelve a guardar el estado "Permitir acceso" sobre una profesional que ya tiene acceso o cuyo link expiró, el sistema genera un nuevo token e invalida el anterior, reenviando el email.

### Flujo "Denegar acceso"

14. **Revocación de acceso** — Al cambiar el estado a "Denegar acceso" y guardar, el usuario asociado queda deshabilitado. Cualquier sesión activa de esa profesional es invalidada o no puede renovarse.
15. **Acceso denegado en login** — Una profesional con acceso denegado que intente iniciar sesión recibe el mensaje de error estándar de credenciales inválidas (sin revelar que la cuenta está deshabilitada).

---

## Notas para estimación y pruebas

- **Dependencias:** HU-01 (autenticación), HU-05 (formulario de profesionales).
- **Relacionada con:** HU-24 (vista del profesional logueado).
- **Pruebas sugeridas:** habilitar acceso con email → email enviado; habilitar sin email → error; link válido → formulario de contraseña; link expirado → error; contraseña débil → error; contraseñas no coinciden → error; activación exitosa → usuario puede loguearse; revocar acceso → login falla; link reutilizado → error; reenvío de link invalida el anterior.
