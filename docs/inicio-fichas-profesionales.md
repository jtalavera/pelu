# Inicio: fichas de hoy como tarjetas y acceso de las profesionales

## Admin
- "Fichas de servicio de hoy" ya no está plegada dentro de "Más del día": es una tarjeta del Inicio con un contador de
  **abiertas** (`TodayServiceRecords`).
- Cada ficha es una tarjeta (opción A de la maqueta): iniciales, cliente en grande, hora y profesionales, servicios como
  etiquetas, monto grande y **Cobrar** en la misma tarjeta. Las **abiertas** llevan borde ámbar y sombra y van primero;
  cobradas y anuladas son más discretas (estado + monto) y sin botón. Toda la tarjeta abre el detalle; el máximo son 12 con "Más".
- "Más del día" queda con Ocupación, Cumpleaños y Clientes inactivos.

## Profesionales (con clave y dispositivo compartido con PIN)
- El **Inicio** pasa a ser su primera pantalla (al iniciar sesión y al entrar con PIN) y está en su menú arriba de Agenda.
  Las pantallas de admin y de "Mis comisiones" en sesión PIN las devuelven al Inicio (antes, a la Agenda).
- Ve **todas** las fichas **abiertas de hoy** (día del salón, `America/Asuncion`), sin montos ni botón Cobrar.
- Al tocar una tarjeta se abre la ficha: puede **agregar, cambiar y quitar servicios y cantidades** (y elegir la
  profesional de cada línea). No ve precios, totales ni propinas, y no puede anular ni cobrar. Las sugerencias de
  servicios no muestran precio.

## Backend (`ServiceRecordController` / `ServiceRecordService`)
- `ProfessionalAccessPolicy` permite `GET /api/service-records`, `GET /api/service-records/{id}` y
  `PUT /api/service-records/{id}` (también en sesión PIN). Crear y anular siguen respondiendo 403.
- Para una profesional el servidor aplica las reglas (no depende de lo que muestre la pantalla):
  - la lista devuelve solo fichas `OPEN` de hoy; el detalle de otra cosa responde 404 / 409 `SERVICE_RECORD_NOT_OPEN`;
  - los montos (`totalAmount`, `tipsTotal`, `unitPrice`, `lineTotal`, propinas, RUC) salen en `null` / vacío;
  - al guardar se ignoran cliente, precios y propinas del cuerpo: un servicio que se mantiene conserva su precio, uno
    nuevo toma el precio del catálogo y una propina solo se descarta si su profesional ya no figura en ninguna línea.
- Las demás rutas (facturación, caja, propinas, resumen…) siguen vedadas.

## Tests
JUnit: `ServiceRecordServiceTest`, `ProfessionalAccessPolicyTest`, `PinSessionSecurityTest`. Vitest:
`TodayServiceRecords.test.tsx`, `ServiceRecordEditor.test.tsx`. Playwright: `inicio-fichas-profesional.spec.ts` (admin,
profesional con clave, API y dispositivo con PIN); `hu-24`, `hu-66`, `hu-03`, `hu-68`, `issue-53/120`,
`responsive-vista-profesional` actualizados al nuevo aterrizaje.
