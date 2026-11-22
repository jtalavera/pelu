# HU-AST-03 · Proponer y emitir una factura desde el chat

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| **ID**     | HU-AST-03                                                                          |
| **Módulo** | Asistente conversacional                                                           |
| **Estado** | `In Progress`                                                                      |
| **Flag**   | `ASSISTANT_CHATBOT`                                                                |
| **Plan**   | [Plan de implementación del asistente](../asistente/plan_asistente.md) · fase 2    |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** pedirle al asistente que facture a un cliente y revisar la factura antes de emitirla,  
**para** facturar rápido sin armar el comprobante a mano y sin riesgo de que se emita algo que no revisé.

---

## Contexto

Principio de todo el asistente: **el modelo propone, la persona confirma**. El modelo solo puede preparar un **borrador** (`proponer_factura`) que vive únicamente en el chat; no tiene ninguna herramienta que emita. Emitir es un botón de la tarjeta («Confirmar y emitir», un endpoint normal) que usa el **mismo camino** que Facturación (`InvoiceEmissionService`: con o sin SIFEN, caja abierta, timbrado, etc.). Los precios, los totales y los nombres salen del catálogo, de la ficha y del sistema, nunca del texto del modelo. Solo administración factura: `/api/invoices` es solo de administración y el asistente no ofrece la herramienta a otros roles.

---

## Criterios de aceptación

1. **Borrador — Solo en el chat.** Pedir «facturale a <cliente>» deja una tarjeta de borrador con el cliente, los servicios, sus precios y el total. No se emite ninguna factura hasta confirmar.
2. **Qué se factura — La ficha abierta.** Sin indicar servicios, el borrador toma la ficha abierta del cliente (sus servicios y precios); si no hay ficha, su único turno de hoy; con varios turnos o ninguno, el asistente lo pregunta.
3. **Qué se factura — Servicios indicados.** Con servicios indicados («facturale a <cliente> por <servicio>») usa el catálogo con su precio vigente. Los importes se ven como en el resto de la app: `Gs. 110.000` (punto de miles, sin decimales).
4. **Datos que faltan — Se completan en la tarjeta.** Medio de pago con botones (efectivo, débito, crédito, transferencia); la tarjeta pide la marca si es con tarjeta; con SIFEN y receptor identificado, pide el email. «Confirmar y emitir» queda deshabilitado y la tarjeta dice qué falta hasta completarlo.
5. **Cambios — Reemplazan el borrador.** Pedir otra cosa por chat crea un borrador nuevo; el anterior queda atenuado («Reemplazado») y ya no se puede confirmar. Solo hay un borrador activo por conversación.
6. **Descartar — Botón o chat.** «Descartar» en la tarjeta, o pedirlo por el chat, deja el borrador atenuado («Descartado») sin emitir nada.
7. **Vencimiento — 24 horas.** Un borrador no confirmado en 24 h vence: la tarjeta se ve atenuada («Vencido») y confirmarlo da un error traducido.
8. **Confirmar y emitir — Por el camino existente.** El botón emite la factura (sin SIFEN, un comprobante no fiscal) con su número; la tarjeta pasa a verde («Factura N.° … emitida»), y la factura aparece en el historial de Facturación con los mismos importes. Si falta algo (por ejemplo la caja cerrada), el error aparece traducido en la tarjeta y el borrador sigue siendo confirmable.
9. **Doble toque — No emite dos veces.** Dos confirmaciones del mismo borrador (aunque lleguen a la vez) emiten una sola factura; la segunda responde 409 `ASSISTANT_DRAFT_ALREADY_CONFIRMED` con el resultado original.
10. **Revalidación — Si cambió un precio.** Si el precio cambió entre la propuesta y la confirmación, no se emite: la tarjeta muestra el total recalculado y pide revisarlo y confirmar de nuevo.
11. **Solo el botón — Un «sí» no emite.** Escribir «sí», «dale» o «confirmá» en el chat no emite nada.
12. **Solo administración.** Una profesional que pide facturar recibe la explicación de que es solo para administración, no se crea ningún borrador y tampoco puede confirmar uno.
13. **Persistencia — Al recargar.** Al recargar la página y reabrir el asistente, la tarjeta del borrador (o la de la factura emitida) sigue ahí, con su estado.
14. **Aislamiento — Por salón y por persona.** Un borrador es de quien lo pidió, en su salón: nadie puede confirmarlo, completarlo ni descartarlo con solo conocer su identificador, y el asistente no arma borradores con clientes de otro salón.
15. **Precios editables — Como en Facturación.** En el borrador, cada línea muestra su precio unitario en un campo editable (mismo formato de guaraníes que Facturación: `50.000`). Al guardarlo (salir del campo o Enter) el sistema recalcula la línea y el total, y la línea queda marcada «Editado». El precio debe ser un monto entero mayor a cero: si no, se muestra el error con un ejemplo (`50.000`) y no se envía nada. Lo emitido usa el precio escrito aunque el catálogo cambie después (no cuenta como «cambió el precio»), y la tarjeta ya emitida o atenuada no se puede editar.
16. **Precio dicho en el pedido — Llega precargado.** Si la persona ya dijo el precio de un servicio en el mensaje («facturale a <cliente> por <servicio> a 45.000»), ese valor llega al borrador como precio unitario de esa línea, ya marcado «Editado» y editable como en el AC15; los servicios sin precio dicho siguen con el del catálogo. El asistente nunca inventa ni deduce un precio que la persona no dijo, y un precio inválido o de un servicio que no está en la factura no genera borrador (el asistente lo explica).
17. **Descartar un ítem — Quitarlo del borrador.** Cuando el borrador tiene más de un ítem, cada uno trae un botón «Quitar» (junto a su precio). Al quitarlo desaparece de la tarjeta, el total y el pago se recalculan, y lo que se emite no lo incluye (si el borrador salía de una ficha, el ítem quitado no vuelve al volver a calcular al confirmar, ni se toma como «cambió el precio»). Siempre queda al menos un ítem: con uno solo no hay botón «Quitar» (y la API responde 400 `ASSISTANT_DRAFT_LAST_LINE`); para no facturar se descarta el borrador. Al recargar, el ítem sigue quitado.
18. **Productos — Se facturan como los servicios.** Una factura puede llevar servicios y productos (ids de `listar_servicios` y `listar_productos`), con cantidad («2 shampoos»). La tarjeta, el precio dicho, la edición del precio y el quitar ítems funcionan igual con productos, y al emitir se usa el mismo camino de siempre (comisiones y descuento de stock incluidos).
19. **Agregar ítems — Al borrador en curso, sin perder lo editado.** «Agregale dos shampoos» agrega servicios o productos al borrador activo (herramienta `agregar_item_a_borrador`): aparece una tarjeta nueva y la anterior se atenúa. Se conserva lo que la persona ya hizo en la tarjeta (precios editados, ítems quitados, medio de pago, email). Si el ítem ya estaba, suma cantidad a su precio actual. Si no hay un borrador de factura activo, el asistente lo dice y pide el cliente. Si el borrador salía de una ficha o turno, lo agregado se mantiene al volver a calcular al confirmar.

