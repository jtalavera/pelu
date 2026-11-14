# HU-COM-15 · Rediseño de la experiencia de Comisiones (simple y didáctica)

| Campo      | Valor                         |
| ---------- | ----------------------------- |
| **ID**     | HU-COM-15                     |
| **Módulo** | Comisiones (front y back)     |
| **Estado** | `In Progress`                 |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md). Funcionalmente es lo mismo que HU-COM-01…14; cambia **cómo se muestra y se opera**.

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** que Comisiones me muestre de forma muy simple y didáctica qué tengo que hacer (configurar una vez, liquidar cada período, revisar a cada profesional),  
**para** configurar y operar las comisiones sin tener que entender un módulo con muchas solapas y menús.

---

## Contexto

Mockup aprobado: «Comisiones: nueva experiencia» (Inicio, Liquidar, Equipo, Actividad, Configurar). Decisiones de la administradora: los cinco lugares son esos; **Aguinaldo vive dentro de Equipo y solo se ve si el salón lo activó** en Configurar (no todos los salones lo usan); la **vista previa** deja de ser una pantalla aparte: es el primer paso de «Liquidar» y la solapa «Resumen» de cada profesional.

Mapa de lo que cambia de lugar:

| Antes | Ahora |
| ----- | ----- |
| Solapa «Liquidaciones» | **Liquidar** (3 pasos: Generar → Aprobar → Pagar) |
| «Más… › Vista previa» | Paso 1 de Liquidar y **Equipo › profesional › Resumen** |
| Solapa «Reglas › Por profesional» | **Equipo › profesional › Reglas** (reglas en frases) |
| Solapa «Reglas › Grupos» | **Configurar › paso 2 (Grupos)** |
| Solapa «Reglas › Servicios / Productos» | **Configurar › Avanzado** (excepciones) |
| Solapa «Movimientos» y «Más… › Reportes» | **Actividad** (Movimientos \| Reportes) |
| Solapa «Configuración», cambios programados e historial | **Configurar** (4 pasos) y **Avanzado** |
| «Más… › Aguinaldo» | **Equipo › Aguinaldo** (solo si está activado) y solapa Aguinaldo de cada profesional |

---

## Criterios de aceptación

