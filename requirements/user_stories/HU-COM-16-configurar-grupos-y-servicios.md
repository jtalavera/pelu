# HU-COM-16 · Configurar: «Grupos y servicios» fácil de encontrar y ordenar

| Campo      | Valor                         |
| ---------- | ----------------------------- |
| **ID**     | HU-COM-16                     |
| **Módulo** | Comisiones (front)            |
| **Estado** | `In Progress`                 |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Continúa [HU-COM-15](HU-COM-15-comisiones-experiencia-rediseno.md) y [HU-COM-14](HU-COM-14-grupos-retencion-aguinaldo-y-monto-fijo.md). Funcionalmente es lo mismo; cambia cómo se encuentra y se ordena.

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** encontrar y ordenar los grupos y los servicios (y sus excepciones) desde un solo lugar, sin recorrer listas largas,  
**para** dejar todos los servicios en su grupo y cargar las reglas rápido.

---

## Contexto

Mockup aprobado: «Comisiones: Configurar, grupos y servicios», **Opción A** (lista de grupos + detalle del grupo) con las excepciones por servicio incluidas. Qué costaba: los grupos estaban detrás de «Abrir grupos», la lista larga de servicios iba primero y los grupos al final, saber qué servicios tiene un grupo obligaba a filtrar y las excepciones por servicio estaban escondidas en «Avanzado».

| Antes | Ahora |
| ----- | ----- |
| Configurar: pasos con un botón «Abrir grupos» | Cada paso muestra su estado (resumen del paso 2, profesionales sin reglas del paso 3) y hay un buscador |
| Grupos: lista de servicios + grupos al final | **Grupos y servicios**: grupos a la izquierda (con «Sin grupo» arriba), servicios del grupo a la derecha |
| Filtrar para ver los servicios de un grupo | Tocar el grupo |
| «Avanzado › Servicios / Productos» | Solapa **Excepciones por servicio** de «Grupos y servicios» |
| «Avanzado» | **Cambios programados e historial** (misma pantalla, solo eso) |

---

## Criterios de aceptación

1. **Estado de cada paso en Configurar** — El paso «Grupos y servicios» muestra cuántos grupos hay, cuántos servicios ya tienen grupo («N de M») y cuántos no (en amarillo), y los grupos como chips con su cantidad. El paso «Reglas por profesional» dice cuántas profesionales no tienen reglas (o que todas tienen). Los pasos 1 y 4 siguen mostrando sus valores con «Cambiar».
2. **Atajos** — Cada chip lleva a ese grupo, el contador «sin grupo» lleva a «Sin grupo», «Ver excepciones» a la solapa de excepciones y «Cambios programados e historial» a su pantalla. «Ordenar grupos y servicios» abre «Grupos y servicios».
3. **Buscador de Configurar** — Escribir un grupo o un servicio y buscar abre «Grupos y servicios» ya buscando.
4. **Grupos y servicios: lista y detalle** — A la izquierda «Sin grupo» siempre arriba, con su contador en amarillo (servicios y productos juntos), y debajo los grupos con su cantidad y sus primeros servicios. A la derecha, los servicios del grupo elegido (o los sin grupo). Abre en «Sin grupo» si hay algo sin grupo; si no, en el primer grupo. La dirección conserva el grupo abierto (`?group=`), y uno inexistente cae en «Sin grupo».
5. **Detalle del grupo** — Nombre, cuántos servicios tiene y para cuántas profesionales hay regla, «Renombrar», «+ Agregar servicios», un menú con «Eliminar» (un grupo con reglas no se elimina, como antes) y un acceso a las reglas por profesional. Un grupo vacío lo explica.
6. **Mover desde donde está** — Cada servicio (o producto, marcado como «Producto») tiene su grupo actual y «Mover a…» / «Quitar del grupo» en la misma fila, la sugerencia por nombre con «Aceptar», y «Aceptar las N sugerencias» para los de la vista. Se pueden marcar varios («Seleccionar los N que coinciden») y asignarlos desde la barra, que también permite «+ Crear grupo nuevo…» y asignarles los seleccionados.
7. **Buscar** — El buscador de la pantalla filtra mientras se escribe, sin distinguir tildes ni mayúsculas, y muestra «Resultados para «…»» con los grupos que coinciden («Abrir grupo») y los servicios y productos que coinciden con su grupo (o «Sin grupo») y «Mover a…» ahí mismo. Sin resultados lo dice; «Borrar búsqueda» vuelve a la lista.
8. **Agregar servicios** — «+ Agregar servicios» abre un diálogo con buscador, filtro por grupo y los chips «Sin grupo / Con grupo / Todos» (abre en «Sin grupo»), marca los sugeridos por el nombre del grupo («Marcar los sugeridos»), indica cuántos se eligieron y cuántos se mueven de otro grupo («Agregar N a …»).
9. **Cambia al instante** — Asignar cambia la pantalla y los contadores de inmediato, la fila queda marcada un momento y recién después sale de la vista; el servidor confirma con una sola llamada (sin releer todo). Si lo rechaza, se vuelve a leer el estado real y no se avisa un éxito. Con más de 50 filas se dibujan 50 y «Mostrar N más» trae el resto.
10. **Crear, renombrar, eliminar** — «+ Nuevo grupo» está siempre arriba; el grupo creado se abre solo. Nombre obligatorio y sin repetir; con la selección activa puede crearse y asignarse en un paso.
11. **Excepciones por servicio** — Una solapa de «Grupos y servicios» con el orden en que se aplican las reglas (profesional + servicio › profesional + grupo › servicio › grupo › % por defecto) y las excepciones por servicio y por producto de HU-COM-02 (buscador, solo con excepciones, editar, cambios sin guardar), sin cambios de comportamiento.
12. **Celular** — Se ve primero la lista de grupos; tocar uno abre sus servicios con «← Todos los grupos» para volver. Sin scroll horizontal y con objetivos táctiles de al menos 44 px.
13. **Nada se pierde** — Todo lo de HU-COM-14 (grupos, sugerencias por nombre, asignación en lote, crear al asignar) y HU-COM-09 (cambios programados e historial) sigue disponible. Todo el texto está en español e inglés, en tema claro y oscuro.
14. **Asignar devuelve lo que quedó** — `POST /api/commissions/groups/assign` valida en dos consultas y responde `{ changed, rows }` con cada ítem afectado como lo muestra la lista (grupo y sugerencia); `COMMISSION_GROUP_NOT_FOUND` o `SERVICE_NOT_FOUND` si algo no existe.

---

## Notas

- Rutas: `/app/commissions/configurar` (Configurar), `/configurar/grupos` (Grupos y servicios, con `?group=<id|none>`, `?q=` y `?tab=exceptions`), `/configurar/avanzado` (cambios programados e historial).
- «Sin grupo» cuenta servicios y productos; en el paso 2 de Configurar «N de M» cuenta solo servicios (como el aviso de «Inicio»).
