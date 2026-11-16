# HU-COM-27 · Una línea recalculada se cuenta una sola vez

| Campo      | Valor              |
| ---------- | ------------------ |
| **ID**     | HU-COM-27          |
| **Módulo** | Comisiones (back)  |
| **Estado** | `In Progress`      |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que el Resumen de la profesional y la lista de Liquidar cuenten cada venta una sola vez, aunque su comisión se haya recalculado,  
**para** no creer que hay más facturas de las que realmente hay.

---

## Contexto

El Resumen de Conce decía «2 líneas facturadas» y Liquidar «3 movimientos», pero había una sola factura. Al cambiar su retención se recalculó la comisión: quedaron guardadas tres filas (la comisión original, su reversión y la comisión nueva). El conteo sumaba la original, que ya estaba anulada por la reversión. Solo cambia lo que se cuenta; ningún importe ni regla.

---

## Criterios de aceptación

1. **Resumen** — «N líneas facturadas» cuenta las líneas de factura vigentes: una línea recalculada o reasignada cuenta una vez (o cero si pasó a otra profesional), no dos.
2. **Liquidar y Equipo** — «N movimientos» (por generar / liquidación) no cuenta las reversiones ni las filas que esas reversiones anulan: la venta recalculada es «1 movimiento». Los ajustes manuales siguen contando.
3. **Sin cambios de importes** — La comisión, la retención y los totales son los mismos.
4. **La pestaña Movimientos** sigue mostrando todas las filas (original, reversión y nueva), porque ahí está el detalle.

---

## Fuera de alcance

- Subtotales «líneas» del detalle de una liquidación y de Reportes, que muestran explícitamente las filas revertidas.
