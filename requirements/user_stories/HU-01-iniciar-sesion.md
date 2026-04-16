# HU-01 · Iniciar sesión en el sistema


| Campo      | Valor                                 |
| ---------- | ------------------------------------- |
| **ID**     | HU-01                                 |
| **Módulo** | Autenticación & configuración inicial |
| **Estado** | `Done`                             |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** iniciar sesión con mi email y contraseña,  
**para** acceder de forma segura al panel de gestión de Femme.

---

## Criterios de aceptación

Cada criterio es verificable mediante prueba manual o automatizada (UI, API o ambos).

1. **Formulario de login** — El sistema muestra un formulario con campos de email y contraseña (y acciones asociadas según diseño).
2. **Credenciales incorrectas** — Si el login falla, se muestra un mensaje de error claro que no revela si falló el email o la contraseña.
3. **Login exitoso** — Tras credenciales válidas, el usuario es redirigido al dashboard principal (o ruta home acordada).
4. **Sesión por inactividad (8 h)** — Tras el login, la sesión permanece válida mientras haya actividad; tras **8 horas sin actividad**, el usuario es redirigido al login (o equivalente que impida usar el panel sin reautenticar).
5. **Recuperación de contraseña** — Existe la opción “olvidé mi contraseña” que dispara el envío de un enlace de recuperación al email indicado (flujo completo verificable: solicitud → email o mock en entorno de prueba).

---

## Implementación actual (código, 2026-04)

- **Frontend:** `LoginPage` (`/login`), `ForgotPasswordPage` (`/forgot-password`); JWT almacenado en `sessionStorage` (`accessToken`).
- **API:** `POST /api/auth/login`, `POST /api/auth/forgot-password`, reset vía `POST /api/auth/reset-password` (en desarrollo el enlace se loguea, no hay envío SMTP en MVP).
- **Sesión:** TTL del access token `app.femme.jwt.access-token-ttl-seconds` (por defecto 28800 s = 8 h), alineado al criterio de inactividad.
- **Usuario demo:** `admin@demo.com` / `Demo123!` (`FemmeDataInitializer`, no aplica al perfil `test`).
- **E2E:** `e2e/tests/hu-01-iniciar-sesion.spec.ts`.

---

## Notas para estimación y pruebas

- **Independiente:** puede entregarse antes que otras historias si existe un shell de app y rutas protegidas.
- **Pruebas sugeridas:** casos felices, credenciales inválidas, expiración de sesión (o token), flujo de recuperación (incl. email inválido si aplica).