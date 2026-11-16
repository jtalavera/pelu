# HU-COM-20 · Comisiones con reglas simples

| Campo      | Valor                     |
| ---------- | ------------------------- |
| **ID**     | HU-COM-20                 |
| **Módulo** | Comisiones (front y back) |
| **Estado** | `In Progress`             |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Reemplaza el modelo de [HU-COM-14](HU-COM-14-grupos-retencion-aguinaldo-y-monto-fijo.md) (reglas de la profesional por grupo y retención dentro de cada regla) y ajusta las pantallas de [HU-COM-15](HU-COM-15-comisiones-experiencia-rediseno.md), [HU-COM-16](HU-COM-16-configurar-grupos-y-servicios.md) y [HU-COM-18](HU-COM-18-configurar-pasos-plegados.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que el % de comisión se explique en una frase y se cargue en dos lugares (lo que paga cada grupo o servicio, y donde una profesional cobra distinto),  
**para** no tener que memorizar una lista de cinco reglas ni cruzar tres pantallas.

---

## Contexto

Mockup aprobado: «Comisiones: reglas simples». Qué costaba: cinco niveles de precedencia (incluida «profesional en el grupo», que existía solo para cargar rápido), el % de un grupo para todas no tenía dónde cargarse, la retención de aguinaldo se repetía en cada regla aunque depende de la profesional y un paso obligatorio («Reglas por profesional», «11 sin reglas») hacía parecer que faltaba algo cuando no faltaba nada.

**La regla en una frase:** cada servicio paga su %; si no tiene, el de su grupo; si el grupo tampoco, el general. Y si una profesional cobra distinto en un servicio, se anota en ella.

Decisiones de la administradora: orden de lo general a lo específico (gana el último); la retención es **de la profesional** y sale de la comisión (5 puntos de una comisión de 50 % → se paga 45 % y 5 % va al aguinaldo); la «profesional en el grupo» deja de ser una capa.

---

## Criterios de aceptación

1. **Cuatro capas, gana la última** — El % de una venta sale de: el % por defecto de su tipo (servicio o producto) → el % de su grupo → el % del servicio → el % de la profesional para ese servicio. Gana la última que exista. Ya no hay un % de la profesional por grupo.
2. **Retención de la profesional** — La retención para aguinaldo es de cada profesional y se aplica a todas sus ventas, en cualquier capa: sale de la comisión (comisión 50 %, retiene 5 % → se paga 45 % y 5 % va al fondo; sobre Gs. 100.000: 45.000 y 5.000). Nunca es más que la comisión misma (una comisión de 3 % con retención de 5 % retiene 3 % y paga 0). Solo aplica si el salón activó el aguinaldo. Las reglas ya no llevan retención.
3. **Cambiar una retención pide desde cuándo aplica** — Como cambia lo que se le paga, pregunta «desde ahora / próximo período / desde el inicio del período» y, en el último caso, recalcula lo que todavía está abierto (con vista previa).
4. **Configurar tiene tres pasos** — Cómo se calcula (base y cada cuánto se liquida) · Comisión de cada servicio · Aguinaldo y costo de producto. Desaparece «Reglas por profesional» y su «N sin reglas». Un paso solo se marca pendiente si hay un **grupo sin su %** (paso 2) o el aguinaldo está activo y **nadie retiene** (paso 3); el contador del menú cuenta esos pasos. El paso 2 dice «N grupos · M con su %», muestra los grupos como atajos (los que no tienen % en ámbar) y ofrece «Poner los %» (botón principal si es el pendiente) y «Ordenar grupos y servicios».
5. **Configurar › Comisiones** — Una lista con el **% general** de servicios y de productos (con «Cambiar»), cada **grupo con su %** («Sin %» en ámbar con «Poner %» si no lo tiene) y «Sin grupo». Al abrir un grupo, cada servicio dice si paga «del grupo» o «propio», quién cobra distinto («1 profesional cobra distinto: Ana 50 %») y permite «Poner un % propio», «Cambiar» y «Quitar» (vuelve al del grupo). El buscador filtra y abre los grupos donde está lo buscado; `?q=` abre la pantalla ya buscando. Todo cambio pregunta desde cuándo aplica.
6. **Costo de producto** — En «Más opciones» de la ventana de un grupo o de un servicio: el monto fijo (Gs.) y a quién va (lo que dice el salón, la profesional o el salón); el % general no lo tiene.
7. **Ficha de la profesional › Comisiones** — Dice «Ana cobra lo normal de cada servicio» y tiene solo: su **retención** (si el aguinaldo está activo; «Cambiar») y **«Donde cobra distinto»**. Cada caso muestra su % y «Lo normal es X %»; los servicios de un grupo con el mismo % se juntan («Corte · 6 de 7 servicios»). Sin casos: «cobra lo normal en todo».
8. **Cargar dónde cobra distinto** — «+ Agregar» pregunta «Todo un grupo» o «Un servicio», el % y muestra el ejemplo con su retención. «Todo un grupo» se carga **en cada servicio que el grupo tiene hoy** (una regla por servicio, copiando el costo de producto de lo normal); los que se agreguen después usan lo normal y la ficha avisa («1 servicio del grupo usa lo normal: … Incluirlo»). «Cambiar» y «Quitar» actúan sobre todo el grupo juntado o sobre el servicio. Todo pregunta desde cuándo aplica.
9. **Inicio y Equipo sin «sin reglas»** — «Para revisar» avisa de los grupos sin % («N grupos sin %», va a Comisiones) en lugar de servicios sin grupo y profesionales sin reglas. La tarjeta de cada profesional dice «Cobra lo normal de cada servicio» o «Cobra distinto en N servicios» (y su retención); no hay filtro «Sin reglas». La guía de primera vez tiene tres pasos.
10. **Grupos y servicios** — La lista de grupos muestra el % de cada uno («Sin %» si no tiene) y, dentro de un grupo, «Poner el % del grupo» lleva a Comisiones. En «Excepciones por servicio» la lista «Qué regla gana» muestra las cuatro capas de lo general a lo específico («gana la última que corresponda») y el % estándar de un servicio sin % propio es el de su grupo.
11. **Lo que ya existe se convierte** — Al actualizar, la migración V101: suma la retención de cada regla a su % (45 + 5 = 50) si el salón retiene aguinaldo (si no retenía, solo se descarta); da a quien retenía a través de sus reglas una retención propia (la más frecuente entre ellas) si no la tenía; convierte las reglas de una profesional en un grupo en una regla por cada servicio que el grupo tiene hoy, sin pisar las que ya tenía para un servicio; y deja canceladas (en el historial) las reglas viejas de profesional por grupo. Lo que se le paga y retiene por cada regla no cambia; lo ya devengado tampoco.
12. **API** — `GET /api/commissions/rates` (grupos con su %, servicios con lo que pagan y las excepciones de cada profesional); `GET /api/commissions/overview` agrega `groupsWithoutPercent` y quita `professionalsWithoutRules`; `GroupView` trae `percent` en lugar de `professionalsWithRule`; se elimina `GET /professionals/{id}/rules`; `RETENTION_PROFILE` ya no es un cambio «sin efecto» (pide modo de aplicación). El valor de una regla acepta una retención y la ignora.
13. **Textos y estilo** — Español e inglés, tema claro y oscuro, objetivos táctiles de al menos 44 px, sin scroll horizontal en el celular.

---

## Notas

- El monto fijo (costo de producto) sigue siendo por regla; una excepción de la profesional copia el de lo normal al crearse y después es suyo.
- Con la conversión, si una regla de una profesional tenía una retención distinta de la que ella tiene como perfil, queda la del perfil y se conserva el total de la regla (pago + retención); la migración lo registra en el log.
