# Fichas de servicio — rediseño minimalista

Parte del rediseño general. Mismo sistema: una acción principal por estado, lo raro plegado, avisos pasajeros.

## Lista (`/app/service-records`)
- Título, **+ Nueva ficha**, buscador (cliente o servicio) y chips **Abiertas** (por defecto, lo
  pendiente de cobrar), **Hoy** y **Todas**. "Filtros" (desde, hasta, estado; máx. 6 meses) está plegado.
  Se eliminaron las pestañas Nueva ficha / Historial y los botones "Actualizar" y "Limpiar filtros".
- Cada fila: iniciales, cliente, `fecha/hora · servicios · profesionales` y total. Las **abiertas**
  tienen el botón **Cobrar**; las demás muestran "Cobrada" o "Anulada".
  El listado del backend (`GET /api/service-records`) suma `servicesSummary` y `professionalsSummary`.
- **Cobrar** desde la fila abre Facturación con la ficha lista (`lib/serviceRecordBilling.ts`).
- Tocar una fila abre la ficha en un diálogo. Guardar o anular cierra el diálogo y un `Toast` de 4 s lo
  confirma en la lista. El enlace "Ver historial" del Inicio abre la lista en **Todas**.

## Ficha (diálogo)
- **Cabecera**: título "Ficha de servicio" y, a su lado, el **estado destacado** (● Abierta en ámbar, ● Cobrada en verde,
  ● Anulada en gris; `ServiceRecordStatusPill`). Para poder poner el chip junto al título, `Modal.title` del sistema de
  diseño acepta ahora un nodo además de texto (cambio de tipo, sin cambios visuales para el resto).
- **Cliente**: en una fichas ya creada, una sola línea `CLIENTE · nombre ....... fecha`. En una ficha nueva, el
  buscador (o crear cliente; al volver queda elegido). Una ficha existente ya no permite cambiar de cliente.
- **Servicios en filas en línea, sin cajas anidadas**: `SERVICIO · PROFESIONAL · CANT. · PRECIO · SUBTOTAL · ✕` con los
  títulos de columna una sola vez y una línea fina entre filas (en celular cada servicio se apila en dos renglones).
  La ✕ solo aparece con más de un servicio. Después: "+ Agregar otro servicio" y el **Total**.
- **Propinas**: sección plegada con el mismo estilo de título que CLIENTE y SERVICIOS (ya no se llama "Más opciones"); al abrirla,
  un campo en línea por profesional (`Propina · Laura  [  0 ]`), de a dos por fila en pantallas anchas.
- **Pie**: ficha **abierta** → **Anular ficha** a la izquierda (abre el motivo en el mismo lugar) y **Cerrar / Guardar /
  Cobrar** a la derecha. Ficha nueva: Cancelar / Guardar. Cobrada o anulada: solo lectura con el comprobante o el motivo.
- Guardar o anular cierra el diálogo y un `Toast` de 4 s lo confirma en la lista.

## Tests
Vitest: `ServiceRecordsPage.test.tsx`, `ServiceRecordEditor.test.tsx`; JUnit: `ServiceRecordServiceTest`.
Los specs de Playwright se adaptan en la pasada final tras el rediseño de Configuración.

## Ajuste: lista compacta y detalle más angosto

- Lista: filas de una línea (avatar 36 px, nombre, `fecha · servicios · profesionales`), monto a la derecha ("—" si no hay servicios, con "Sin servicios") y "Cobrar" como botón de solo borde junto al monto. En celular el botón pasa a la línea de abajo.
- Detalle: diálogo `max-w-xl`. Cada servicio ocupa dos renglones: servicio a todo el ancho y, debajo, Profesional | Cant. | Precio | subtotal | ✕ con rótulos pequeños. Se elimina la fila de cabeceras en mayúsculas que chocaba con el título "Servicios".

## Ajuste: servicios plegables en el detalle
Cada servicio de la ficha es una tarjeta con borde (sin relleno): una fila resumen con número, nombre, `profesional · cant × precio` y subtotal, que se abre/cierra con un toque (`service-record-line-toggle`, `aria-expanded`). Abierta muestra servicio, profesional, cantidad, precio y "✕ Quitar". Por defecto está abierta si es el único servicio, si aún no tiene servicio elegido o si tiene un error de validación; el usuario puede cerrarla igual (salvo con error). Con varios servicios ya cargados arranca plegada.
