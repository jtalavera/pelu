# HU-54 · Reporte de resultados de importación

| Campo      | Valor                                            |
| ---------- | --------------------------------------------------|
| **ID**     | HU-54                                             |
| **Módulo** | Plataforma · Importación de datos vía Excel       |
| **Estado** | `Backlog`                                         |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Importación transaccional por archivo: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#consideraciones-generales-de-este-alcance).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** ver un reporte claro de qué filas se importaron y cuáles fallaron (y por qué),
**para** poder corregir el archivo y reintentar solo lo que falló.

---

## Criterios de aceptación

1. **Resumen** — Al finalizar cualquier importación (servicios, clientes o profesionales), el sistema muestra cuántas filas se procesaron, cuántas se importaron con éxito y cuántas fallaron.
2. **Detalle por fila fallida** — Para cada fila rechazada, el reporte indica el número de fila del Excel y el motivo específico del rechazo, en el mismo idioma que el resto de la UI.
3. **Importación parcial** — Una importación con filas fallidas igual completa la carga de las filas válidas; el archivo no se rechaza en bloque salvo que falte una columna obligatoria (ver HU-50, AC 5).
4. **Persistencia del reporte** — El reporte de la última importación de cada tenant queda disponible para volver a consultarlo, no solo en el momento de importar.
5. **Aplica a las tres entidades** — El mismo formato de reporte se usa para importación de servicios, clientes y profesionales.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-51, HU-52, HU-53 (una importación de cada entidad).
- **Pruebas sugeridas:** importación 100% exitosa; importación con filas mixtas (éxito y error); importación con archivo inválido (rechazo total, HU-50 AC 5) reflejada también en el reporte; reporte accesible tras salir y volver a entrar.