1. **Cinco lugares** — Comisiones muestra siempre el título, el período en curso y cinco lugares: Inicio · Liquidar · Equipo · Actividad · Configurar. «Liquidar» lleva un contador con lo pendiente (sin liquidar + borradores + aprobadas) y «Configurar» uno con los pasos obligatorios que faltan.
2. **Inicio** — Resume el período: cuánto hay para pagar, cuántas profesionales ya se liquidaron y cuántas faltan (barra por estado) y un botón «Continuar con la liquidación». «¿Cómo funciona?» explica el proceso en tres pasos. «Para revisar» solo lista lo que hay (líneas sin profesional, servicios sin grupo, profesionales sin reglas, liquidaciones en borrador), cada tarjeta con su acción directa; si no hay nada dice que todo está en orden. Muestra a las primeras profesionales con su estado y, si el salón usa aguinaldo, el fondo acumulado.
3. **Guía de primera vez** — Mientras el salón no tenga grupos, Inicio muestra una guía de cuatro pasos (cómo se calcula · grupos · reglas por profesional · aguinaldo y costo de producto, opcional) con el avance «N de 4 pasos listos», para qué sirve cada uno con un ejemplo, y el paso en curso resaltado.
4. **Liquidar** — Selector de período ‹ › (sigue la periodicidad del salón) y tres tarjetas numeradas (Generar, Aprobar, Pagar) con lo que falta de cada una. Debajo, una fila por profesional con su estado (Sin liquidar · Borrador · Aprobada · Pagada · Sin movimientos), el monto y, si el salón retiene, lo retenido; filtros por estado con su contador y la acción de cada fila (Generar / Aprobar / Pagar / Ver). Se puede elegir varias y operar en lote («Con las seleccionadas»). Cada acción pide confirmación con el total; «Pagar» pide forma de pago, fecha y referencia. Se puede bajar el CSV.
5. **Generar sin duplicar** — Generar usa el período mostrado y omite a quien ya tiene una liquidación que se superpone. Aprobar congela los montos; pagar registra el pago (HU-COM-06 sin cambios).
6. **Equipo** — Lista a todas las profesionales activas con su estado del período, su monto, cuántas reglas tienen (o «Faltan reglas»), y su aguinaldo acumulado si el salón lo usa. Buscador por nombre (sin distinguir tildes ni mayúsculas) y filtros con contador: Todas · Sin reglas · Retienen aguinaldo (solo con aguinaldo activo) · Con comisión pendiente.
7. **Ficha de la profesional** — Al tocar una profesional se abre su ficha con solapas Resumen · Reglas · Aguinaldo (solo si está activo) · Historial. **Resumen**: lo que se le paga en el período (servicios, productos, ajustes y retención), las líneas y su estado, con acceso a su liquidación. **Historial**: sus movimientos (mismo listado de Actividad ya filtrado por ella).
8. **Reglas en frases** — Cada regla de la profesional se muestra como una frase («Cobra 45 % · retiene 5 % para aguinaldo · costo de producto 3.000 Gs (para ella)») con «Cambiar» y «Quitar». «Agregar una regla» ofrece solo los grupos que todavía no tiene. «Copiar reglas…» copia las de otra profesional. Si no hay grupos lleva a crearlos; si no tiene reglas lo explica y dice que se le paga el % por defecto.
9. **Editor de regla** — Pide: Cobra (%), Retiene para aguinaldo (%) (solo si el salón lo activó, precargado con su retención usual), Costo de producto (Gs) y, si hay costo de producto, para quién va (por defecto del salón, profesional o salón). Un ejemplo en vivo con un precio de prueba muestra lo que se le paga, lo que se retiene y lo que queda para el salón. Las validaciones de HU-COM-14 (pago + retención ≤ 100 %, % entre 0 y 100 con hasta 2 decimales, monto entero en guaraníes) se mantienen con su mensaje y ejemplo. «Siguiente →» pregunta desde cuándo rige (inmediato, próximo período o desde el inicio del período con vista previa del recálculo), igual que hoy.
10. **Retención usual** — En la ficha, si el salón retiene, se muestra el % que retiene la profesional y «Cambiar» lo edita (solo precarga reglas nuevas: no pregunta desde cuándo rige).
11. **Aguinaldo dentro de Equipo** — Solo si el salón activó la retención aparece la pestaña «Aguinaldo» en Equipo (fondo total, saldos, movimientos, pagos y ajustes de HU-COM-14) y la solapa en la ficha de cada profesional (con su saldo y sus movimientos). Con la retención desactivada no hay ninguna entrada a Aguinaldo y entrar por la URL vuelve a Equipo.
12. **Actividad** — «Movimientos» (todos los movimientos, reasignar profesional) y «Reportes» (incluye «Líneas sin profesional» con «Asignar profesional»), con los mismos filtros y exportaciones.
13. **Configurar en pasos** — Cuatro pasos numerados: 1 Cómo se calcula (base, % por defecto de servicios y productos, periodicidad), 2 Grupos de servicios (abre la pantalla de grupos con buscador, sugerencias y asignación en lote de HU-COM-14), 3 Reglas por profesional (lleva a Equipo), 4 Aguinaldo y costo de producto (activar retención, % por defecto, destino del costo de producto, retención usual de cada profesional). Cada cambio que afecta el cálculo pregunta desde cuándo rige (periodicidad, % de aguinaldo por defecto y retención usual no preguntan). Al activar o desactivar Aguinaldo, la navegación se actualiza sin recargar.
14. **Avanzado** — Desde Configurar: explicación de qué regla gana (profesional + servicio › profesional + grupo › servicio › grupo › % por defecto), excepciones por servicio o producto (HU-COM-02), cambios programados y su cancelación (HU-COM-09) e historial de cambios.
15. **Nada se pierde** — Todas las funciones de HU-COM-01…14 siguen disponibles (liquidaciones y su detalle, vista de la profesional «Mis comisiones», reportes, reasignación, cambios programados). El detalle de una liquidación vuelve a «Liquidar».
16. **Mensajes y estilo** — Todo el texto está en español e inglés; funciona en tema claro y oscuro y en móvil (los cinco lugares se acomodan en filas, las tablas largas hacen scroll horizontal), con objetivos táctiles de al menos 44 px. Con el módulo apagado se explica qué es y cómo pedirlo.
17. **Resumen del período (API)** — `GET /api/commissions/overview?offset=0` (ADMIN) devuelve el período (según la periodicidad del salón; `offset` -1 es el anterior), una fila por profesional activa con su estado, monto, retención, liquidación y cantidad de reglas, y los totales y alertas que usa Inicio. Cada llamada queda registrada (ruta, método, tenant y estado).

---

## Notas

- No cambian las reglas de cálculo, los estados de liquidación ni los permisos.
- Rutas: `/app/commissions` (Inicio), `/liquidar`, `/equipo`, `/equipo/aguinaldo`, `/equipo/:id?tab=rules|aguinaldo|history`, `/actividad?tab=reports`, `/configurar`, `/configurar/grupos`, `/configurar/avanzado`; el detalle de la liquidación sigue en `/app/commissions/settlements/:id`.
