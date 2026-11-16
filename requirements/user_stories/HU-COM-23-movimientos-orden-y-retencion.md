# HU-COM-23 · Movimientos: orden por fecha y retención explicada

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-23                 |
| **Módulo** | Comisiones (front)        |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Continúa [HU-COM-12](HU-COM-12-reasignar-profesional.md) y [HU-COM-20](HU-COM-20-comisiones-reglas-simples.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** ver los movimientos de comisiones de lo más reciente a lo más antiguo (y poder invertirlo) y entender de un vistazo cuánto se pagó y cuánto se retuvo,  
**para** no tener que ir a la última página a ver lo último ni sumar a mano el servicio, la comisión y la retención.

---

## Contexto

Mockup aprobado: «Comisiones: Movimientos, orden por fecha», opción A (lista desplegable «Ordenar»), y la línea de retención propuesta en el análisis del Historial de Conce: «Comisión 45 % · Retención 5 %» no decía el 50 % del servicio ni que los 5 % salían de él. No cambia ningún cálculo ni ninguna API: la lista ya llega completa y se ordena y pagina en pantalla.

---

## Criterios de aceptación

1. **Lo más reciente primero** — La lista de Movimientos (Actividad › Movimientos y la solapa de cada profesional) sale por defecto por fecha y hora, de lo más reciente a lo más antiguo. A igual momento, lo último registrado va arriba (la «Reversión por recálculo» queda encima de la línea que reversa).
2. **«Ordenar»** — Una lista desplegable junto a «Filtros» con «Más recientes primero» y «Más antiguos primero» (altura de al menos 44 px). Al cambiarla vuelve a la primera página.
3. **Vale para toda la lista** — El orden se aplica a todos los movimientos (no solo a la página que se ve) y se mantiene al buscar, filtrar o cambiar de página.
4. **La retención explicada** — Cuando una línea tiene retención, dice «Servicio 50 % → se paga 45 % · aguinaldo 5 % (Gs. 5.000)»: el % de la regla (pagado + retenido), el % que se paga y el que se retiene con su monto. Dice «Producto» si es un producto y «Regla» si no se sabe. Ya no repite el % suelto ni dice «Retención 5 %». La reversión muestra su retención en negativo («(Gs. -5.000)»).
5. **Sin retención, igual que antes** — Una línea sin retención sigue diciendo «Comisión · 20 %».
6. **Textos y estilo** — Español e inglés, tema claro y oscuro, sin desbordes en el celular.
