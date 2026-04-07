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
**para** que aparezcan correctamente en los comprobantes fiscales y en el sistema.

---

## Criterios de aceptación

1. **Pantalla de configuración** — Existe una pantalla “Configuración del negocio” accesible desde el menú (solo rol Admin en MVP). Los datos corresponden al **tenant** actual (este negocio en el modelo multi-tenant).
2. **Campos editables** — Se pueden cargar y guardar: nombre del negocio, RUC, dirección, teléfono, email de contacto y logo (imagen).
3. **Validación RUC paraguayo** — El campo RUC acepta el formato paraguayo (ej. `80012345-6`) y valida el dígito verificador; entradas inválidas no se guardan o se rechazan con mensaje claro.
4. **RUC obligatorio para facturar** — Si el RUC no está cargado, al intentar emitir una factura el sistema advierte o bloquea según regla de negocio definida (comportamiento observable y consistente).
5. **Comprobantes PDF** — Los datos guardados (incluido RUC) aparecen en el encabezado de los comprobantes PDF generados por el sistema.
6. **Guardado explícito** — Los cambios se persisten solo al usar un botón de guardar explícito; no hay autoguardado al escribir en los campos.

---

## Notas para estimación y pruebas

- Depende de almacenamiento de logo y de pipeline de PDF (puede enlazarse con HU-14 cuando exista).
- **Pruebas:** validación RUC (válidos/inválidos), guardado, lectura en PDF, intento de facturación sin RUC.
- **UX:** los errores de validación en pantalla se muestran en rojo (color destructivo) con texto que indica el formato requerido (p. ej. RUC); ver `AGENTS.md` · *Form validation (frontend)* y `FieldValidationError` en el frontend.