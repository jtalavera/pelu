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
- Encabezado: nombre, `N visitas · Última visita · Gastó Gs. X en 12 meses · Habitual: Y`
  (viene de `/api/clients/{id}/summary`) y botones de llamar y WhatsApp.
- Pestañas (`?tab=`): **Historial** (por defecto), **Ficha técnica** (`sheet`) y **Datos** (`data`).
  - **Historial**: "Próximo turno" + una sola línea de tiempo con turnos y facturas mezclados por
    fecha, con "Ver más" que pagina las dos fuentes. Tocar una factura abre su detalle.
  - **Ficha técnica**: notas y fórmula de color (sin cambios).
  - **Datos**: nombre, teléfono y correo; "Datos fiscales" y "Perfil" plegados; Cancelar/Guardar y
    el enlace "Desactivar cliente" / "Reactivar cliente".
- Guardar, desactivar o reactivar cierra la ficha y vuelve a la lista con el aviso de éxito
  (`location.state.notice`).

## Tests
Vitest actualizado (`ClientsPage.test.tsx`, `ClientDetailPage.test.tsx`). Los specs de Playwright se
adaptan en la pasada final tras el rediseño de Configuración.
