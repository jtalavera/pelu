# HU-19 · Fixes varios del calendario


| Campo      | Valor        |
| ---------- | ------------ |
| **ID**     | HU-19        |
| **Módulo** | Agendamiento |
| **Estado** | `Backlog`    |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administradora del negocio,  
**quiero** búsqueda al escribir en los selectores del calendario y del diálogo de nuevo turno, ver turnos solapados de forma legible y solo los estados operativos en la vista,  
**para** agendar y revisar turnos con menos fricción y una vista más clara.

---

## Criterios de aceptación

1. **Diálogo de nuevo turno — profesional** — El campo *Profesional* permite escribir texto y la lista desplegable se **filtra en vivo** según lo tipeado (autobúsqueda). La lista puede obtenerse **completa** desde el backend y filtrarse en el frontend (volumen acotado).
2. **Diálogo de nuevo turno — servicio** — Mismo comportamiento que el ítem anterior para el campo *Servicio*.
3. **Diálogo de nuevo turno — cliente** — Mismo comportamiento que el ítem anterior para el campo *Cliente*.
4. **Vista principal del calendario — filtro de profesionales** — El control que permite elegir qué **profesionales** muestra el calendario filtra las opciones **a medida que se escribe**, con el mismo criterio de autobúsqueda que en los puntos anteriores.
5. **Turnos en el mismo horario (vista)** — Si hay **dos o más turnos** que comparten la misma franja horaria visible en la celda, sus tarjetas se muestran **una al lado de la otra**, con ancho reducido para caber en el espacio. Al pasar el puntero (hover), cada tarjeta se muestra **flotante a tamaño normal** para leer el contenido con comodidad.
6. **Estados visibles en el calendario** — En la vista de calendario solo se muestran turnos en estado **Pendiente**, **Confirmado** y **En curso**. Los demás estados **no** aparecen en la grilla (quedan ocultos en esa vista).

---

## Notas para estimación y pruebas

- **Dependencias / contexto:** complementa HU-06, HU-07 y estados de turno (HU-08); revisar coherencia con reglas de negocio de solapes (HU-07) si aplica al mismo profesional y horario.
- **Pruebas:** lista vacía tras filtrar; un carácter que no matchee nada; selección con teclado y ratón; varios turnos en la misma celda con y sin hover; calendario con mezcla de estados visibles y ocultos; temas claro y oscuro y accesibilidad básica del control de filtrado.