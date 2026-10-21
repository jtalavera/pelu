# HU-68 · Notas y fórmula de color de la cliente

| Campo      | Valor          |
| ---------- | -------------- |
| **ID**     | HU-68          |
| **Módulo** | Cliente básico |
| **Estado** | `Backlog`      |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador o profesional del negocio,
**quiero** registrar y consultar notas y la fórmula de color de cada cliente,
**para** repetir el trabajo que le gusta y recordar sus preferencias en cada visita.

---

## Contexto

Se agregan a la cliente dos campos de **texto libre** asociados a la cliente (no a un servicio ni a un turno): **Notas** y **Fórmula de color**. Ambos forman la **"Ficha técnica"** de la cliente.

A diferencia del resto de la ficha, la profesional (HU-24) **sí** puede ver y editar la ficha técnica, pero **no** los datos personales (teléfono, email, documento, RUC, dirección, cumpleaños, etc.).

---

## Criterios de aceptación

### Datos

1. **Campos** — Cada cliente tiene dos campos opcionales de texto libre multilínea: **Notas** y **Fórmula de color**, de hasta 2000 caracteres cada uno. Un contador muestra los caracteres usados.
2. **Una sola nota** — Las notas son un único texto editable (no una bitácora de entradas); guardar reemplaza el contenido anterior.
3. **Validación** — Superar 2000 caracteres muestra un error de campo indicando el límite ("Máximo 2000 caracteres") y no se guarda. El backend responde 400 `CLIENT_NOTES_TOO_LONG` / `CLIENT_COLOR_FORMULA_TOO_LONG`.
4. **Última modificación** — Debajo de cada campo se muestra quién lo modificó por última vez y cuándo (ej.: "Editado por Ana · 21/10/2026 14:32"). Si nunca se editó, no se muestra nada.

### Administrador

5. **Edición en la ficha** — En la ficha de la cliente (`/app/clients/:id`) hay una sección **Ficha técnica** con ambos campos, editable por el administrador, con botones **Guardar** y **Cancelar** propios (independientes del formulario de datos básicos).

### Profesional

6. **Acceso desde el detalle del turno** — Al abrir el detalle de un turno en el calendario, la profesional ve un botón **Ficha técnica** que abre la ficha técnica de la cliente de ese turno, en un panel o modal.
7. **Turnos de otras profesionales** — El botón está disponible también en turnos de otras profesionales (que hoy ve en modo lectura, issue #38): la ficha técnica pertenece a la cliente, no al turno.
8. **Acceso desde el formulario de turno** — Al agendar o editar un turno (HU-07 / HU-09), una vez elegida la cliente aparece un enlace **Ver ficha técnica** que abre el mismo panel sin perder lo cargado en el formulario.
9. **Menú "Clientes" de la profesional** — La profesional logueada con email y contraseña ve en el menú una opción **Clientes** que lleva a un listado restringido: búsqueda por nombre y columna nombre únicamente. Al elegir una cliente se abre su ficha técnica (`/app/clients/:id/technical-sheet`). No hay alta, edición de datos, desactivación ni acceso a la ficha completa (`/app/clients/:id` redirige a la ficha técnica).
10. **Contenido visible** — En la ficha técnica la profesional ve **solo** el nombre de la cliente, las notas y la fórmula de color. No ve teléfono, email, documento, RUC, dirección, cumpleaños, cómo nos conoció, resumen (HU-67), turnos ni comprobantes.
11. **Edición** — La profesional puede editar y guardar las notas y la fórmula de color de cualquier cliente del negocio, desde cualquiera de los accesos anteriores.
12. **Datos personales protegidos (backend)** — Con rol profesional, `GET /api/clients/{id}` y `PUT /api/clients/{id}` siguen respondiendo 403; solo los endpoints de ficha técnica están habilitados para ese rol. El listado `GET /api/clients` que usa la profesional (selector del formulario de turno y menú Clientes) devuelve solo `id` y nombre, sin teléfono, email, documento, RUC, dirección ni cumpleaños.
13. **Sesión por PIN** — En una sesión por PIN en dispositivo compartido (HU-66) la profesional puede ver y editar la ficha técnica desde el detalle del turno y el formulario de turno (criterios 6–8). El menú **Clientes** no se muestra, porque la sesión por PIN sigue siendo solo calendario (HU-66, criterio 7).

### Reglas generales

14. **Aislamiento** — No se puede leer ni editar la ficha técnica de una cliente de otro tenant (404).
15. **Cliente inactiva** — La ficha técnica de una cliente inactiva se puede ver pero no editar (409 `CLIENT_INACTIVE`).

---

## Notas para estimación y pruebas

- **Migración:** columnas `notes NVARCHAR(2000)`, `color_formula NVARCHAR(2000)`, más `notes_updated_at/by`, `color_formula_updated_at/by` en `client` (o tabla `client_technical_sheet` 1:1 si se prefiere separar datos sensibles de datos técnicos).
- **API sugerida:** `GET /api/clients/{id}/technical-sheet` y `PUT /api/clients/{id}/technical-sheet` → `{ clientId, clientName, notes, colorFormula, notesUpdatedAt, notesUpdatedBy, colorFormulaUpdatedAt, colorFormulaUpdatedBy }`. Agregar ambos a `ProfessionalAccessPolicy` (rol profesional y sesión por PIN).
- **E2E:** `e2e/tests/hu-68-notas-y-formula-de-color.spec.ts` — admin edita y ve "Editado por"; límite de 2000 caracteres; profesional abre ficha técnica desde turno propio, turno ajeno, formulario de turno y menú Clientes, edita, y no ve datos personales; listado de clientes como profesional sin teléfono/email/RUC; profesional llamando a `GET /api/clients/{id}` → 403; sesión PIN; cliente inactiva no editable; aislamiento multi-tenant.
