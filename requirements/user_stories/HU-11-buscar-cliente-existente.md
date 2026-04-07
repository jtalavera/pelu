# HU-11 · Buscar una cliente existente

| Campo | Valor |
|--------|--------|
| **ID** | HU-11 |
| **Módulo** | Cliente básico |
| **Estado** | `Backlog` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** buscar una cliente por nombre, teléfono o RUC desde el formulario de turno o de factura,  
**para** vincularla rápidamente sin salir de lo que estoy haciendo.

---

## Criterios de aceptación

1. **Ubicación** — El buscador aparece inline en el formulario de turno y en el de factura.
2. **Búsqueda incremental** — La búsqueda se dispara mientras se escribe (desde 2 caracteres) por nombre, teléfono o RUC.
3. **Resultados** — Cada resultado muestra nombre, teléfono y RUC (si existe) para identificar sin ambigüedad.
4. **Alta rápida** — Si no hay resultados, se puede crear una nueva cliente desde el mismo contexto sin perder el progreso del formulario principal (flujo definido en UX).
5. **Autocompletado en factura** — Al seleccionar una cliente, sus datos (incluido RUC si aplica) se autocompletan en el formulario de factura.
6. **Cliente ocasional** — Si se elige cliente ocasional, el vínculo usa el **identificador genérico** del tenant (sin seleccionar una cliente del directorio con datos completos); ver PRD — Definiciones transversales.

---

## Notas para estimación y pruebas

- **Pruebas:** debounce/threshold de 2 caracteres, sin resultados, selección y autocompletado, creación inline.
