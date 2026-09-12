# Marketing value propositions & feature roadmap

**Date:** 2026-09-11
**Status:** Approved (positioning, pillars, backlog, messaging)
**Scope:** Go-to-market value propositions for Femme/Pelu as a SaaS for small/medium
Paraguayan hair salons and barbershops, plus a short list of easy-to-build features
that strengthen the pitch. Explicitly out of scope: pricing/packaging, channel-by-channel
campaign tactics, and full launch sequencing (see "Non-goals").

## Context

- **Market:** small/medium hair salons and barbershops in Paraguay.
- **Target segment:** businesses with no software at all, or only very basic tools
  (paper, WhatsApp, Excel).
- **Business stage:** a few pilot customers already using the product.
- **Sales motion:** a mix of direct/in-person + WhatsApp follow-up, social media,
  and referrals from existing pilots — no single channel is primary.
- **Pilot signal:** what has actually converted pilot salons so far is fear/urgency
  around SIFEN (electronic invoicing) becoming mandatory, not the day-to-day
  scheduling/cash features. Those features matter for retention, not for the initial
  "why should I try this" conversation.
- **Competitive landscape:** the real competition is inertia (paper, WhatsApp,
  Excel, or nothing). There are also generic international scheduling/booking apps
  in use by some salons, but none of them handle Paraguayan tax compliance or SIFEN.
  **Per explicit instruction: no specific competing product should ever be named in
  marketing copy or in this document.** The differentiation is expressed structurally
  ("built from the ground up for Paraguayan salons, with local taxes and SIFEN at the
  core") rather than by naming any other product.
- **Pricing/packaging:** fully open — not addressed here.

## Positioning statement

> El primer sistema de gestión hecho para peluquerías y barberías paraguayas — no
> un genérico adaptado de otro lado, y ya preparado para cuando la factura
> electrónica sea obligatoria.

SIFEN readiness is the wedge that gets the first meeting — it's the only value prop
tied to genuine urgency and the only one no generic tool can match. The day-to-day
features (caja, turnos, propinas, ficha de servicio) are what makes a salon *stay*
once the fear-based sale is done; they should be secondary in top-of-funnel
messaging and primary in retention/upsell messaging.

## Value-prop pillars

Each pillar is grounded in a feature that ships today (not aspirational).

| # | Pillar | Feature (today) | Pain it solves | Message |
|---|--------|------------------|-----------------|---------|
| 1 | Facturación electrónica SIFEN | Certificado fiscal, KuDE, corrección/reenvío de facturas rechazadas, inutilización de numeración | Owners fear the mandate and don't know how they'll comply | "Cuando la SET te obligue, vos ya vas a estar facturando electrónicamente hace meses — sin sustos, sin multas, sin carreras de último momento." |
| 2 | Caja diaria + multi-pago + historial | Apertura/cierre de caja, múltiples métodos de pago, historial de comprobantes | "No sé cuánto entró hoy" / manual reconciliation | "Abrí y cerrá caja todos los días sabiendo exactamente cuánto entró, por qué medio, y quién cobró." |
| 3 | Turnos y calendario | Calendario por profesional, agendar/reagendar, cambio de estado de turno | Double-booked chairs, turnos perdidos en WhatsApp, no-shows | "Un calendario por profesional, sin choques de horario, sin depender de que alguien se acuerde de anotar el turno en un cuaderno." |
| 4 | Ficha de servicio | Registro de servicio por cliente (qué se hizo, productos, precio) | No memory of what was done last time; relies on staff memory | "Cada corte, color o servicio queda registrado — tu equipo atiende como si conociera a cada cliente de toda la vida." |
| 5 | Propinas — reporte y control | Reporte de propinas por profesional, retiros | Disputes between owner/staff about tips, no visibility | "Transparencia total en propinas: cada profesional ve lo suyo, vos ves todo, sin discusiones a fin de mes." |
| 6 | PIN de acceso por profesional | Login por PIN en dispositivo compartido | Shared tablet on the floor, but not every stylist needs a full login | "Cada profesional entra con su PIN en la tablet del salón — ve su agenda y sus clientes, sin necesidad de una cuenta para cada uno." |

## Easy-to-add feature backlog

Ordered by effort, using what already exists in the codebase today (ACS email is
already wired for KuDE/password-reset notifications; KuDE PDF generation already
exists; client and service-record history already exist; there is currently no
WhatsApp/SMS integration and no public unauthenticated booking flow).

### Quick wins (days, no new integrations)

1. **Compartir comprobante por WhatsApp** — a "Enviar por WhatsApp" action next to
   the existing email option on an invoice, using a `wa.me` deep link with the
   already-generated KuDE. No backend work beyond wiring the link.
   *Message:* "Mandale la factura al cliente por WhatsApp al toque."
2. **Clientes inactivos / cumpleaños** — a dashboard widget or simple report
   querying existing client + service-record data (clients with no visit in 60+
   days, birthdays this month). No new data model.
   *Message:* "El sistema te dice a quién llamar para que vuelva, en vez de perder
   al cliente sin darte cuenta."
3. **Lista de precios compartible** — render existing `Servicios` data as a
   shareable image/PDF for the salon's own social media.
   *Message:* "Tu lista de precios siempre actualizada, lista para compartir."

### Small feature (1–2 weeks)

4. **Recordatorio de turno por email** — a scheduled job + template reusing the
   existing ACS email service, sent ~24h before a turno. Directly sellable as a
   no-show-reduction metric.
   *Message:* "Menos ausencias: tu cliente recibe un recordatorio automático antes
   de su turno."
5. **Dashboard con gráficos** — the main dashboard today (`DashboardPage.tsx` /
   `DashboardService`) shows plain numeric cards only; no chart library is
   installed and no time-series queries exist yet. None of the following need a
   new table — they're new aggregate queries over data already recorded:
   - **Tendencia de facturación** (14/30 días) — line/area chart from `Invoice`,
     grouping the sum that's already computed by day instead of by a single range.
     The natural hero chart for the page.
   - **Servicios más vendidos** — bar chart from `InvoiceLine` grouped by service.
   - **Mezcla de medios de pago** — donut/bar from `InvoicePaymentAllocation` /
     `PaymentMethod`.
   - **Turnos por día de semana/hora** — bar chart or heatmap from
     `Appointment.startAt`, useful for staffing decisions.
   - **Propinas por profesional** — bar chart reusing the existing Propinas report
     data; reinforces pillar 5 (transparencia en propinas).

   Needs a charting library (none installed today — `recharts` is the practical
   choice for a React frontend) plus the new grouped queries above. Real but
   bounded effort: existing entities, no new integrations, no new data model.
   *Message:* "Un vistazo y ya sabés cómo va tu semana: cuánto facturaste, qué se
   vendió más, cómo te pagan tus clientes."
   *Why it matters beyond the dashboard itself:* a good-looking dashboard is also
   a sales-demo asset — it's what a prospect sees in the first seconds of a demo,
   and it visually signals "sistema real" rather than "otra planilla".

### Phase 2 (real effort — new paid integration)

6. **Recordatorio de turno por WhatsApp** — same idea as #4 but via WhatsApp,
   which is new infrastructure and a per-message cost, not a reuse of existing
   plumbing. Despite WhatsApp being the dominant channel for this market, email
   should ship first since it captures most of the no-show-reduction benefit at
   near-zero incremental cost.

   **Integration decision (2026-09-11): go directly with Meta's WhatsApp Cloud
   API (via Embedded Signup), not a BSP like Twilio.** Reasoning: a BSP's markup
   compounds with volume and this market is price-sensitive; Meta's own
   Embedded Signup now gives a self-serve onboarding path that used to be a BSP's
   main advantage; and the team already built the SIFEN integration (certificates,
   XML signing, government web services, correction/void flows), which is a
   harder integration than a REST API + webhook against Meta's Graph API — so the
   "BSP saves engineering effort" argument doesn't hold here. Accepted trade-off:
   no BSP support escalation path if the WhatsApp Business Account gets flagged
   or rate-limited — Meta's own support for small senders is hard to reach. This
   risk is accepted rather than paid for upfront, and only reconsidered if it
   actually causes a problem in production. Either path requires the same real
   phone number to be registered to a WhatsApp Business Account (ideally a
   Paraguay +595 number so clients recognize the sender) — the number rule is
   BSP-independent.

**Explicitly rejected for this backlog:** a public self-service booking page
(clients booking their own turno without staff involvement). Considered during
brainstorming but declined by the product owner — not part of the roadmap.

## Messaging one-liners

Ready to paste into ads/WhatsApp/social copy. No competing product is named
anywhere in this messaging, per explicit instruction — differentiation is always
expressed as "built for Paraguay from the ground up," never by naming or alluding
to a specific alternative.

**Anchor line (top of funnel — the SIFEN wedge):**
> "¿Tu peluquería ya está lista para facturar electrónicamente? Cuando la SET lo
> haga obligatorio, más vale que no te agarre corriendo."

**"Not generic" framing:**
> "No es un sistema genérico de turnos ni de facturación adaptado de cualquier
> lado. Es un sistema pensado desde cero para peluquerías y barberías
> paraguayas, con los impuestos locales y la factura electrónica (SIFEN) en el
> corazón del producto, no como un agregado."

**Pain-first variant (social/organic):**
> "Dejá el cuaderno y el WhatsApp desordenado. Turnos, caja, propinas y
> facturación electrónica, todo en un solo lugar hecho para peluquerías
> paraguayas."

**Per-pillar one-liners:**
- Caja: "Cerrá el día sabiendo exactamente cuánto entró y por qué medio, sin
  sumar todo a mano."
- Turnos: "Un calendario por profesional. Se acabaron los turnos pisados."
- Ficha de servicio: "Cada corte y color queda anotado. Tu equipo atiende como
  si conociera al cliente de toda la vida."
- Propinas: "Cada profesional ve lo suyo. Cero discusiones de fin de mes."
- PIN de acceso: "Cada estilista entra con su PIN en la tablet del salón. Sin
  cuentas complicadas."

**Retention/quick-win features (for existing customers):**
- "Mandá la factura por WhatsApp con un toque."
- "El sistema te avisa qué clientes no vuelven hace rato — llamalos antes de
  perderlos."
- "Recibí un recordatorio automático antes de cada turno. Menos ausencias, más
  plata."

## Non-goals

- Pricing and packaging (tiers) — left fully open, not addressed by this document.
- Channel-by-channel campaign plan and budget allocation.
- Campaign sequencing/timeline tied to a specific SIFEN mandate date.
- Naming or comparing against any specific competing product, in this document or
  in any resulting marketing copy.

## Next steps

The quick-win and small-feature backlog items (1–4) are small enough to be
implemented directly through the normal development workflow when the user is
ready to build them — no separate implementation plan is required for this
document to be considered complete.
