# HU-75 · Detalle del comprobante: propinas simplificadas y carga en un solo tiempo

| Campo      | Valor                         |
| ---------- | ----------------------------- |
| **ID**     | HU-75                         |
| **Módulo** | Facturación (front)           |
| **Estado** | `In Progress`                 |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** cajera o administradora,  
**quiero** que el detalle de un comprobante se vea completo de una vez y que la solapa de Propinas sea corta y clara,  
**para** no ver la pantalla armarse en dos tiempos ni leer texto que no necesito.

---

## Contexto

El detalle del comprobante pedía primero el comprobante y recién después, ya dibujado, las propinas: la solapa aparecía más tarde y empujaba los botones. Además, al desplegar Propinas la pantalla se veía cargada (texto explicativo, total en rojo, correos y motivos). Mockup aprobado: «Detalle del comprobante: propinas simplificadas».

---

## Criterios de aceptación

1. **Carga en un solo tiempo** — El detalle pide el comprobante y sus propinas a la vez y se muestra cuando llegan ambos. Mientras tanto se ve un esqueleto con el lugar de la solapa de Propinas incluido, así que nada se mueve al terminar. Si las propinas fallan, el detalle se muestra igual, sin la solapa.
2. **Propinas desplegadas, sin texto de más** — Se quitan el texto explicativo, la nota larga de la caja y el total en rojo «no facturable» (el total sigue en la etiqueta «X registradas» de la solapa).
3. **Filas cortas** — Cada propina muestra profesional y monto, y debajo «forma de pago · hora» (con la fecha completa si no es de hoy). No se muestra el correo de quién la registró. Las anuladas muestran solo la etiqueta «Anulada» y el monto tachado, sin quién la anuló ni el motivo. «Anular» es un texto rojo de 44 px de alto.
4. **Formulario compacto** — Monto y forma de pago van en una sola fila; el botón dice «Registrar · {total}» con lo ingresado hasta el momento; hay un botón «Cancelar» (salvo en «Comprobante emitido» con la solapa pendiente) y una sola línea de ayuda: «Se suma a la caja abierta.».
