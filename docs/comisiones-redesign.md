# Comisiones — rediseño minimalista

Parte del rediseño general. Sin cambios de backend ni de API.

- **Pantalla principal** (`/app/commissions`, solo ADMIN): tres solapas segmentadas — **Liquidaciones**, **Movimientos** y **Reglas** — y un menú **⋯** con **Vista previa**, **Reportes** y **Configuración** (al elegir una, el título de la sección aparece bajo las solapas).
- **Liquidaciones**: botón **Generar liquidaciones** junto al título (abre un diálogo con desde / hasta / profesionales, ya precargado con el periodo vigente; el diálogo de conflicto con liquidaciones existentes se mantiene). Línea "Liquidación quincenal · periodo vigente: …", chips de estado (Todas / Borrador / Aprobada / Pagada / Anulada), "Filtros y exportar" plegado (profesional, limpiar, CSV) y filas compactas (avatar, profesional, `#id · periodo · estado`, total) con paginación estándar. Tocar la fila abre el detalle.
- **Detalle de liquidación** (`/app/commissions/settlements/:id`): bloque superior con profesional, estado, total grande y la acción principal según el estado (**Aprobar** en borrador, **Marcar como pagada** si está aprobada), **Descargar PDF** y un ⋯ con **Anular liquidación**. Líneas en filas compactas (con ⋯ → Cambiar profesional en borrador), ajustes con "+ Agregar ajuste" (diálogo, solo en borrador), y "Subtotales por tipo e ítem" e "Historial de estados" plegados.
- **Movimientos**: búsqueda por texto (Enter busca), "Filtros" plegado (desde, hasta, profesionales), filas compactas con el estado de liquidación y ⋯ → **Cambiar profesional**; paginación del lado del cliente.
- **Reglas**: chips Servicios / Productos, buscador y una lista de ítems (nombre, precio, cantidad de excepciones y el % estándar a la derecha). Tocar un ítem abre el diálogo con el % estándar, las excepciones por profesional y "Agregar excepción". Los cambios sin guardar se marcan con ● y quedan en una barra fija inferior (**Descartar / Guardar cambios**); guardar pregunta desde cuándo aplicar. "Más opciones" (plegado) tiene "Ver solo excepciones" y "% vigente al". La base de cálculo y los % por defecto salen de las reglas y se cambian en Configuración.
- **Vista previa**: formulario compacto y resultado con total grande y líneas en filas.
- **Reportes**: chips Por profesional / ítem / tipo / mes con barras proporcionales, "Más filtros" plegado, exportar CSV y la lista "Líneas sin profesional" con **Asignar profesional**.
- **Configuración**: una fila por ajuste (base de cálculo, % por defecto de servicios y productos, periodicidad) con **Cambiar** (diálogo; base y % pasan por el diálogo "¿Desde cuándo aplicar?"), y "Cambios programados" e "Historial de cambios" plegados.
- **Mis comisiones** (profesional, solo lectura): total del periodo con desglose servicios/productos, comisiones del periodo y liquidaciones propias como filas; el detalle de una liquidación abre en un diálogo.

## Tests
Vitest: `pages/commissions/CommissionsPage.test.tsx`. Los specs de Playwright de comisiones (`e2e/tests/comisiones/*`) se adaptan en la pasada final tras Configuración; `mt-comisiones.spec.ts` solo usa la API y no cambia.
