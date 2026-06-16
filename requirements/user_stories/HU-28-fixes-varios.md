# HU-28 · Fixes varios

| Campo      | Valor                        |
| ---------- | ---------------------------- |
| **ID**     | HU-28                        |
| **Módulo** | Varios (front + back)        |
| **Estado** | `Done`                       |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** ajustes puntuales de usabilidad en módulos de login, servicios, profesionales, calendario, facturación y dashboard,  
**para** trabajar con menos fricción y obtener información más precisa en flujos frecuentes.

---

## Criterios de aceptación

1. **Login — texto de bienvenida** — El texto que aparece debajo del título en la pantalla de login dice "Ingresa tu correo y contraseña del sistema." (reemplaza el texto anterior "Usá tu correo y contraseña de administrador").

2. **Servicios — tooltip del campo de búsqueda** — El tooltip del campo de búsqueda principal en la solapa Servicios es lo suficientemente ancho para mostrar la descripción completa sin truncarla.

3. **Profesionales — edición inline** — En la solapa Profesionales, al hacer clic sobre cualquier fila de la tabla se abre el formulario de edición de ese profesional con sus datos precargados.

4. **Calendario — alerta de disponibilidad del profesional** — Al crear un turno, si el día u horario seleccionado no coincide con el horario disponible del profesional elegido, el formulario muestra una alerta visible indicando el conflicto. La alerta es informativa: no bloquea ni impide la creación del turno.

5. **Facturación — guía de pasos completa** — La sección de ayuda en la solapa Facturación muestra los 5 pasos del flujo (actualmente muestra solo 3); se agregan los pasos 4/5 y 5/5 con su contenido correspondiente.

6. **Impuestos — gestión de tipos** — Existe una nueva entidad Impuestos en el sistema. Desde la configuración del comercio se pueden crear, editar y desactivar tipos de impuesto (por ejemplo IVA 10 %, IVA 5 %, Exento). Cada tipo tiene al menos: nombre, tasa (porcentaje) y estado activo/inactivo.

7. **Servicios — asignación de impuesto** — El formulario de creación y edición de Servicios incluye un campo para seleccionar el tipo de impuesto aplicable al servicio, que por defecto selecciona el primer tipo de impuesto activo del comercio.

8. **Facturación — descuentos por línea** — En el formulario de nuevo comprobante, cada línea de ítem permite indicar si aplica un descuento. Cuando se activa el descuento de una línea se muestran: tipo de descuento (monto fijo o porcentaje), valor del descuento y monto final con el descuento aplicado calculado automáticamente.

9. **Facturación — foco en campo con error** — Al presionar el botón "Emitir comprobante", si ocurre un error de validación de datos, la pantalla se desplaza automáticamente y el cursor se posiciona en el primer campo con error para facilitar su identificación y corrección.

10. **Dashboard — navegación al calendario** — Al hacer clic en una fecha concreta dentro del widget de Calendario del Dashboard principal, la aplicación navega a la pantalla de Calendario del menú principal mostrando los turnos correspondientes a esa fecha.

11. **Calendario — distinción visual de estados de turno** — En la vista de Calendario, los turnos en estado "Pendiente de confirmación" se muestran con borde izquierdo punteado. Los turnos en estado "Confirmado" muestran un ícono de check en la esquina superior derecha del bloque del turno.

12. **Tour inicial — persistencia en backend** — Cuando un usuario completa o cierra el tour de navegación inicial para una ventana en particular, el sistema registra ese hecho en el backend asociado al usuario. Si el mismo usuario inicia sesión desde otro navegador o dispositivo, el tour no se muestra automáticamente para las vetaas para las cuales el usuario ya vió el tour o hizo skip.

---

## Notas

- El criterio 4 es deliberadamente no restrictivo: la alerta es orientativa para el operador pero nunca debe impedir la creación del turno.
- Los criterios 6 y 7 introducen una nueva entidad (`Tax` / `Impuesto`) que requiere migración de base de datos y ajuste del endpoint de Servicios.
- El criterio 12 requiere un campo o registro en el backend (`users` o tabla asociada) para almacenar el estado del tour por usuario.
