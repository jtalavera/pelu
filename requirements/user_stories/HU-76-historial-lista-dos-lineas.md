# HU-76 · Historial de comprobantes: lista de dos líneas

| Campo      | Valor                |
| ---------- | -------------------- |
| **ID**     | HU-76                |
| **Módulo** | Facturación (front)  |
| **Estado** | `In Progress`        |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** cajera o administradora,  
**quiero** ver el historial de comprobantes con toda la información de cada uno a la vista,  
**para** no tener que desplazar la pantalla para encontrar el total.

---

## Contexto

Con HU-74 el historial pasó a una tabla de 7 columnas con encabezados largos («FECHA FACTURA», «ENVIADO A SIFEN»). En el ancho real de la pantalla no entraban: se cortaba «Enviado a SIFEN» y el Total quedaba fuera de la vista. Mockup aprobado: «Historial de comprobantes: opciones», opción 3 (volver a la lista de dos líneas con la que se mostraba antes).

---

## Criterios de aceptación

1. **Lista de dos líneas** — Cada comprobante es una fila de dos líneas, sin encabezados de tabla. Primera línea: nombre del cliente y total (a la derecha). Segunda línea: estado, «N.º {número}», fecha y hora de emisión, forma de pago y, si SIFEN lo recibió, «SIFEN {hora}».
2. **Todo entra, el total siempre a la vista** — En el ancho real de la pantalla no hay desplazamiento horizontal y el total queda dentro de la tarjeta. En un ancho angosto la segunda línea baja de renglón.
3. **Envío a SIFEN** — Se muestra solo la hora si SIFEN lo recibió el mismo día de la emisión; si fue otro día, la fecha y la hora completas.
4. **La fila se abre** — Hacer clic en la fila, o Enter / Espacio, abre el detalle del comprobante; «Corregir y reenviar» (cuando aplica) sigue junto al total y no abre la fila.

---

## Notas

- Es la única excepción a «todas las tablas se ven igual» de HU-74, decidida por el usuario: la información de cada comprobante no entra en columnas en el ancho de esta pantalla.
