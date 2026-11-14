# HU-78 · «Hoy» sin bienvenida y «Reportes» con el detalle abierto

| Campo      | Valor                   |
| ---------- | ----------------------- |
| **ID**     | HU-78                   |
| **Módulo** | Inicio / Reportes (front) |
| **Estado** | `In Progress`           |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que «Hoy» muestre solo lo que se trabaja en el día y que lo de análisis esté en «Reportes»,  
**para** que cada pantalla tenga un solo propósito ahora que la bienvenida es el «Resumen» (HU-77).

---

## Contexto

Con HU-77 la pantalla de bienvenida pasó a ser el «Resumen» y la pantalla anterior quedó como «Hoy». Mockup aprobado: «Pantalla Hoy: versión simplificada».

---

## Criterios de aceptación

1. **«Hoy» sin mensajes** — Se quitan el saludo («Buenos días, …»), la fecha y la hora, y la alerta fiscal (que se ve en el Resumen). El título es «Hoy».
2. **«Hoy» sin «Más del día»** — Se quitan Ocupación por profesional, Cumpleaños y Clientes inactivos. Quedan los botones «+ Nuevo turno» y «+ Nueva ficha», la línea «N turnos hoy | Gs. cobrados», la lista de turnos de hoy y la de fichas de servicio de hoy, sin cambios.
3. **«Reportes» abre con el detalle abierto** — «Ver más detalle» está abierto al entrar; se puede plegar y volver a abrir.
4. **Ocupación por profesional en Reportes** — Dentro del detalle: los turnos de hoy de cada profesional, de mayor a menor, con una barra. No cambia con el período de 7 / 30 / 90 días. Sin turnos hoy dice «No hay turnos para hoy».
5. **Clientes inactivos en Reportes** — Dentro del detalle: la misma lista de antes (cliente, teléfono y días de inactividad, la fila abre al cliente) con el umbral que manda el servidor y «Ver todas», que abre la lista completa (`/app/inactive-clients`). Sin clientes inactivos, el mensaje de vacío.
6. **Cumpleaños deja de verse** — La tarjeta de cumpleaños se elimina del Inicio y no pasa a ninguna otra pantalla. La insignia «Cumpleaños hoy» de la ficha del cliente y el ícono 🎂 del turno (HU-69) siguen.

---

## Notas

- El servicio del servidor de cumpleaños (`/api/dashboard/birthdays`) no se tocó: queda disponible para quien lo necesite.
