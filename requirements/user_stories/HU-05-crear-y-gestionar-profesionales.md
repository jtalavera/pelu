# HU-05 · Crear y gestionar profesionales

| Campo | Valor |
|--------|--------|
| **ID** | HU-05 |
| **Módulo** | Agendamiento |
| **Estado** | `Backlog` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** registrar a las profesionales del salón con su nombre y datos de contacto,  
**para** asignarlas a los turnos y calcular sus comisiones en el futuro.

---

## Criterios de aceptación

1. **Alta** — Se puede crear una profesional con: nombre completo, teléfono, email y foto (opcional).
2. **Horarios** — Se pueden definir los días y horarios de trabajo de cada profesional (modelo explícito: ej. plantilla semanal).
3. **Edición y desactivación** — Se puede editar o desactivar una profesional sin perder historial asociado a turnos pasados.
4. **Listado con estado** — La lista muestra el estado de cada profesional (activa / inactiva).

---

## Notas para estimación y pruebas

- **Pruebas:** horarios que afecten disponibilidad en HU-07, desactivación impide asignación en nuevos turnos, historial intacto.
