# HU-55 · Descargar planillas de ejemplo por entidad

| Campo      | Valor                                            |
| ---------- | --------------------------------------------------|
| **ID**     | HU-55                                             |
| **Módulo** | Plataforma · Importación de datos vía Excel       |
| **Estado** | `Backlog`                                         |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Formato estándar de importación: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** descargar una planilla de ejemplo ya formateada para cada entidad,
**para** no tener que armar el archivo de importación desde cero.

---

## Criterios de aceptación

1. **Descarga por entidad** — Desde la pantalla de importación, el Platform Admin puede descargar una plantilla `.xlsx` de ejemplo para servicios, para clientes y para profesionales, cada una con los encabezados exactos definidos en HU-50.
2. **Filas de ejemplo** — Cada plantilla incluye 1 o 2 filas de ejemplo con datos ficticios que ilustran el formato esperado, incluyendo el formato de `activo` como `SI`/`NO`.
3. **Encabezados coinciden** — Los encabezados de la plantilla descargada son exactamente los que el importador exige (HU-50, AC 5); no hay divergencia entre lo que se descarga y lo que se valida al subir.
4. **Reutilizable** — El Platform Admin puede borrar las filas de ejemplo y usar el mismo archivo para su importación real.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-50 (formato estándar).
- **Pruebas sugeridas:** descarga de cada plantilla; verificación de que los encabezados descargados son aceptados sin cambios al reimportarlos vacíos (solo encabezados + filas propias).
