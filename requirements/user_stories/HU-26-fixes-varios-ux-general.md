# HU-26 · Fixes varios (UX general)


| Campo      | Valor          |
| ---------- | -------------- |
| **ID**     | HU-26          |
| **Módulo** | Varios (front) |
| **Estado** | `Done`  |


## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ajustes puntuales de usabilidad en módulos de calendario, profesionales, servicios, clientes, historial de comprobantes, configuración y PDF de facturas,  
**para** trabajar con menos fricción en flujos frecuentes.

---

## Criterios de aceptación

1. **Calendario — horarios de turno** — En el formulario para crear un nuevo turno dentro del módulo Calendario, el componente de Hora despliega todos los horarios disponibles desde las 06:00 hasta las 20:00 en intervalos de 15 minutos.
2. **Profesionales — posicionamiento de opciones** — Al presionar los 3 puntos verticales en la tabla del módulo Profesionales, el menú de opciones se superpone a la tabla (no se abre dentro) para mantener visibilidad incluso con pocos registros.
3. **Profesionales — horario por defecto** — En la solapa "Horario" del formulario de Profesionales, el campo de Hora muestra por defecto 9:00 a 19:00 Hs.
4. **Servicios — botón Desactivar oculto** — En la lista de servicios del módulo Servicios, el botón de Desactivar en cada registro no se visualiza directamente.
5. **Servicios — menú de opciones** — En la lista de servicios del módulo Servicios, cada registro incluye un botón de 3 puntos que abre un menú con opciones: "Editar detalle" y "Desactivar".
6. **Clientes — posicionamiento de opciones** — Al presionar los 3 puntos verticales en la tabla del módulo Clientes, el menú de opciones se superpone a la tabla para mantener visibilidad incluso con pocos registros.
7. **Historial de comprobantes — velocidad de refresco** — El historial de comprobantes se carga y refresca de forma ágil (revisar performance y optimizar consulta si es necesario).
8. **Historial de comprobantes — botón de fuerza de refresco** — En la solapa "Historial de comprobantes", existe un botón para forzar la carga de todos los comprobantes según el filtro seleccionado.
9. **Historial de comprobantes — scroll al guardar** — Al guardar un nuevo comprobante, la página se posiciona en la parte superior tras refrescarse.
10. **Configuración — Timbrado — Editar** — En el módulo Configuración, solapa Timbrado, existe un botón "Editar timbrado" junto al botón Desactivar; permite editar únicamente el campo "Número de inicio de emisión".
11. **Factura PDF — eliminar número de comprobante** — En el PDF generado al emitir un comprobante, se elimina el número de comprobante de la impresión.
12. **Factura PDF — alineación de total** — En el PDF generado, el valor total en negrita se alinea con el valor total superior y el valor del IVA inferior.
13. **Factura PDF — eliminar total duplicado** — En el PDF generado, el valor total que aparece en la última línea se elimina.

---

## Notas

- Este documento agrupa ajustes de UX dispersos en varios módulos; la prioridad es la usabilidad en flujos frecuentes.
- Los cambios de PDF (criterios 11–13) pueden requerir coordinación con la lógica de generación de reportes en el backend.