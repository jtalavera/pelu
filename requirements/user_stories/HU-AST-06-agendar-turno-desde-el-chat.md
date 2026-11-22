# HU-AST-06 · Agendar un turno desde el chat

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **ID**     | HU-AST-06                                                                          |
| **Módulo** | Asistente conversacional                                                           |
| **Estado** | `In Progress`                                                                      |
| **Flag**   | `ASSISTANT_CHATBOT`                                                                |
| **Plan**   | [Plan de implementación del asistente](../asistente/plan_asistente.md) · fase 3    |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** persona que atiende el salón,  
**quiero** pedirle al asistente que agende un turno y revisarlo antes de crearlo,  
**para** agendar rápido sin llenar el formulario y sin riesgo de pisar otro turno.

---

## Contexto

Igual que con las facturas: **el modelo propone, la persona confirma**. `proponer_turno` deja un **borrador** que vive solo en el chat (24 h); el turno se crea con el botón «Confirmar y agendar», por el mismo camino que la agenda (`AppointmentService.create`, estado inicial `Pendiente`). Un servicio por turno. Administración agenda con cualquier profesional; una profesional solo para sí misma.

---

## Criterios de aceptación

1. **Borrador — Solo en el chat.** Pedir «agendá a <cliente> para <servicio> mañana a las 10:00 con <profesional>» deja una tarjeta con cliente, servicio, día y hora (inicio – fin), profesional y duración. No se crea ningún turno hasta confirmar.
2. **Sin profesional — Se elige una libre.** Si la persona no indica profesional, el borrador usa una que esté libre a esa hora (prefiriendo las que ese día trabajan).
3. **Horario ocupado al proponer — Alternativas.** Si el horario ya está ocupado no se arma borrador: el asistente lo dice y ofrece horarios libres cercanos como botones.
4. **Horario ocupado al confirmar — El borrador sobrevive.** Si alguien ocupa ese horario entre la propuesta y la confirmación, no se crea el turno (409 `ASSISTANT_SLOT_TAKEN`): la tarjeta sigue como borrador, muestra el error traducido y horarios libres como botones; elegir uno mueve el borrador y se puede confirmar.
5. **Fuera del horario de trabajo — Aviso, no bloqueo.** Si el horario queda fuera del horario de la profesional, la tarjeta lo avisa y el turno igual se puede agendar (la agenda tampoco lo bloquea).
6. **Horario pasado — No se propone.** Un horario que ya pasó no genera borrador; el asistente explica que ya pasó.
7. **Cambios — Reemplazan el borrador.** Pedir otra hora u otra profesional crea un borrador nuevo; el anterior queda atenuado («Reemplazado»). Solo hay un borrador activo por conversación.
8. **Confirmar y agendar — Crea el turno pendiente.** El botón crea el turno en estado `Pendiente`; la tarjeta pasa a verde («Turno agendado») con el botón «Ver en la agenda», que abre la agenda en ese día con el detalle del turno (también si la agenda ya estaba abierta).
9. **Doble toque — No agenda dos veces.** Dos confirmaciones del mismo borrador (aunque lleguen a la vez) crean un solo turno; la segunda responde 409 `ASSISTANT_DRAFT_ALREADY_CONFIRMED`.
10. **Solo el botón — Un «sí» no agenda.** Escribir «sí», «dale» o «confirmá» en el chat no crea nada.
11. **Descartar y vencer.** «Descartar» (botón o por chat) deja el borrador atenuado («Descartado»); a las 24 h vence («Vencido») y confirmarlo da un error traducido.
12. **Profesional — Solo para sí misma.** Una profesional que pide agendar queda como la profesional del turno; si pide otra, el asistente le explica que solo puede agendar para sí misma. No puede confirmar el borrador de otra persona.
13. **Persistencia — Al recargar.** Al recargar y reabrir el asistente, la tarjeta (borrador o agendado) sigue ahí con su estado.
14. **Aislamiento — Por salón y por persona.** Nadie puede confirmar, completar ni descartar un borrador de turno ajeno con solo conocer su id, y el asistente no arma turnos con clientes, servicios ni profesionales de otro salón.

---

## Fuera de alcance

- Cancelar o reagendar turnos existentes desde el chat.
- Varios servicios en un mismo turno.
- Avisar que la profesional no realiza el servicio (no existe esa relación).

## Notas

- La auditoría registra la creación como `appointments`/`create` con origen `ASSISTANT` (columna `audit_log.source`); está cubierta por tests de integración.
- El vencimiento se prueba en Playwright con el endpoint de apoyo del perfil `e2e` (`/api/admin/assistant-test-support`).
