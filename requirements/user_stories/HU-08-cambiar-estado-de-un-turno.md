# HU-08 · Cambiar el estado de un turno

| Campo | Valor |
|--------|--------|
| **ID** | HU-08 |
| **Módulo** | Agendamiento |
| **Estado** | `Backlog` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** actualizar el estado de un turno,  
**para** reflejar si la cliente confirmó, llegó, no asistió o se canceló.

---

## Criterios de aceptación

1. **Estados permitidos** — Los estados disponibles son: Pendiente, Confirmado, En curso, Completado, Cancelado, No asistió.
2. **Cambio desde detalle** — El estado se puede cambiar desde la vista de detalle del turno.
3. **Cancelación** — Al marcar “Cancelado”, el sistema solicita una razón (opcional) antes o al guardar.
4. **Completado visible** — Los turnos “Completado” se diferencian visualmente en el calendario (color o ícono).
5. **Sin eliminación física** — No existe eliminación dura del turno; solo transiciones de estado (p. ej. cancelado), manteniendo historial.

---

## Notas para estimación y pruebas

- **Pruebas:** transiciones válidas/ inválidas si hay reglas, cancelación con y sin razón, contraste visual de Completado, auditoría de que el registro persiste.
