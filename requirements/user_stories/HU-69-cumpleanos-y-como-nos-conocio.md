# HU-69 · Cumpleaños y "cómo nos conoció"

| Campo      | Valor          |
| ---------- | -------------- |
| **ID**     | HU-69          |
| **Módulo** | Cliente básico |
| **Estado** | `Backlog`      |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador del negocio,
**quiero** registrar el cumpleaños de mis clientes y recibir avisos en el sistema cuando cumplen años,
**para** saludarlas y fidelizarlas.

**Como** administrador del negocio,
**quiero** registrar cómo nos conoció cada cliente,
**para** saber qué canales me traen clientes.

---

## Criterios de aceptación

### Fecha de cumpleaños

1. **Campo** — En el alta (HU-10) y en la edición de la ficha (HU-12) hay un campo opcional **Cumpleaños** con día y mes obligatorios entre sí y **año opcional** (muchas clientes no quieren decir la edad).
2. **Validación** — Se rechazan fechas inexistentes (ej.: 31/04) y años futuros. El error indica la regla y un ejemplo ("Ingresá una fecha válida, ej.: 15/08 o 15/08/1990"). Backend: 400 `INVALID_BIRTHDAY`.
3. **29 de febrero** — Se acepta 29/02; en años no bisiestos esa cliente se considera de cumpleaños el 28/02.
4. **Visualización en la ficha** — La ficha muestra el cumpleaños (y la edad, si tiene año). El día de su cumpleaños, el encabezado de la ficha muestra la etiqueta **"🎂 Hoy cumple años"**.

### Alertas de cumpleaños

5. **Dashboard** — El dashboard principal (HU-03) muestra una tarjeta **Cumpleaños** con las clientes activas que cumplen años **hoy** (nombre y teléfono, con enlace a la ficha) y, debajo, las que cumplen en los **próximos 7 días** (nombre y fecha). Sin cumpleaños: "No hay cumpleaños en los próximos 7 días".
6. **Calendario** — En el calendario, los turnos de una cliente cuyo cumpleaños coincide con el día del turno muestran un ícono 🎂 con texto accesible "Cumpleaños de la cliente". Lo ven tanto el administrador como la profesional (no revela la fecha de nacimiento ni la edad).
7. **Solo activas** — Las clientes inactivas no aparecen en la tarjeta del dashboard.
8. **"Hoy"** — "Hoy" y "próximos 7 días" se calculan con la zona horaria del servidor.

### Cómo nos conoció

9. **Campo** — En el alta y en la edición hay un campo opcional **¿Cómo nos conoció?** con opciones fijas: Instagram, Facebook, TikTok, Google, Recomendación de otra cliente, Pasó por el local, Otro.
10. **Otro** — Al elegir "Otro" aparece un campo de texto opcional de hasta 100 caracteres para detallar.
11. **Visualización** — La ficha muestra el valor elegido (y el detalle si es "Otro"). Las opciones están traducidas (es/en).

### Privacidad

12. **Profesional** — Cumpleaños y "cómo nos conoció" son datos personales: la profesional no los ve (HU-68, criterio 8), salvo el ícono 🎂 del calendario.
13. **Aislamiento** — Las alertas del dashboard solo incluyen clientes del tenant actual.

---

## Notas para estimación y pruebas

- **Migración:** `birthday_day TINYINT`, `birthday_month TINYINT`, `birthday_year SMALLINT NULL`, `acquisition_channel VARCHAR(30) NULL`, `acquisition_channel_other NVARCHAR(100) NULL` en `client`. Día y mes separados (en vez de `DATE`) permiten año opcional y consultar "cumple hoy" sin funciones de fecha.
- **API:** extender `POST/PUT /api/clients` y `GET /api/clients/{id}`; agregar `birthdays` a `GET /api/dashboard`; agregar `clientBirthdayToday` (o similar) a la respuesta de turnos.
- **E2E:** `e2e/tests/hu-69-cumpleanos-y-como-nos-conocio.spec.ts` — alta con y sin año; fecha inválida; 29/02; etiqueta en ficha; tarjeta del dashboard (hoy / próximos 7 días / vacío / inactiva excluida); ícono en calendario (admin y profesional); "Otro" con detalle; aislamiento multi-tenant. Para "hoy" en E2E, crear clientes con cumpleaños relativo a la fecha actual del servidor.
