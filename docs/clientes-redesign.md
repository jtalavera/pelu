# Clientes — rediseño minimalista

Parte del rediseño general (Inicio, Catálogo, Agenda, Resumen…). Mismo sistema: una acción principal, lo raro plegado, interruptores en lugar de menús.

## Lista (`/app/clients`)
- Título, **+ Nuevo cliente** y menú ⋯ (solo "Exportar").
- Buscador y tres filtros: **Todos**, **Activos**, **Nuevos este mes** (se quitó "Con RUC").
- Cada fila: iniciales, nombre, `teléfono · Última visita …` y un **interruptor** activo/inactivo
  (desactivar pide confirmación; reactivar es directo). Tocar la fila abre la ficha.
- Los avisos de éxito (creado, actualizado, activado, desactivado) son un `Toast` de 4 s.

## Nuevo cliente
Solo **nombre y teléfono**. "Más opciones" despliega correo, tipo y número de documento, tipo de
contribuyente, dirección, departamento/ciudad, cumpleaños y cómo nos conoció.

## Ficha (`/app/clients/:id`)
- Encabezado simple: nombre, una línea `N visitas · Última visita …` y, a la derecha del nombre, el
  interruptor **Activo / Inactivo** (visible desde cualquier pestaña; desactivar pide confirmación,
  reactivar es directo; actúa de inmediato, sin "Guardar"). Ya no hay enlace rojo "Desactivar cliente".
- Botones: **Llamar** (`tel:`, **solo en teléfonos y tablets**, según `isMobileDevice()`), **WhatsApp**
  (misma solución que el envío del KuDE, `lib/whatsappShare`: en escritorio abre WhatsApp Web directo
  y reutiliza una pestaña; en celular abre la app) y **✦ Ver historial del cliente** (acento naranja).
- Barra de pestañas como en la maqueta: contenedor suave, pestaña activa "elevada" en blanco; la última
  lleva el único acento naranja. Pestañas (`?tab=`): **Datos** (por defecto, sin parámetro), **Turnos**
  (`appointments`), **Facturas** (`invoices`), **Ficha técnica** (`sheet`) y **✦ Historial**
  (`radiography`, resumen del cliente).
  - **Datos**: nombre, teléfono y correo; "Datos fiscales" y "Perfil" plegados; Cancelar/Guardar.
  - **Turnos** y **Facturas**: listas compactas de una fila (~44 px): `fecha · servicio · profesional`
    con el estado, y `fecha · #número · estado` con el monto. El próximo turno va resaltado como primera
    fila de la misma tarjeta. Cargan al abrir la pestaña; "Ver más" pagina.
  - **Ficha técnica**: notas y fórmula de color.
  - **Historial** (resumen del cliente): visitas, gasto 12 meses y ticket promedio; servicios que más se
    hace (barras); quiénes la atienden (%); últimos servicios. Usa `topServices` y `professionalRanking`
    de `/api/clients/{id}/summary` (todo el historial de fichas cerradas, máx. 5 por ranking).
- Guardar, desactivar o reactivar cierra la ficha y vuelve a la lista con el aviso de éxito
  (`location.state.notice`).

## Tests
Vitest actualizado (`ClientsPage.test.tsx`, `ClientDetailPage.test.tsx`) y `i18n/locales.test.ts`, que falla si un archivo de traducción tiene claves duplicadas (una clave repetida pisa el objeto anterior en silencio) o si la sección de clientes difiere entre es/en. Los specs de Playwright se
adaptan en la pasada final tras el rediseño de Configuración.
