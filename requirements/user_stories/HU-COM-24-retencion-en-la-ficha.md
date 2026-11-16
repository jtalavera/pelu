# HU-COM-24 · «Retención» en toda la aplicación y en la ficha de la profesional

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-24                 |
| **Módulo** | Comisiones (front)        |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Continúa [HU-COM-14](HU-COM-14-grupos-retencion-aguinaldo.md) (la retención y su saldo) y [HU-COM-23](HU-COM-23-movimientos-orden-y-retencion.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que lo que se retiene de cada comisión se llame siempre «Retención» y que la ficha de la profesional me muestre en un solo lugar lo que se le paga y lo que se le retiene,  
**para** no tener dos nombres para lo mismo ni buscar su saldo en una solapa aparte.

---

## Contexto

Mockup aprobado: «Comisiones: Ficha del profesional con Retención», opción A (Resumen en dos tarjetas) y el interruptor «Comisiones | Retención» en Movimientos. Antes la retención se llamaba «Aguinaldo» en unos lugares y «Retención» en otros, y su saldo, los pagos y los movimientos vivían en una solapa «Aguinaldo» de la ficha. **Solo cambian los textos y dónde se ve cada cosa**: ningún cálculo, dato, endpoint ni código de error cambia.

---

## Criterios de aceptación

1. **«Retención» en lugar de «Aguinaldo»** — Todos los textos que decían «aguinaldo» pasan a decir «Retención» (o «retenido»): la solapa de Equipo, el paso de Configurar y su interruptor, el aviso del saldo en Inicio, la guía de primera vez, las liquidaciones («Retenido»), la ficha de la profesional, «Mis comisiones», los ejemplos, los avisos de error y la línea de Movimientos («retención 5 % (Gs. 5.000)»). En español y en inglés.
2. **Tres solapas** — La ficha tiene **Resumen · Reglas · Movimientos**. Ya no existe la solapa «Aguinaldo» y «Historial» pasa a llamarse «Movimientos». La dirección vieja `?tab=aguinaldo` abre la lista de Retención de Movimientos.
3. **Resumen en dos tarjetas** — «A pagar este período» (con el estado, las líneas facturadas y servicios / productos) y, si el salón retiene, **«Retenido este período»** con lo retenido, un recuadro «5 % de cada comisión», la nota «Se suma al saldo cuando se aprueba la liquidación», el **saldo de retención** y el **último pago**. Sin retención, la tarjeta no aparece y «A pagar» ocupa todo el ancho.
4. **Pagar la retención desde el Resumen** — «Pagar retención» (si hay saldo) abre el pago de siempre (todo el saldo o parcial, fecha, medio, nota, por salida) y al registrarlo el saldo y el último pago se actualizan.
5. **Ajustar el saldo desde el Resumen** — «Ajustar el saldo» abre el ajuste manual de siempre (monto, positivo o negativo, y motivo).
6. **Movimientos con interruptor** — Si el salón retiene, Movimientos tiene el interruptor **Comisiones | Retención**; abre siempre en Comisiones. «Retención» muestra el saldo con «Pagar retención» y «Ajustar el saldo», y los movimientos de la retención (se acumula, se paga, se ajusta) con el saldo que quedó. El enlace «Ver movimientos de la retención →» del Resumen abre directamente esa vista. Sin retención no hay interruptor.
7. **Sin retención, igual que antes** — Con la retención desactivada no hay tarjeta, ni acciones, ni interruptor, ni solapa de saldo.
8. **Celular y estilo** — Las dos tarjetas se apilan sin desbordar, los botones miden al menos 44 px, tema claro y oscuro.
