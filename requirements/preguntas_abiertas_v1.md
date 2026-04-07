# Preguntas abiertas (producto) · v1

Documento vivo: decisiones pendientes que no están cerradas en el PRD ni en **Definiciones transversales** de [femme_historias_usuario_mvp_v1.md](prds/femme_historias_usuario_mvp_v1.md). Cuando se resuelvan, conviene trasladar la decisión al PRD y archivar o actualizar este archivo.

---

## Timbrado y numeración

1. **Cambio de timbrado activo** — Al desactivar un timbrado que ya tuvo emisiones y activar otro: ¿cómo se reflejan huecos, reportes de ventas y reimpresiones? ¿El número de inicio del nuevo timbrado es siempre independiente del anterior?
2. **Facturas anuladas en “facturado”** — Confirmar si el total **facturado** del dashboard (y reportes) **excluye** siempre comprobantes anulados o si debe existir un desglose.

---

## Agenda y calendario

1. **Horario de la profesional vs. turno** — ¿Un turno debe poder crearse **solo** dentro del horario cargado en HU-05, o basta con no solapar (pudiendo agendar fuera de horario con advertencia)?
2. **Horario del salón** — ¿Existe un horario global del local (apertura/cierre) que limite el calendario, o las franjas son solo presentación (p. ej. 24 h)?
3. **Transiciones de estado del turno (HU-08)** — Matriz permitida entre Pendiente, Confirmado, En curso, Completado, Cancelado, No asistió (p. ej. ¿“Completado” puede revertirse?).
4. **Edición en “En curso” (HU-09)** — Si un turno pasó a “En curso” por error, ¿debe poder reagendarse/editarse o solo cancelarse?

---

## Facturación y caja

1. **Anulación vs. día y caja (HU-17)** — Aclarar la regla exacta: ¿anulación solo el mismo día civil? ¿Solo hasta cerrar la caja del día? ¿Prohibición explícita para comprobantes de días anteriores?
2. **Múltiples métodos de pago (HU-15)** — Cómo se muestran en el **PDF** y en el **resumen de cierre de caja** (líneas por método vs. total único).
3. **Moneda y redondeo** — Moneda única (asunción PYG), uso de decimales, redondeo en descuentos porcentuales y totales.

---

## Autenticación

1. **Recuperación de contraseña** — Duración y uso único del token, política de reenvío, comportamiento si el email no existe en el sistema (mensaje genérico).

---

## Cliente ocasional

1. **Identificador genérico** — Detalle de implementación deseado: ¿valor fijo por tenant conocido por el front, UUID interno solo servidor, o convivencia con un registro “Cliente ocasional” en tabla? (La regla de negocio “id genérico” ya está definida; falta el contrato técnico.)

---

## Otros

1. **Límite de categorías de servicio** — ¿Número máximo, nombres únicos por tenant, o sin límite explícito?
2. **Visitas en listado de clientes (HU-12)** — Definición exacta de “cantidad de visitas” (turnos completados, turnos totales, comprobantes, etc.).