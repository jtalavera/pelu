# HU-21 · Fixes varios del módulo de clientes

| Campo | Valor |
|--------|--------|
| **ID** | HU-21 |
| **Módulo** | Cliente básico |
| **Estado** | `Backlog` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador del negocio,  
**quiero** textos y flujos coherentes en la gestión de clientes (formulario, listado, confirmaciones y filtros),  
**para** trabajar sin mensajes duplicados, diálogos inconsistentes y listados incompletos.

---

## Criterios de aceptación

1. **Botón de alta** — El botón que actualmente dice **«Nueva Clienta»** debe decir **«Nuevo Cliente»** (y cualquier variante equivalente alineada en i18n).
2. **Copy unificado — «cliente» en masculino** — En **todos** los textos orientados al usuario del módulo de clientes (etiquetas, mensajes, títulos, toasts, `aria-label`, placeholders, estados vacíos, etc.), el sustantivo debe ser **«cliente»** (no «clienta») y los adjetivos / participios deben ir en **masculino** cuando califiquen a «cliente» (p. ej. **«Cliente actualizado»**, no «cliente actualizada»). Incluye mensajes de éxito, error, confirmación y textos de botones.
3. **Éxito al guardar (edición)** — En el formulario de edición de cliente, al hacer clic en **Guardar**, el mensaje de éxito se muestra **una sola vez** (corregir duplicación actual).
4. **Desactivar — confirmación con patrón de producto** — El botón **Desactivar** no debe usar `alert` nativo del navegador; debe usar el mismo **patrón de confirmación / modal o diálogo** que el resto de pantallas del producto, con el look and feel de la aplicación (temas claro y oscuro).
5. **Reactivar cliente** — Tras desactivar un cliente desde el formulario de edición, debe existir una acción explícita para **reactivarlo** (p. ej. botón **Reactivar** u equivalente), visible y utilizable según el estado del registro, sin quedar el caso sin salida.
6. **Listado e inclusión de inactivos** — En el listado de clientes, cuando el filtro de estado permite **«Todas»** (o equivalente), deben mostrarse también los clientes **inactivos**, junto con los activos, de forma distinguible si el diseño lo requiere. El comportamiento actual que **oculta** inactivos incluso con «Todas» se considera **incorrecto** y debe corregirse.
7. **Etiquetas de botones en masculino** — Los textos de botones del flujo de clientes que califiquen la acción sobre la persona deben alinearse con el criterio masculino (p. ej. textos coherentes con «cliente» ya definido en criterio 2).

---

## Notas para estimación y pruebas

- **Contexto:** complementa HU-10, HU-11 y HU-12; puede implicar cambios amplios de i18n (`en` / `es`) y revisión de claves compartidas con otros módulos que mencionen «clienta».
- **Pruebas:** guardar edición y contar toasts una sola vez; desactivar con teclado y lector de pantalla; reactivar y verificar listado y turnos si aplica; filtro «Todas» con mezcla activos/inactivos; regresión en búsqueda y alta (HU-11 / HU-10).
