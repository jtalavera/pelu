# HU-09 · Editar o reagendar un turno

| Campo | Valor |
|--------|--------|
| **ID** | HU-09 |
| **Módulo** | Agendamiento |
| **Estado** | `Backlog` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** modificar la fecha, hora o profesional de un turno existente,  
**para** adaptarme a cambios de último momento.

---

## Criterios de aceptación

1. **Campos editables** — Desde el detalle se pueden editar fecha, hora, profesional y servicio cuando aplique la regla de estados.
2. **Revalidación de disponibilidad** — Al cambiar fecha u hora (o profesional), se vuelve a validar disponibilidad; conflicto → error claro, sin guardar cambios inválidos.
3. **Refresco** — El turno actualizado se refleja de inmediato en el calendario.
4. **Restricción por estado** — Solo se pueden editar turnos en estado Pendiente o Confirmado (otros estados bloquean edición o solo permiten acciones definidas).

---

## Notas para estimación y pruebas

- **Pruebas:** edición en Pendiente/Confirmado OK; bloqueo en Completado/Cancelado; reagendar a slot ocupado falla; cambio de profesional libera slot anterior.