20. **Sin indicar qué cobrar — Primero la ficha.** Pedir «facturale a <cliente>» o «facturemos los servicios de <cliente>» sin nombrar ítems llama de inmediato a `proponer_factura` sin ítems: el asistente no pregunta qué cobrar ni lista el catálogo antes. El borrador sale de la ficha abierta del cliente o de su único turno de hoy; solo si no hay nada que cobrar (`NOTHING_TO_INVOICE`) el asistente dice que no tiene ficha abierta ni turno hoy y pide qué cobrar. _La instrucción al modelo real se verifica a mano; el Playwright cubre el borrador desde la ficha (AC2) y un test del prompt cubre el texto de la regla._

---

## Fuera de alcance

- Facturar varios turnos de clientes distintos en un solo borrador (una factura por turno).
- Clientes con exoneración diplomática: el asistente indica que esa factura se hace desde Facturación (el IVA cambia el total).
- Cambiar la fecha de emisión, descuentos, propinas o varios pagos: se hacen desde Facturación.

## Notas

- Con SIFEN, el borrador pide el email si el receptor está identificado y la emisión pasa por el mismo camino (certificado vigente, firma, cola de envío). El estado de SIFEN (por ejemplo «Enviada a SIFEN») se muestra en la tarjeta. Ese caso está cubierto por tests unitarios y de integración; no tiene test de Playwright porque requeriría un certificado de SIFEN en el entorno e2e.
- El vencimiento a las 24 h se prueba en Playwright adelantando el vencimiento con un endpoint de apoyo solo del perfil `e2e` (`/api/admin/assistant-test-support`).
- La auditoría registra la emisión como `invoices`/`issue` con origen `ASSISTANT` (columna `audit_log.source`, V106).
- Endpoints: `POST /api/assistant/drafts/{id}/confirm` (`Idempotency-Key` = id del borrador), `POST …/discard`, `PATCH …/{id}`.
