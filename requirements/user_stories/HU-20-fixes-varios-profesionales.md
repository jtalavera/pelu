# HU-20 · Fixes varios del módulo de profesionales

| Campo | Valor |
|--------|--------|
| **ID** | HU-20 |
| **Módulo** | Agendamiento |
| **Estado** | `Done` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administradora del negocio,  
**quiero** subir la foto de la profesional con validaciones claras y configurar sus horarios con el mismo selector de hora que en el calendario,  
**para** evitar errores de formato y mantener una experiencia coherente en la aplicación.

---

## Criterios de aceptación

1. **Foto en edición de profesional — selector de archivo** — En el formulario de edición de profesional, el campo *Foto* es un **selector de archivos** (file picker), no un campo de texto libre. El diálogo del sistema propone por defecto solo **imágenes de uso habitual en web** (p. ej. JPEG, PNG, WebP, GIF — lista acotada y documentada en la tarea de implementación), mediante **filtro de extensiones** en el picker (`accept` u equivalente).
2. **Foto — validación de extensión** — Tras la selección, el sistema **valida** que el archivo tenga una extensión permitida; si no, se informa el error sin guardar la imagen.
3. **Foto — peso máximo** — Se valida que el archivo no supere **5 MB**; si lo supera, se rechaza con mensaje claro.
4. **Foto — dimensiones máximas** — Se valida que la imagen no supere **500×500 px** de ancho ni de alto (o ambas dimensiones según regla unificada definida en implementación: típicamente *cada* lado ≤ 500 px). Si no cumple, se rechaza con mensaje claro.
5. **Horario del profesional — selector de hora** — En el formulario donde se configura el **horario semanal** (o equivalente) de la profesional, los campos donde se ingresan **horas de inicio y fin** usan el **mismo componente o patrón de time picker** que el módulo del **calendario** (misma interacción y presentación visual alineada con el diseño del producto y temas claro / oscuro).
6. **Selector de hora editable (MVP v2)** — El time picker mencionado en el criterio 5 se presenta como un **combobox editable** con valores de **00:00 a 23:45 cada 15 minutos** y permite además **escribir libremente** una hora `HH:MM` que no figure en la lista; el componente es exactamente el mismo (mismo patrón y archivo) que se usa en el formulario de nuevo turno del calendario (HU-19, criterio 7).
7. **Teléfono — máscara con prefijo separado (MVP v2)** — En el formulario de creación / edición de profesional, el campo *Teléfono* se formatea automáticamente con una **máscara local de Paraguay** que separa el prefijo del número, en el formato `(0XXX) XXX-XXX`. El usuario solo escribe dígitos; los paréntesis, espacio y guion se insertan automáticamente. El campo solo acepta hasta **10 dígitos** y muestra un mensaje de validación cuando el número está incompleto.
8. **Email — validación de formato estándar (MVP v2)** — En el mismo formulario, el campo *Email* se valida con el **formato estándar de correo electrónico**: debe contener `@` y al menos un carácter visible **antes** de la `@`. Cuando el valor no cumple el patrón, se muestra un mensaje de error claro y se impide guardar el formulario.
9. **Lista de profesionales — menú kebab (MVP v2)** — En la lista de profesionales, el botón *Más* se reemplaza por un **menú de tres puntos verticales** (kebab, estilo Google). Al abrirlo, expone las opciones **Editar datos y foto**, **Editar horarios** y **Desactivar** (o **Activar** según el estado del registro). El botón inline *Desactivar* desaparece de la fila: la acción solo es accesible desde el menú kebab.
10. **Solapa Horario — selección de días de atención (MVP v2)** — En el formulario de profesional, la solapa *Horario* permite **seleccionar los días de atención** mediante checkboxes (uno por día de la semana). Solo para los días marcados se muestran y son **obligatorios** los campos *Desde* y *Hasta*; para los días no seleccionados los campos quedan ocultos / no exigibles. Si no se marca ningún día, la solapa muestra un mensaje de validación y no se permite guardar.

---

## Implementación actual (código, 2026-04)

- **UI:** búsqueda inline y edición en tabla en `ProfessionalsPage`.
- **E2E:** `e2e/tests/hu-20-fixes-varios-profesionales.spec.ts`.

---

## Notas para estimación y pruebas

- **Contexto:** complementa HU-05; alinear criterios con almacenamiento de foto en backend y límites de request si la imagen se envía por API.
- **Pruebas:** archivo con extensión renombrada incorrectamente; imagen justo en 5 MB y justo por encima; imagen 500×500 y 501×500; formatos web comunes aceptados; time picker en distintos días de la semana y bordes (medianoche, fin de día); accesibilidad y teclado del time picker.
