# Reserva online (pista A)

Especificación: `requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md` (historias HU-RSV-*).
Este documento recoge lo que ya está construido y las decisiones que no se ven en el código.

## Estado

| Incremento | Estado |
| ---------- | ------ |
| **A0** esqueleto | Implementado: flag `ONLINE_BOOKING`, `BookingAccess`, `booking_settings` (V113), ruta pública `/r/:slug`, `api/publicBooking.ts` |
| A1 (RSV-01) bloqueos y cierres | Pendiente |
| A2 (RSV-02) configuración | Pendiente (hoy la dirección y «Aceptar reservas» se fijan solo con el endpoint de soporte e2e) |
| A3 (RSV-03 y 04) página con horarios | Pendiente |
| A4 (RSV-05) reserva completa | Pendiente |
| A5 (RSV-06) gestión por enlace | Pendiente |
| A6 (RSV-07 y 10) aprobación, QR y origen | Pendiente |

## Piezas de A0

- **Tabla `booking_settings`** (una fila por salón): `slug` (dirección pública, único en toda la plataforma mediante un
  índice único filtrado; los salones sin dirección no entran) y `accepting_bookings` («Aceptar reservas», apagado por defecto).
- **`BookingSlug`**: 3–40 caracteres `[a-z0-9-]`, sin guion al inicio ni al final ni doble, y sin palabras reservadas
  (`admin`, `api`, `app`, `login`, `r`…).
- **`PublicBookingResolver`**: el salón se resuelve **solo por la dirección** (RT-02). Dirección inexistente o malformada, flag
  apagado (global, del tier o del salón), salón suspendido o «Aceptar reservas» apagado dan **la misma respuesta**
  `{"available": false}` con `200` (RT-01): lo público no puede distinguir cuál fue el caso.
- **`GET /api/public/booking/{slug}`**: `permitAll`; devuelve solo `available` y `businessName` (RT-03) con `Cache-Control: no-store`
  para que apagar las reservas corte la página al instante. No se audita (`/api/public/` está excluido de `audit_log`: no hay usuario).
- **`BookingConfig`**: `app.femme.booking.token-secret` (Key Vault `app-femme-booking-token-secret`, mínimo 32 caracteres) para
  firmar los enlaces de gestión (A5); sin él, `BOOKING_NOT_CONFIGURED`. La dirección base de los enlaces es la que ya existe,
  `app.frontend.url` / `APP_FRONTEND_PRIMARY_URL`: `<base>/r/<slug>`.
- **Frontend**: `PublicBookingPage` en `/r/:slug`, fuera de `ProtectedRoute`; el cliente HTTP público no envía credenciales ni
  conoce la sesión. En A0 muestra el nombre del salón («Muy pronto vas a poder reservar…») o la página neutra.
- **Soporte e2e**: `POST /api/admin/booking-test-support/settings` (solo con `femme.data-init.enabled=true`) fija dirección y
  «Aceptar reservas» del salón de quien llama, hasta que exista la pantalla de A2.

## Migraciones de la pista A

C4 usó V112, así que la pista A se corrió: **V113** `booking_settings` (A0), **V114** bloqueos y cierres (A1), **V115**
configuración completa y servicios reservables (A2), y para A4 y A5 los números libres **V119–V122**. B conserva V116–V118.

## Pendiente de verificar

- Producción: crear el secreto `app-femme-booking-token-secret` en Key Vault (ver `infrastructure_v2/infrastructure_v2.md`).
- Con el slug en `booking_settings` ya existe la dirección del salón, pero la clienta todavía no puede reservar: eso llega con A3 y A4.
