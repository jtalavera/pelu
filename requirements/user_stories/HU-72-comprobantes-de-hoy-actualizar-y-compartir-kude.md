# HU-72 · Comprobantes de hoy: actualizar, fecha y hora, y compartir KuDE

| Campo      | Valor                        |
| ---------- | ---------------------------- |
| **ID**     | HU-72                        |
| **Módulo** | Facturación (front)          |
| **Estado** | `In Progress`                |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** cajera o administradora,  
**quiero** que la lista «Comprobantes de hoy» muestre siempre el estado real de cada comprobante, la hora en que se emitió, y me deje compartir el KuDE directamente desde cada fila,  
**para** no ver estados desactualizados y enviar el comprobante al cliente sin abrir el detalle.

---

## Contexto

El estado que se muestra en la lista y en el detalle sale de la misma regla (estado del comprobante + estado de SIFEN), pero el detalle mantiene su propia copia y la lista no se enteraba cuando algo cambiaba con el detalle abierto (estado de SIFEN, verificar estado, anular en SIFEN, identificar cliente), por lo que podía mostrar un estado viejo hasta el próximo refresco.

---

## Criterios de aceptación

1. **Recarga al cerrar el detalle** — Al cerrar el detalle de un comprobante abierto desde «Comprobantes de hoy» (botón Cerrar, × o Esc), la lista se vuelve a leer del servidor y la fila muestra el estado actual. La recarga es silenciosa: las filas no desaparecen ni se reemplazan por «Cargando…».

2. **Botón «Actualizar»** — La cabecera de la tarjeta «Comprobantes de hoy» tiene un botón «Actualizar», al lado del botón que pliega la lista, que vuelve a leer la lista. Mientras recarga queda deshabilitado y dice «Actualizando…» (en móvil se muestra solo el ícono, con etiqueta accesible), y las filas siguen visibles. Si la recarga falla, se muestra un aviso de error arriba de la lista y las filas se conservan.

3. **Hora de la última actualización** — Arriba de la lista se muestra «Actualizado a las HH:mm» (hora de Paraguay) y se actualiza con cada lectura de la lista: la inicial, la manual, la automática de SIFEN y la de cerrar el detalle.

4. **Fecha y hora de emisión en cada fila** — Cada fila muestra la fecha y hora de emisión del comprobante (hora de Paraguay) en lugar de la forma de pago.

5. **Menú «Más acciones» por fila** — Cada fila tiene un botón «Más acciones» de tres puntos verticales (⋮, 44×44 px, el mismo menú sin borde que usan las filas de Propinas) con las opciones: Enviar por WhatsApp, Enviar por correo, Descargar KuDE (PDF) y Ver detalle. Abrir el menú o elegir una opción no abre el detalle de la fila, salvo «Ver detalle».

6. **Disponibilidad según el estado** — Las tres acciones de KuDE están habilitadas para comprobantes Aprobados y En proceso. Para los que Requieren atención o están Anulados quedan deshabilitadas, con la nota «No disponible: sin KuDE aprobado». «Ver detalle» siempre está disponible.

7. **Resultado de las acciones** — Descargar KuDE descarga el PDF; Enviar por correo abre un diálogo para revisar o cambiar el correo (ver criterio 8) y, al enviar, confirma con «KuDE enviado por correo electrónico.»; Enviar por WhatsApp abre WhatsApp con el mensaje y el KuDE (al contacto del cliente cuando tiene celular cargado). Mientras se prepara la acción, las opciones de KuDE de esa fila quedan deshabilitadas; si falla, se muestra un aviso de error arriba de la lista.

8. **Revisar o cambiar el correo antes de enviar** — «Enviar por correo» no envía directo: abre el diálogo «Enviar KuDE por correo», que muestra el comprobante (cliente, número, fecha y total) y el correo del cliente precargado (el correo del comprobante o, si no tiene, el del cliente). El correo se puede cambiar solo para ese envío: no modifica al cliente. Si el cliente no tiene correo, el campo queda vacío y se exige uno válido; el error dice la regla y trae un ejemplo («Ingresá un correo válido. Ejemplo: cliente@ejemplo.com»). «Cancelar» cierra sin enviar. Si el envío falla, el error se muestra dentro del diálogo, que sigue abierto para reintentar.

9. **Avisos con × para cerrar** — Los avisos que aparecen arriba de la lista (envío por correo, WhatsApp y descarga del KuDE, de éxito o de error) tienen una × para cerrarlos. Se quedan hasta que se cierran o hasta la próxima acción.

10. **Tabla igual a la de Propinas** — Desde tablet hacia arriba, la lista se muestra como una tabla con el mismo estilo que Movimientos de Propinas (encabezado en mayúsculas pequeñas, filas de 44 px, ⋮ sin borde en la última columna) y columnas Emisión, Número, Cliente, Estado, Total y acciones. Hacer clic en la fila abre el detalle. En el celular (menos de 640 px) se mantienen las tarjetas de dos líneas, igual que Propinas.

---

## Notas

- Reutiliza el `KebabMenu` del design-system (el mismo de las filas de Movimientos de Propinas) y las mismas acciones de KuDE que ya existen en el detalle del comprobante (HU-08 AC-16/AC-17, issue #215).
- La lista no trae teléfono ni correo del cliente: para WhatsApp la fila lee primero el detalle del comprobante; el correo se envía sin dirección explícita, por lo que el backend usa el correo del cliente.
