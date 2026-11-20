# HU-COM-30 · Liquidar: descargar el CSV de este período o de períodos anteriores

| Campo      | Valor                      |
| ---------- | -------------------------- |
| **ID**     | HU-COM-30                  |
| **Módulo** | Comisiones (front + API)   |
| **Estado** | `In Progress`              |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Cambia el botón «Descargar CSV» de [HU-COM-28](HU-COM-28-liquidar-pestanas.md) (opción C del mockup aprobado).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que «Descargar CSV» sea un ícono junto al total y que me deje elegir el CSV de este período o de períodos anteriores,  
**para** no tener un botón suelto al pie y para bajar solo lo que necesito (hoy trae todas las liquidaciones, de cualquier período).

---

## Criterios de aceptación

1. **Ícono junto al total** — Arriba, a la derecha de «Total … ya pagado», hay un ícono de descarga redondo de al menos 44 px (con nombre accesible «Descargar CSV de liquidaciones»). Desaparece la franja de abajo con el botón; si hay profesionales sin movimientos, queda solo su línea.
2. **Menú** — Al tocarlo se abre un menú con dos opciones: «Descargar CSV de este período» (con las fechas del período que se ve) y «Descargar CSV de períodos anteriores…». Se cierra con Esc o tocando fuera.
3. **Este período** — Descarga al instante un CSV con las liquidaciones cuyo período toca el período que se ve. El archivo se llama `liquidaciones_<desde>_<hasta>.csv`.
4. **Períodos anteriores** — Abre una ventana con «Desde» y «Hasta», ya puestos con los tres meses anteriores al período que se ve (hasta el día anterior a que empiece). «Descargar» baja el CSV de ese rango, con las fechas en el nombre.
5. **Validación** — Si «Desde» es posterior a «Hasta», la ventana lo dice en rojo con un ejemplo («Ejemplo: desde 01/08/2026 hasta 31/10/2026») y no descarga.
6. **API** — `GET /api/commissions/settlements.csv` acepta `from` y `to` (YYYY-MM-DD): solo trae las liquidaciones cuyo período toca ese rango; sin ellos trae todas, como antes. Ahora lee **todas** las páginas (antes se cortaba en las primeras 100).
7. **Celular** — El ícono se ve y el menú no desborda la pantalla.
8. **Textos y estilo** — Español e inglés, tema claro y oscuro.

---

## Fuera de alcance

- El CSV de Movimientos y el de Reportes, que ya tienen sus propios filtros de fecha.
