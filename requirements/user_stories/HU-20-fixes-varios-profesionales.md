# HU-20 · Fixes varios del módulo de profesionales

| Campo | Valor |
|--------|--------|
| **ID** | HU-20 |
| **Módulo** | Agendamiento |
| **Estado** | `Backlog` |

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

---

## Notas para estimación y pruebas

- **Contexto:** complementa HU-05; alinear criterios con almacenamiento de foto en backend y límites de request si la imagen se envía por API.
- **Pruebas:** archivo con extensión renombrada incorrectamente; imagen justo en 5 MB y justo por encima; imagen 500×500 y 501×500; formatos web comunes aceptados; time picker en distintos días de la semana y bordes (medianoche, fin de día); accesibilidad y teclado del time picker.
