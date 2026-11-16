# HU-COM-33 · Fichas y Movimientos: filas parejas, tarjeta con etapas, Reglas en tres cuadros y Equipo sin iniciales

| Campo      | Valor              |
| ---------- | ------------------ |
| **ID**     | HU-COM-33          |
| **Módulo** | Comisiones (front) |
| **Estado** | `In Progress`      |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Retoca [HU-COM-29](HU-COM-29-movimientos-lineas-revertidas.md) (Movimientos), [HU-COM-15](HU-COM-15-comisiones-experiencia-rediseno.md) y [HU-COM-24](HU-COM-24-retencion-en-la-ficha.md) (la ficha del profesional) y [HU-COM-32](HU-COM-32-liquidacion-dia-a-dia.md) (el mismo desglose de la liquidación). Todas son las opciones elegidas en los mockups: Movimientos B, tarjeta «A pagar» C, Reglas C y Equipo B.

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que la tabla de Movimientos tenga filas parejas, que la tarjeta del profesional diga en qué etapa está su liquidación y de dónde sale el monto, que Reglas no repita un aviso y que Equipo no ponga iniciales delante de cada nombre,  
**para** leer estas pantallas de un vistazo y no ver «0» donde hay un monto.

---

## Contexto

- En Movimientos, una venta recalculada ocupaba una fila mucho más alta (etiqueta en una línea propia y «Ver cambios» en otra), y la columna Monto partía «Gs. 163.636» en dos líneas dentro de la ficha.
- En el Resumen de un profesional con una liquidación en Borrador el monto grande salía de la liquidación, pero «líneas facturadas», Servicios y Productos salían de lo que todavía estaba sin liquidar: daban 0. **Es un error**, no un cálculo distinto.
- Reglas abría con una caja celeste que repetía el nombre y una explicación larga.
- Equipo, Liquidar, Inicio y la ficha ponían las iniciales en un círculo antes del nombre; Equipo además repetía «Cobra lo normal de cada servicio» en todas las tarjetas.

Solo cambia cómo se muestra: los importes, el saldo y la API son los mismos.

---

## Criterios de aceptación

### Movimientos (general y ficha)

1. **Filas parejas** — Todas las filas miden lo mismo, con o sin historial. «Ver cambios» deja de ser una fila aparte.
2. **La flecha y la etiqueta** — Una flecha a la izquierda de la fila (la primera celda) abre «Cómo llegó a este monto» (inicial revertida → reversión → vigente, con el neto) y la vuelve a cerrar; su nombre accesible es «Ver cambios · N filas». La etiqueta («Recalculada», «Reasignada»…) va debajo de «Comisión», en la columna Tipo, y «antes 40 %» en Cálculo. En el celular siguen las tarjetas, con la etiqueta y el texto «Ver cambios».
3. **Sin columna Profesional en la ficha** — En Movimientos de la ficha de un profesional no hay columna Profesional (siempre es el mismo); en la pantalla Movimientos general sí. Los nombres largos se cortan con «…» (el nombre completo sale al pasar el cursor).

### Resumen de la ficha: tarjeta «A pagar este período»

4. **Etapas** — La tarjeta muestra el camino Por generar → Borrador → Aprobada → Pagada con la etapa actual marcada y las anteriores tildadas, y debajo del total dice qué sigue («siguiente: aprobarla»…). Sin movimientos sigue la etiqueta «Sin movimientos». Pagada muestra cómo y cuándo se pagó, y el botón dice «Ver la liquidación».
5. **El desglose suma el total (arregla el 0)** — Con una liquidación generada (Borrador, Aprobada o Pagada), «líneas facturadas», Servicios, Productos y Ajustes salen de esa liquidación y suman el total mostrado.
6. **Sin liquidación** — Sigue saliendo de lo pendiente (la vista previa), con el saldo arrastrado de períodos anteriores si lo hay.

### Reglas de la ficha

7. **Tres cuadros** — Se quita la caja celeste. Arriba van tres cuadros: Comisión («Lo normal», lo que paga el salón, con «Ver las comisiones →»), Retención (el % y «Cambiar»; solo si el salón retiene) y Excepciones (cuántas, o «Ninguna»). Debajo, la lista «Donde cobra distinto» con «+ Agregar», «Cambiar», «Quitar» e «Incluirlos», sin cambios.
8. **Sin excepciones** — La lista explica que cobra lo normal en todo.

### Equipo

9. **Sin iniciales (Equipo, Liquidar, Inicio y la ficha)** — En Equipo, cada tarjeta es más baja: nombre y monto arriba, «N movimientos · falta generar» y el estado abajo. No hay iniciales delante del nombre, y no se repite «Cobra lo normal de cada servicio»: una línea chica aparece solo si hay algo distinto («Cobra distinto en N servicios», «retiene 5 %», el saldo de retención). Tocar la tarjeta abre la ficha. **Tampoco hay iniciales** en Liquidar (cada fila), Inicio (la lista del equipo) ni en el encabezado de la ficha del profesional: el nombre va solo.

### Transversal

10. **Textos y estilo** — Español e inglés, tema claro y oscuro, objetivos táctiles de al menos 44 px, sin desbordes en el celular.
11. **API** — Sin cambios.

---

## Fuera de alcance

- La tarjeta de Retención del Resumen.
