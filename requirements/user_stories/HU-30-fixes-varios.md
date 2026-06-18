# HU-30 · Fixes varios

| Campo      | Valor                        |
| ---------- | ---------------------------- |
| **ID**     | HU-30                        |
| **Módulo** | Varios (front + back)        |
| **Estado** | `In Progress`                |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** mejoras puntuales en la interfaz de comprobantes, tablas de datos, gestión de profesionales y el perfil del usuario logueado,  
**para** mejorar la usabilidad, la consistencia visual y la experiencia en los flujos de trabajo frecuentes.

---

## Criterios de aceptación

1. **Comprobantes — limpieza completa del formulario** — Luego de emitirse un nuevo comprobante, todos los campos del formulario de comprobantes se limpian, incluyendo el listado de Ítems.

2. **Datos semilla — eliminación de GABRIELA** — El registro de GABRIELA es eliminado de la base de datos semilla.

3. **Facturación — columna "Descuento en Item" en popup Ver** — En la sección Comprobantes de hoy de la solapa Facturación, el popup que se abre al presionar el botón Ver incluye, para cada ítem, una columna nueva ubicada entre Precio Unitario y Total llamada "Descuento en Item", que muestra el tipo y valor de descuento aplicado a ese ítem.

4. **Facturación — renombrar campo "Descuento" en popup Ver** — En la sección Comprobantes de hoy de la solapa Facturación, el popup que se abre al presionar el botón Ver renombra el campo "Descuento" a "Descuento sobre factura".

5. **Impuestos — tabla con estilo Clientes y botones de acción** — La tabla de Impuestos adopta el mismo estilo visual y funcionalidades que la tabla de Clientes. Al final de cada registro se agregan 3 botones con las acciones: Editar impuesto y Desactivar.

6. **Tour de ayuda — reposicionamiento del botón** — El botón del Tour de ayuda se ubica antes del botón de Modo oscuro en la esquina superior derecha.

7. **Historial de comprobantes — tabla con estilo Clientes y botones de acción** — La tabla de Historial de comprobantes dentro de la opción Facturación en el panel principal adopta el mismo estilo visual y funcionalidades que la tabla de Clientes. Al final de cada registro se agregan 3 botones con las acciones de gestión correspondientes.

8. **Profesionales — correo de acceso internacionalizado** — El mensaje que se envía a las profesionales para el acceso a la plataforma se envía en el idioma activo al momento de editar al profesional que dispara el envío del correo. Ya no está fijo en inglés.

9. **Profesionales — acceso web responsive** — La vista de acceso para profesionales es responsive. El calendario para la carga de un turno se visualiza y opera correctamente desde dispositivos móviles.

10. **Usuario logueado — formulario de edición de perfil** — Al hacer clic en "Configuración de usuario" en el menú del usuario logueado (esquina superior derecha), se abre un formulario de edición de perfil en lugar de navegar a la opción Configuración del panel principal. El formulario permite editar: nombre, apellido, dirección, teléfono, email y foto del usuario. También incluye la opción de resetear la contraseña aplicando los mismos controles que la función "Olvidó su contraseña" en el inicio de sesión.

11. **Usuario logueado — opción "Cambiar contraseña"** — El menú desplegable del usuario logueado (esquina superior derecha) incluye una nueva opción "Cambiar contraseña". Al seleccionarla, se permite al usuario cambiar su contraseña aplicando los mismos controles de validación que la función "Olvidó su contraseña" en el inicio de sesión.

---

## Notas

- El criterio 3 extiende el popup Ver de Comprobantes de hoy (introducido en HU-29 AC-10) con una nueva columna de descuento por ítem.
- El criterio 7 requiere definir qué botones de acción son aplicables al Historial de comprobantes (por ejemplo: Ver, Anular), dado que las acciones de "Editar" y "Desactivar" propias de la tabla de Impuestos (criterio 5) no aplican directamente a un comprobante emitido.
- Los criterios 10 y 11 pueden implementarse de forma conjunta como un panel lateral o modal unificado; el criterio 11 puede ser un atajo dentro del mismo modal del criterio 10.
- El criterio 8 requiere pasar el locale activo al servicio de envío de correos en el backend.
