# HU-77 · Resumen (antes «Panel») y Reportes (antes «Resumen»)

| Campo      | Valor                |
| ---------- | -------------------- |
| **ID**     | HU-77                |
| **Módulo** | Inicio (front)       |
| **Estado** | `In Progress`        |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** una pantalla de inicio simple que me muestre cómo va el salón hoy,  
**para** saber de un vistazo cuántos turnos hay, cuánto entró a la caja, qué falta cobrar y cómo van las facturas.

---

## Contexto

Se investigaron las pantallas principales de programas de salones (Fresha, Phorest y guías de indicadores): abren en «hoy», con pocos números y avisos de lo que hay que hacer; lo de largo plazo va aparte. Mockup aprobado: «Resumen: opciones del panel principal», opción A con la tarjeta «Fichas de hoy» rediseñada.

---

## Criterios de aceptación

1. **Nombres nuevos** — En el menú del administrador: «Panel» pasa a llamarse **Resumen** (es la primera opción y la pantalla de inicio); «Resumen» (la pantalla de gráficos) pasa a llamarse **Reportes**, con el mismo contenido y su título de página. La pantalla de trabajo del día que era el Panel (turnos y fichas de hoy con sus acciones, cumpleaños, ocupación, clientes inactivos) sigue disponible, sin cambios, como **Hoy**, justo debajo de Resumen. La profesional tiene una sola entrada, «Hoy».
2. **Encabezado** — «¡Hola, equipo!», «Así va tu salón hoy · {día}» y los botones «+ Nuevo turno» (abre el formulario) y «+ Nueva factura» (lleva a una factura nueva). Si el servidor envía una alerta fiscal no bloqueante, se muestra arriba y se puede cerrar.
3. **Carga en un solo tiempo** — Las cuatro tarjetas se piden juntas y aparecen a la vez; mientras tanto se ve un esqueleto. Se actualizan solas cada minuto.
4. **Turnos de hoy** — Cantidad de turnos, cuántos pendientes y cuántos confirmados, y los próximos cuatro (pendientes, confirmados o en curso) por hora, con cliente y servicio. «Ver agenda →» lleva al calendario.
5. **Caja del día** — Total cobrado en la caja abierta y lo cobrado en efectivo, tarjeta (débito + crédito) y transferencia (más «Otros» si hay otra forma de pago); «Abierta desde las HH:mm · Ver caja →» (si la caja se abrió antes de hoy, con su fecha: «Abierta desde el dd/mm/aaaa a las HH:mm · Ver caja →»). Con la caja cerrada dice «Caja cerrada» y lleva a Caja.
6. **Fichas de hoy** — Lo que falta cobrar (suma de las fichas abiertas de hoy) y cuántas fichas abiertas son; una barra y su leyenda con cobradas, abiertas y anuladas del día; las tres abiertas que más tiempo llevan, con cliente, servicio, profesional, hace cuánto se abrió, monto y «Cobrar» (de 44 px), que abre Facturación con esa ficha; «y N fichas abiertas más», «N abiertas de días anteriores» y «Ver todas →».
7. **Factura electrónica** — Cuántos comprobantes se emitieron hoy y, con facturación electrónica activa, «Todas al día» o cuántos requieren atención; sin ella, la tarjeta se llama «Comprobantes» y no muestra estado. «Ver comprobantes →».
8. **Celular** — Bajo 640 px las tarjetas van una debajo de otra, sin desplazamiento horizontal.
9. **Todo en el idioma del usuario** — Con la interfaz en español, todo lo que dice el Resumen está en español, incluida la alerta fiscal: el servidor envía un código y un texto de respaldo en inglés, y la pantalla muestra la traducción del código (el texto en inglés solo se usa si llega un código desconocido).

---

## Notas

- Las propinas ya no aparecen en el Resumen (la tarjeta se reemplazó por Fichas); siguen en su pantalla del menú.
- Pendientes que necesitan datos nuevos del servidor y quedaron fuera: comparación con el mismo día de la semana pasada, ticket promedio y turnos sin confirmar de mañana (franja «Requiere atención» de la opción B).
