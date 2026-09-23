# HU-53 · Importar profesionales desde Excel

| Campo      | Valor                                            |
| ---------- | --------------------------------------------------|
| **ID**     | HU-53                                             |
| **Módulo** | Plataforma · Importación de datos vía Excel       |
| **Estado** | `Backlog`                                         |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Formato estándar de importación: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** importar el equipo de profesionales de un tenant desde una planilla Excel,
**para** dejar el negocio operativo con su staff inicial cargado.

---

## Criterios de aceptación

1. **Selección de archivo y tenant** — El Platform Admin elige el tenant destino y sube un archivo `.xlsx` con el formato de HU-50.
2. **Nombre obligatorio** — Filas sin `nombre_completo` se rechazan individualmente sin detener la importación del resto.
3. **Sin PIN ni acceso al sistema** — Los profesionales importados se crean sin PIN asignado y sin acceso al sistema habilitado; ambos se configuran manualmente después, igual que en un alta manual (ver HU-22).
4. **Estado activo por defecto** — Un profesional importado sin la columna `activo` completa queda activo por defecto.
5. **Aislamiento** — Los profesionales importados quedan asociados exclusivamente al tenant seleccionado.
6. **Reutiliza validaciones existentes** — El formato de teléfono y email sigue las mismas reglas que el alta manual de profesionales.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-50 (formato estándar), HU-37 (el tenant debe existir).
- **Pruebas sugeridas:** importación exitosa; fila sin nombre rechazada; verificación de que el profesional importado no tiene PIN ni acceso al sistema habilitado; estado activo por defecto.
