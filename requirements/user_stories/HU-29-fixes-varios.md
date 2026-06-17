# HU-29 · Fixes varios

| Campo      | Valor                        |
| ---------- | ---------------------------- |
| **ID**     | HU-29                        |
| **Módulo** | Varios (front + back)        |
| **Estado** | `In Progress`                |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ajustes puntuales en la facturación, el PDF del comprobante, las tablas y otras áreas de la aplicación,  
**para** mejorar la usabilidad y precisión en los flujos de trabajo frecuentes.

---

## Criterios de aceptación

1. **General — separador de miles en campos de monto** — Todos los campos de monto numérico muestran separador de miles. Ejemplo concreto: el campo Precio en el formulario de Servicios.

2. **Facturación — subtotal con descuento por ítem** — En el formulario de Nuevo comprobante, debajo del campo Precio Unitario de cada ítem aparece un campo de solo lectura que muestra el total del ítem con el descuento ya aplicado, visible únicamente cuando ese ítem tiene un descuento activo. El texto de este campo se muestra en verde (o color equivalente de la paleta) para identificar visualmente el descuento a simple vista.

3. **Facturación — descuento combinado en resumen de pago** — En el formulario de Nuevo comprobante se pueden aplicar descuentos tanto por ítem individual como sobre el total de ítems. El campo Descuento que aparece debajo del subtotal en la sección Método de Pago refleja la sumatoria de los descuentos aplicados a los ítems individuales más el descuento aplicado sobre el total de ítems.

4. **Facturación — validaciones de descuento** — Los descuentos aplicados a ítems individuales y al total de ítems tienen las siguientes validaciones: el descuento en Porcentaje no puede superar el 100 %, y el descuento en Monto no puede superar el monto total del ítem o del subtotal total según corresponda.

5. **PDF — monto total por ítem en columna de impuesto** — Al emitir un comprobante en PDF, el monto total de cada ítem (cantidad × precio unitario) se ubica en la columna correspondiente según el tipo de impuesto del servicio: Exenta en la primera columna, IVA 5 % en la segunda columna, IVA 10 % en la tercera columna.

6. **PDF — descuentos como líneas separadas** — Al emitir un comprobante en PDF, cada descuento se representa como una línea adicional:
   - **Descuento por ítem individual:** se imprime primero la línea del ítem con su monto total sin descuento; justo debajo aparece una segunda línea con el nombre del ítem seguido de la descripción del tipo y valor del descuento, y el monto del descuento en negativo en la columna correspondiente al tipo de impuesto del ítem (Exenta, IVA 5 % o IVA 10 %). Esto se aplica a cada ítem con descuento individual.
   - **Descuento sobre el total de ítems:** se imprime una única línea que describe el tipo y valor del descuento global; el monto total del descuento se distribuye en negativo entre las tres columnas de impuesto (Exenta, IVA 5 % e IVA 10 %) en las columnas correctas del PDF.

7. **Datos semilla — actualización de clientes** — En la base de datos semilla se eliminan los registros de ISABEL ZYMANSCKI y MERCEDES AQUINO, y se agrega GABRIELA.

8. **Tablas — menú de opciones solapado** — En todas las tablas de la aplicación, al presionar los tres puntos de un registro el menú de opciones se superpone (overlay) sobre la tabla en lugar de renderizarse dentro del contenedor de la tabla.

9. **Timbrado — separación visual de secciones** — En la pantalla de Timbrado, el formulario para crear un nuevo timbrado está visualmente separado del apartado de información del timbrado actual, para mejorar la lectura del usuario.

10. **Facturación — botón Ver en Comprobantes de hoy** — En la sección Comprobantes de hoy dentro de la solapa Facturación, cada registro incluye un botón Ver que abre el mismo popup que aparece al presionar Ver en el Historial de comprobantes.

---

## Notas

- Los criterios 5 y 6 requieren ajustar el generador de PDF para manejar columnas de impuesto dinámicamente según el tipo de impuesto de cada ítem.
- El criterio 6 para el descuento global introduce la lógica de distribución del monto entre las columnas Exenta, IVA 5 % e IVA 10 %.
- El criterio 8 posiblemente requiere ajustar el `z-index` o el comportamiento de `overflow` en el componente de tabla del design system.
