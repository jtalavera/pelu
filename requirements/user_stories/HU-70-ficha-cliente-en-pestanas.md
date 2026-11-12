# HU-70 · Ficha de la cliente organizada en pestañas

| Campo      | Valor          |
| ---------- | -------------- |
| **ID**     | HU-70          |
| **Módulo** | Cliente básico |
| **Estado** | `Done`         |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador del negocio,
**quiero** que la ficha de la cliente esté organizada en un encabezado compacto, una franja de indicadores y pestañas,
**para** encontrar rápido lo que busco sin desplazarme por toda la información apilada.

---

## Contexto

Con HU-67/68/69 la ficha (`/app/clients/:id`) acumuló encabezado, resumen con dos tablas, formulario de datos, ficha técnica, turnos y comprobantes, todo uno debajo del otro. Esta historia **no agrega datos nuevos**: reorganiza los existentes. No hay cambios de backend.

---

## Criterios de aceptación

### Encabezado

1. **Encabezado compacto** — Arriba se muestran el nombre y las etiquetas ("Inactiva", "🎂 Hoy cumple años") y, en una sola línea separada por "·", la cantidad de visitas, el cumpleaños con la edad (si se conoce el año) y cómo nos conoció (si están cargados).

### Franja de indicadores

2. **Siempre visible** — Debajo del encabezado y arriba de las pestañas, cuatro indicadores compactos: estilista habitual (últimos 12 meses), última visita, gasto de los últimos 12 meses y ticket promedio. Se ven en todas las pestañas, con los mismos valores y reglas de HU-67.
3. **Responsive** — En pantallas anchas los cuatro indicadores van en una fila; en celular, en una grilla de 2×2, sin desplazamiento horizontal de la página.

### Pestañas

4. **Pestañas y orden** — La ficha tiene cinco pestañas, en este orden: **Datos**, **Resumen**, **Ficha técnica**, **Turnos** y **Comprobantes**.
5. **Pestaña por defecto** — Al abrir la ficha se muestra la pestaña **Datos**.
6. **Datos** — Contiene el formulario de edición de HU-12/HU-69 dividido en tres bloques con título: **Contacto** (nombre, teléfono, email), **Datos fiscales** (tipo y número de documento, tipo de contribuyente, dirección, localidad) y **Perfil** (cumpleaños, cómo nos conoció). Mantiene Guardar, Cancelar y Desactivar/Reactivar con las mismas validaciones.
7. **Resumen** — Contiene los últimos 5 servicios y los últimos 5 productos comprados (HU-67, criterios 8–11).
8. **Ficha técnica** — Contiene las notas y la fórmula de color (HU-68), con su propio Guardar/Cancelar.
9. **Turnos** — Contiene los turnos próximos y los pasados (con paginación).
10. **Comprobantes** — Contiene los comprobantes de la cliente (con paginación y detalle).
11. **Pestaña en la URL** — La pestaña activa queda en la URL (`?tab=summary|sheet|appointments|invoices`; sin parámetro = Datos). Recargar la página, usar *Atrás* o abrir un enlace con `?tab=…` muestra esa pestaña. Un valor desconocido muestra **Datos**.
12. **Celular** — Si las pestañas no entran en el ancho de la pantalla, se desplazan horizontalmente dentro de su barra (la página no se desplaza de costado). Cada pestaña tiene al menos 44 px de alto.
13. **Carga diferida** — Los turnos y comprobantes se piden al backend recién cuando se abre la pestaña **Turnos** o **Comprobantes** (no al abrir la ficha).

### Generales

14. **Temas** — La ficha se ve correctamente en tema claro y oscuro.
15. **Tour guiado** — El tour de la ficha describe las pestañas nuevas.

---

## Notas para estimación y pruebas

- Solo frontend (`ClientDetailPage`, `ClientSummaryCard`). Sin cambios de API.
- **E2E:** `e2e/tests/hu-70-ficha-cliente-en-pestanas.spec.ts` (encabezado, indicadores, orden y contenido de pestañas, pestaña por defecto, URL, celular, carga diferida, tema oscuro). Actualizar los specs que abren la ficha (HU-12, HU-21, HU-67, HU-68, HU-69 y relacionados) para entrar por la pestaña correcta.
