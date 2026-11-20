# HU-COM-31 · El CSV de Liquidar incluye lo que está por generar; el ícono va sin círculo

| Campo      | Valor                    |
| ---------- | ------------------------ |
| **ID**     | HU-COM-31                |
| **Módulo** | Comisiones (front + API) |
| **Estado** | `In Progress`            |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Corrige y completa [HU-COM-30](HU-COM-30-liquidar-descargar-csv.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que el CSV de Liquidar traiga también a quien todavía está «Por generar», y que el ícono de descargar no tenga círculo,  
**para** no bajar un archivo vacío cuando todavía no generé ninguna liquidación del período, y para que el ícono se vea más liviano.

---

## Contexto

El CSV salía solo con liquidaciones **ya generadas**. En un período en que todas están «Por generar» (por ejemplo 9 profesionales con comisiones y ninguna liquidación), el archivo salía vacío (solo los encabezados), aunque la pantalla mostraba Gs. 2.220.930 pendientes.

---

## Criterios de aceptación

1. **Incluye lo «Por generar»** — Al descargar el CSV de un rango (este período o períodos anteriores), además de las liquidaciones del rango trae una fila por cada profesional que tiene comisiones por liquidar al final del rango y todavía no tiene liquidación en él (la misma regla con que Liquidar la lista en «Por generar»): sin ID de liquidación, estado «Sin liquidar» (en inglés «Unsettled»), lo pendiente como total y sin medio ni referencia de pago.
2. **Orden** — Primero las filas «Sin liquidar» (ordenadas por nombre) y después las liquidaciones, como en la pantalla.
3. **Quien ya tiene liquidación no se repite** — Si la profesional ya tiene una liquidación (no anulada) que toca el rango, sale solo esa.
4. **Un rango anterior** — Si las comisiones de una profesional son posteriores al final del rango, no aparece como pendiente en ese rango.
5. **API** — `GET /api/commissions/settlements.csv` con `from` y `to` agrega esas filas (respeta `professionalIds`; con `status` distinto de `UNSETTLED` no las agrega); sin `from`/`to` queda como antes.
6. **Ícono sin círculo** — El ícono de descargar de Liquidar se ve solo, sin el borde redondo; mantiene su área táctil de 44 px, el menú y el nombre accesible. Al abrirse el menú se resalta con un fondo suave.
7. **Textos y estilo** — Español e inglés, tema claro y oscuro.
