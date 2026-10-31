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
  (viene de `/api/clients/{id}/summary`) y tres botones:
  - **📞 Llamar** (`tel:`): abre el marcador del teléfono, no WhatsApp.
  - **WhatsApp**: misma solución que el envío del KuDE (`lib/whatsappShare`): en escritorio abre
    WhatsApp Web directo (sin la pantalla "app o web") reutilizando una sola pestaña; en celular abre la app.
  - **✦ Ver radiografía**: acento naranja, lleva a la pestaña Radiografía.
- Pestañas (`?tab=`): **Datos** (por defecto, sin parámetro), **Turnos** (`appointments`),
  **Facturas** (`invoices`), **Ficha técnica** (`sheet`) y **✦ Radiografía** (`radiography`).
  - **Datos**: nombre, teléfono y correo; "Datos fiscales" y "Perfil" plegados; Cancelar/Guardar y
    el enlace "Desactivar cliente" / "Reactivar cliente".
  - **Turnos**: "Próximo turno" y "Turnos anteriores" (con "Ver más"). Carga al abrir la pestaña.
  - **Facturas**: lista de facturas con estado y monto; tocar una abre su detalle. Carga al abrir la pestaña.
  - **Ficha técnica**: notas y fórmula de color.
  - **Radiografía**: visitas, gasto 12 meses y ticket promedio; servicios que más se hace (barras);
    quiénes la atienden (porcentaje por profesional); últimos servicios. Usa
    `topServices` y `professionalRanking`, campos nuevos de `/api/clients/{id}/summary`
    (todo el historial de fichas cerradas, máx. 5 por ranking).
- Guardar, desactivar o reactivar cierra la ficha y vuelve a la lista con el aviso de éxito
  (`location.state.notice`).

## Tests
Vitest actualizado (`ClientsPage.test.tsx`, `ClientDetailPage.test.tsx`). Los specs de Playwright se
adaptan en la pasada final tras el rediseño de Configuración.
