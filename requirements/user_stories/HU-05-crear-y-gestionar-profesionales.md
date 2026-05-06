# HU-05 · Crear y gestionar profesionales


| Campo      | Valor        |
| ---------- | ------------ |
| **ID**     | HU-05        |
| **Módulo** | Agendamiento |
| **Estado** | `Done`    |


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

1. **Alta** — Se puede crear una profesional con: nombre completo, teléfono, email (**único dentro del tenant** si se informa) y foto (opcional).
2. **Horarios** — Se pueden definir los días y horarios de trabajo de cada profesional (modelo explícito: ej. plantilla semanal).
3. **Edición y desactivación** — Se puede editar o desactivar una profesional sin perder historial asociado a turnos pasados.
4. **Listado con estado** — La lista muestra el estado de cada profesional (activa / inactiva).
5. **Validaciones de teléfono y email (MVP v2)** — En el formulario de alta y edición, los criterios detallados de máscara de teléfono `(0XXX) XXX-XXX` (ítem 7 de HU-20) y validación estándar de email (ítem 8 de HU-20) son obligatorios.
6. **Acciones por fila vía menú kebab (MVP v2)** — Las acciones de la lista (editar datos y foto, editar horarios, activar / desactivar) se exponen exclusivamente desde un **menú kebab** de tres puntos verticales en cada fila, según HU-20 criterio 9. No quedan botones inline para esas acciones.
7. **Selección de días en horario semanal (MVP v2)** — La solapa *Horario* permite seleccionar los días de atención mediante checkboxes; los campos *Desde* / *Hasta* son obligatorios solo para los días marcados (HU-20 criterio 10) y usan el time picker de HU-20 criterio 6.

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/professionals` — `ProfessionalsPage` (detalle, horarios, foto).
- **API:** `/api/professionals` y subrutas (activar/desactivar, horarios).
- **E2E:** `e2e/tests/hu-05-crear-y-gestionar-profesionales.spec.ts`.

---

## Notas para estimación y pruebas

- **Pruebas:** horarios que afecten disponibilidad en HU-07, desactivación impide asignación en nuevos turnos, historial intacto.

