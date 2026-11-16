# HU-COM-26 · La retención pendiente se ve en Movimientos y la ficha siempre ofrece pagar y ajustar

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-26                 |
| **Módulo** | Comisiones (front)        |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Corrige y completa [HU-COM-24](HU-COM-24-retencion-en-la-ficha.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** ver en «Movimientos › Retención» también lo retenido que todavía espera aprobación, y tener siempre a mano «Pagar retención» y «Ajustar el saldo» en el Resumen de la profesional,  
**para** no ver una lista vacía cuando sí hay retención y no buscar botones que aparecen o desaparecen según haya saldo.

---

## Contexto

En la ficha de Conce, «Movimientos › Retención» mostraba el saldo en Gs. 0 y una caja blanca vacía, aunque su Resumen decía «Retenido este período: Gs. 5.000». Es correcto que el saldo sea 0 (la retención entra al saldo cuando se **aprueba la liquidación**), pero la pantalla no lo explicaba. Además, en el Resumen faltaban dos cosas del mockup aprobado de HU-COM-24: los botones «Pagar retención» y «Ajustar el saldo» (se mostraban solo si la profesional ya tenía saldo) y el subtítulo «· Retiene 5 %». No cambia ningún cálculo ni ninguna API.

---

## Criterios de aceptación

1. **Subtítulo** — Bajo el nombre de la profesional, si el salón retiene y ella tiene retención: «Cobra lo normal de cada servicio · Retiene 5 %».
2. **Botones siempre visibles** — Con la retención activa, el Resumen muestra siempre «Pagar retención» y «Ajustar el saldo», aunque la profesional todavía no tenga movimientos. Sin saldo, «Pagar retención» está deshabilitado y un texto dice por qué («Todavía no hay saldo para pagar: la retención se suma cuando se aprueba la liquidación»); «Ajustar el saldo» siempre está disponible. Lo mismo vale en «Movimientos › Retención».
3. **Ajustar desde cero** — Se puede ajustar el saldo de quien aún no tiene movimientos; al registrar el ajuste el saldo se actualiza y «Pagar retención» se habilita.
4. **Retención pendiente** — «Movimientos › Retención» muestra, arriba de los movimientos, lo que la profesional retuvo y todavía no entró al saldo como una línea gris «Pendiente · Retención de este período · sin liquidar» (o «· en un borrador, pendiente de aprobar»), con «+ Gs. X», la nota «Se suma al saldo cuando se aprueba la liquidación» y sin tocar el saldo.
5. **Al aprobar** — Cuando la liquidación se aprueba o se paga, la línea pendiente desaparece y pasa a ser un movimiento del saldo.
6. **Sin movimientos ni pendientes** — En lugar de la caja vacía hay un mensaje: «Todavía no hay movimientos de retención. Lo retenido se suma al saldo cuando se aprueba la liquidación.»
7. **Textos y estilo** — Español e inglés, tema claro y oscuro, botones de al menos 44 px.
