# HU-74 · Una sola tabla para todo el sistema (look de Propinas)

| Campo      | Valor                                  |
| ---------- | -------------------------------------- |
| **ID**     | HU-74                                  |
| **Módulo** | Design-system / listados (front)       |
| **Estado** | `In Progress`                          |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** usuaria del sistema (cajera, administradora o administradora de la plataforma),  
**quiero** que todas las tablas se vean y se comporten igual,  
**para** reconocer enseguida dónde está cada dato y cómo abrir o actuar sobre una fila, sin aprender un estilo distinto por pantalla.

---

## Contexto

Convivían tres estilos: la tabla de Movimientos de Propinas (la referencia), listas de dos líneas (Historial y Hoy) y un `DataTable` del design-system que solo se usaba en la página de muestra. Se unifican en el componente `DataTable` del design-system, con el look de Propinas. Mockup aprobado: «Componente de tabla (DataTable) — propuesta», tablero «Propuesta — escritorio», sin ordenar, elegir columnas ni reordenar.

---

## Criterios de aceptación

1. **Mismo look en todas las pantallas migradas** — Encabezado en mayúsculas de 11 px sobre una línea fina, filas de al menos 44 px con separadores finos, montos alineados a la derecha y, si la fila tiene acciones, el menú ⋮ sin borde (`KebabMenu`) en la última columna. Pantallas: Comprobantes de hoy, Historial de comprobantes, Propinas, Clientes inactivos (lista y panel del Dashboard), resumen de cliente (últimos servicios y productos), SIFEN (certificados y CSC), Plataforma (Tenants, Tiers y detalle de importación).
2. **Filas clicables** — Cuando la fila abre algo, se activa con clic, Enter o Espacio y tiene nombre accesible; hacer clic o presionar teclas dentro de sus acciones (⋮, botones) no la abre.
3. **Fila atenuada** — Las filas anuladas o retiradas se muestran en gris (y tachadas las celdas que corresponda); no cambian de alto.
4. **Tarjetas en el celular** — Bajo 640 px las pantallas con tarjeta definida (Hoy, Historial, Propinas) muestran cada fila como tarjeta, con el ⋮ a la derecha; el resto mantiene la tabla con scroll horizontal dentro de su caja.
5. **Estado vacío** — Una tabla sin filas mantiene su encabezado y muestra el mensaje bajo él.
6. **Tema claro y oscuro** — La tabla usa solo los colores del tema.
7. **Sin ordenar, columnas ni reordenar** — El `DataTable` ya no ofrece ordenar por encabezado, mostrar u ocultar columnas ni reordenarlas.

---

## Notas

- Pendientes de migrar (necesitan una variante propia): la tabla de eventos de Stock (filas desplegables), la lista de categorías del Catálogo (filas tipo tarjeta con separador de inactivas) y las tablas de Comisiones (`commissions/common.tsx`, tablas armadas con contenido libre).
