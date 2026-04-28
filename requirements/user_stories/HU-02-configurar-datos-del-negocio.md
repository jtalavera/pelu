# HU-02 · Configurar datos del negocio


| Campo      | Valor                                 |
| ---------- | ------------------------------------- |
| **ID**     | HU-02                                 |
| **Módulo** | Autenticación & configuración inicial |
| **Estado** | `Done`                                |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** cargar el nombre, logo, dirección, teléfono y RUC de la peluquería,  
**para** que esa información sea la fuente de verdad del negocio dentro del sistema (perfil tenant).

---

## Criterios de aceptación

1. **Pantalla de configuración** — Existe una pantalla “Configuración del negocio” accesible desde el menú (solo rol Admin en MVP). Los datos corresponden al **tenant** actual (este negocio en el modelo multi-tenant).
2. **Campos editables** — Se pueden cargar y guardar: nombre del negocio, RUC, dirección, teléfono, email de contacto y logo (imagen).
3. **Validación RUC paraguayo** — El campo RUC acepta el formato con dígitos, guion y dígitos (ej. `80012345-6`); entradas que no cumplan el formato no se guardan o se rechazan con mensaje claro en rojo.
4. **Guardado explícito** — Los cambios se persisten solo al usar un botón de guardar explícito; no hay autoguardado al escribir en los campos.

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/settings/business` (layout `SettingsLayout`).
- **Frontend:** `BusinessSettingsPage`; validación de RUC paraguayo y logo (data URL).
- **API:** perfil de negocio vía endpoints bajo `/api/business-profile` (según controladores existentes).
- **E2E:** `e2e/tests/hu-02-configurar-datos-del-negocio.spec.ts`.

---

## Notas para estimación y pruebas

- **Pruebas:** validación RUC (válidos/inválidos), guardado y persistencia al recargar.
- Uso de estos datos en comprobantes y reglas de emisión se cubre en **HU-14** (no duplicar criterios aquí).
- **UX:** los errores de validación en pantalla se muestran en rojo (color destructivo) con texto que indica el formato requerido (p. ej. RUC); ver `AGENTS.md` · *Form validation (frontend)* y `FieldValidationError` en el frontend.

