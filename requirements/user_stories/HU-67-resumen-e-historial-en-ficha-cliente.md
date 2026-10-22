# HU-67 · Resumen e historial en la ficha de la cliente

| Campo      | Valor          |
| ---------- | -------------- |
| **ID**     | HU-67          |
| **Módulo** | Cliente básico |
| **Estado** | `In Progress`  |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador del negocio,
**quiero** ver en la ficha de una cliente un resumen de su relación con el salón (estilista habitual, últimos servicios y últimos productos comprados),
**para** atenderla mejor y conocer sus hábitos sin revisar comprobantes uno por uno.

---

## Contexto

Hoy la ficha (`/app/clients/:id`, HU-12) muestra datos básicos, turnos y comprobantes. La información de servicios y productos ya existe en los registros de servicio (`ServiceRecord` / `ServiceRecordLine`, con profesional y servicio por línea): esta historia **no agrega datos nuevos a cargar**, solo los resume.

**Definición de "servicio realizado":** una línea de un registro de servicio en estado `CLOSED` cuyo ítem es de tipo `SERVICE`. Los registros `OPEN` o `VOIDED` no cuentan.
**Definición de "producto comprado":** igual, pero con ítem de tipo `PRODUCT`.
**Ventana de 12 meses:** desde el mismo día de 12 meses atrás hasta hoy (inclusive), según la zona horaria del servidor.

---

## Criterios de aceptación

### Bloque "Resumen"

1. **Ubicación** — En la ficha de la cliente, sobre las pestañas existentes, se muestra un bloque **Resumen**, visible en ambos temas (claro/oscuro) y en celular.
2. **Estilista habitual** — El resumen muestra la o las profesionales que más servicios realizados le hicieron en los últimos 12 meses, con la cantidad de servicios de cada una (ej.: "Ana · 7 servicios").
3. **Empate** — Si dos o más profesionales empatan en la mayor cantidad, se muestran todas, ordenadas alfabéticamente.
4. **Sin datos** — Si la cliente no tiene servicios realizados en los últimos 12 meses, se muestra "Sin servicios en los últimos 12 meses" en lugar del nombre.
5. **Profesional inactiva** — Una profesional inactiva igual cuenta y se muestra, con la etiqueta "(inactiva)".
6. **Última visita** — El resumen muestra la fecha del último servicio realizado (sin límite de ventana) o "Sin visitas" si no tiene ninguno.
7. **Gasto y ticket promedio** — El resumen muestra el total gastado en los últimos 12 meses (suma de registros `CLOSED`, servicios + productos) y el ticket promedio (total / cantidad de registros `CLOSED` en la ventana), en guaraníes con el formato de moneda del sistema. Sin registros: "—".

### Últimos servicios

8. **Listado** — Se muestran los **5 últimos servicios realizados** (sin límite de ventana), del más reciente al más antiguo, con: fecha, servicio, profesional y precio.
9. **Vacío** — Sin servicios realizados, se muestra "Todavía no tiene servicios realizados".

### Últimos productos comprados

10. **Listado** — Se muestran los **5 últimos productos comprados** (sin límite de ventana), del más reciente al más antiguo, con: fecha, producto, cantidad y precio unitario.
11. **Vacío** — Sin productos comprados, se muestra "Todavía no compró productos".

### Reglas generales

12. **Anulaciones** — Los registros de servicio abiertos (`OPEN`) o anulados (`VOIDED`) no aparecen en el resumen ni en los listados, y no cuentan para la estilista habitual, el gasto ni el ticket promedio. (Hoy solo se puede anular un registro abierto; anular el comprobante no reabre ni anula el registro, que sigue contando porque el servicio se realizó.)
13. **Aislamiento** — El resumen solo considera registros del tenant actual; pedir el resumen de una cliente de otro tenant responde 404.
14. **Acceso** — El resumen solo es visible para el administrador (el rol profesional no accede a la ficha completa; ver HU-68).

---

## Notas para estimación y pruebas

- **API sugerida:** `GET /api/clients/{id}/summary` → `{ usualProfessionals: [{id, name, active, serviceCount}], lastVisitAt, spentLast12Months, averageTicketLast12Months, lastServices: [...], lastProducts: [...] }`. Un solo endpoint para no multiplicar llamadas desde la ficha.
- Sin migración de base de datos (solo consultas).
- **Soporte E2E:** `POST /api/admin/service-record-test-support/{id}/backdate/{daysAgo}` (solo perfil `e2e`) para sembrar servicios fuera de la ventana de 12 meses.
- **E2E:** `e2e/tests/hu-67-resumen-ficha-cliente.spec.ts` — cliente sin historial; cliente con una profesional habitual clara; empate; servicio fuera de la ventana de 12 meses (no cuenta para habitual pero sí para últimos servicios); registro anulado excluido; productos; aislamiento multi-tenant (agregar caso a `tests/mt-isolation/`).
