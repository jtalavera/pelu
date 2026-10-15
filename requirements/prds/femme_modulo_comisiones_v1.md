# Femme — Módulo de Comisiones · Requerimientos v1

> **Estado:** Versión final acordada (sin preguntas abiertas).
> **Alcance:** Cálculo, liquidación y reporte de comisiones de beneficiarios (hoy: profesionales) por ítems vendidos (hoy: servicios y productos).
> **Diseño:** El núcleo del módulo es **agnóstico del rubro**. La terminología de peluquería ("profesional", "servicio") vive solo en la capa de UI / i18n.
> **Definiciones transversales:** [PRD Femme MVP v1](./femme_historias_usuario_mvp_v1.md#definiciones-transversales) (multi-tenant, zona horaria del servidor, etc.).

---

## 1. Principios de diseño

| # | Principio | Implicancia |
|---|-----------|-------------|
| P1 | **Núcleo genérico** | Conceptos: *Beneficiario*, *Ítem comisionable*, *Evento generador*, *Regla*, *Entrada de comisión*, *Liquidación*. Ninguna entidad del núcleo menciona "peluquería". |
| P2 | **Libro de movimientos inmutable (append-only)** | Una entrada de comisión nunca se edita ni se borra. Las correcciones se hacen con **contra-asientos** (ajustes). |
| P3 | **Snapshot en cada entrada** | Cada entrada guarda congelados: % aplicado, origen de la regla, base de cálculo usada, monto base y moneda. Cambios posteriores de reglas o configuración **no alteran lo ya devengado**, salvo que el administrador elija explícitamente recalcular el periodo vigente (§4.4); en ese caso el recálculo se hace con contra-entradas, sin editar ni borrar nada. |
| P4 | **Idempotencia** | Reintentos del evento generador (emisión del comprobante) no duplican entradas. |
| P5 | **Auditabilidad** | Toda acción de configuración, aprobación y pago registra quién, cuándo y valor anterior/nuevo. |
| P6 | **Multi-tenant estricto** | Todo dato y toda configuración están aislados por tenant. Cubierto por la suite `mt-isolation`. |

## 2. Glosario

| Término genérico | En peluquería (V1) |
|------------------|--------------------|
| **Beneficiario** | Profesional (`Professional`). |
| **Ítem comisionable** | Servicio (`SalonService.kind = SERVICE`) o producto (`kind = PRODUCT`). Ambos tipos son comisionables y se gestionan en catálogos separados (Servicios / Productos). En el núcleo se llama *tipo de ítem* (`itemKind`). |
| **Evento generador** | Emisión de un comprobante (`Invoice`). |
| **Línea comisionable** | Línea de comprobante (`InvoiceLine`) con un **beneficiario asignado** (profesional / vendedor). Hoy `InvoiceLine` no guarda profesional; se agrega en HU-COM-10. |
| **Regla de comisión** | Porcentaje aplicable a un ítem, general o por beneficiario. |
| **Entrada de comisión** | Registro inmutable generado por una línea (o un ajuste). |
| **Liquidación** | Agrupación de entradas de un periodo para un beneficiario, que se aprueba y se paga. |

## 3. Decisiones de producto acordadas

| Tema | Decisión |
|------|----------|
| **Devengo** | Al **emitir el comprobante**. Si se anula, la comisión se revierte (ver HU-COM-05). |
| **Tipo de regla (V1)** | **Porcentaje** sobre el valor del ítem. |
| **Ítems comisionables** | **Servicios y productos.** Un producto vendido comisiona igual que un servicio prestado. |
| **Beneficiario de la línea** | Campo **profesional / vendedor** en cada línea del comprobante, precargado desde el registro de servicio si existe y editable al facturar; también para ventas sueltas de productos (HU-COM-10). |
| **Resolución del %** | 1) % específico **beneficiario + ítem**, 2) % **general del ítem**, 3) **% por defecto del tipo de ítem** (uno para servicios y otro para productos). |
| **Base de cálculo** | **Configurable por tenant**: *con IVA* o *sin IVA* (ver §4). Siempre **después de descuentos**. |
| **Pago** | Liquidaciones por periodo con aprobación y marca de pagado. Sin integración con caja en V1. |
| **Anulación tras liquidar** | **Ajuste negativo** en la próxima liquidación; las liquidaciones cerradas son inmutables. |
| **Periodicidad** | Configurable por tenant: semanal, quincenal, mensual o rango manual. |
| **Cambios a mitad de periodo** | Todo cambio que afecte el cálculo (base, % por defecto, reglas) pregunta al `ADMIN` si rige **desde el momento del cambio**, **desde el inicio del próximo periodo** o **desde el inicio del periodo vigente** (recalcula lo no cerrado; ver §4.4 y HU-COM-09). Las liquidaciones Aprobadas o Pagadas nunca se recalculan. |
| **Permisos** | `ADMIN` configura, aprueba, paga y ve todo. `PROFESSIONAL` ve **solo lo suyo**, en lectura. |
| **Habilitación** | Feature flag `COMMISSIONS`, **apagada globalmente por defecto** y habilitada desde la vista de plataforma (`PLATFORM_ADMIN`) por tier y por tenant, igual que el módulo de Stock (`STOCK_MODULE`). Ver HU-COM-11. |

## 4. Base de cálculo configurable por tenant

### 4.1 Opciones

Cada tenant elige **una** base para todo su cálculo de comisiones:

| Valor (`commissionBase`) | Etiqueta UI (es) | Monto sobre el que se aplica el % |
|--------------------------|------------------|-----------------------------------|
| `NET_OF_TAX` | **Sin IVA** | Total de la línea **después de descuentos**, **menos** el IVA de la línea. |
| `TAX_INCLUDED` | **Con IVA** | Total de la línea **después de descuentos**, **IVA incluido** (lo que pagó el cliente por la línea). |

- **Valor por defecto** para tenants nuevos y existentes al activar el módulo: `NET_OF_TAX` (sin IVA).
- Los precios del catálogo son **IVA incluido** (`InvoiceLine.taxAmount` = `lineNet × rate / (100 + rate)`), por lo que:
  - `TAX_INCLUDED` = total de la línea tras descuento (`lineNet`).
  - `NET_OF_TAX` = `lineNet − taxAmount`.
- El cálculo respeta la **tasa de IVA de cada línea** (10 %, 5 % o exenta). En una línea exenta ambas bases coinciden.

### 4.2 Ejemplo

Línea de 110.000 Gs con IVA 10 % incluido, sin descuento, % aplicable = 40 %:

| Base | Monto base | Comisión |
|------|-----------:|---------:|
| Sin IVA (`NET_OF_TAX`) | 100.000 | **40.000** |
| Con IVA (`TAX_INCLUDED`) | 110.000 | **44.000** |

Con un descuento de 10.000 Gs sobre esa línea (lineNet = 100.000, IVA = 9.090,9): sin IVA = 90.909 → **36.364**; con IVA = 100.000 → **40.000**.

### 4.3 Reglas de cambio de la base

1. Solo `ADMIN` puede cambiar la base; el cambio se audita (usuario, fecha, valor anterior y nuevo).
2. **Por defecto el cambio no es retroactivo.** La fecha desde la que rige la define el administrador al guardar, según §4.4. Solo si elige explícitamente "desde el inicio del periodo vigente" se recalculan las entradas del periodo en curso que aún no estén en una liquidación Aprobada o Pagada; nunca se recalcula nada más antiguo.
3. Cada entrada de comisión guarda la base con la que fue calculada (`baseTypeApplied`). Las **reversiones** por anulación usan **el snapshot de la entrada original**, nunca la configuración vigente.
4. En una misma liquidación pueden coexistir entradas calculadas con bases distintas (si el tenant cambió la base durante el periodo). La liquidación y los reportes muestran la base de cada entrada y avisan cuando hay mezcla.
5. Si el cambio se guarda a mitad de un periodo, el sistema **pregunta cómo aplicarlo** (§4.4); la pantalla advierte explícitamente qué opciones recalculan entradas y cuáles no.

### 4.4 Cambios a mitad de periodo

**Cambios alcanzados:** todo cambio que afecta el cálculo de comisiones:
- la **base de cálculo** (con IVA / sin IVA);
- el **% por defecto de servicios** o el **% por defecto de productos** (cada uno es un alcance independiente);
- una **regla** de % (alta, modificación de %, cierre o desactivación, general o por profesional).

La **periodicidad de liquidación** no afecta el cálculo y no dispara esta pregunta (ver C13).

**Periodo en curso:** el periodo de liquidación del tenant que contiene la fecha del cambio, en la zona horaria del servidor:

| Periodicidad | Periodo | Inicio del próximo periodo |
|--------------|---------|----------------------------|
| Semanal | Lunes a domingo | Próximo lunes, 00:00 |
| Quincenal | Días 1–15 y 16–fin de mes | Día 16 o día 1 del mes siguiente, 00:00 |
| Mensual | Mes calendario | Día 1 del mes siguiente, 00:00 |
| Manual | No hay periodos predefinidos | No aplica |

**Pregunta al guardar:** si el cambio se confirma con un periodo en curso, el sistema muestra un diálogo obligatorio con tres opciones:

| Opción | Fecha de vigencia (`effectiveFrom`) | Efecto |
|--------|-------------------------------------|--------|
| **Desde el momento del cambio** | Instante de confirmación | Los comprobantes emitidos desde ese instante usan el nuevo cálculo; los anteriores del mismo periodo conservan el anterior. El periodo queda **mixto**. |
| **Desde el inicio del próximo periodo** | Inicio del próximo periodo (00:00) | Todo el periodo en curso se calcula con el cálculo anterior; el cambio queda **programado** y se aplica solo al periodo siguiente. |
| **Desde el inicio del periodo vigente** | Inicio del periodo en curso (00:00) | Se **recalculan** las entradas del periodo en curso alcanzadas por el cambio que no estén en una liquidación Aprobada o Pagada; el periodo completo queda calculado con la nueva regla. |

Reglas:
1. Solo **Desde el inicio del periodo vigente** recalcula entradas ya devengadas, y solo dentro del periodo en curso. Las otras dos opciones no recalculan nada (P3).
2. No hay opción por defecto preseleccionada: el administrador debe elegir explícitamente (`COMMISSION_CHANGE_APPLY_MODE_REQUIRED`).
3. Con periodicidad **Manual** no existe "próximo periodo": el diálogo ofrece solo **Desde el momento del cambio** y **Desde el último corte**, donde el periodo vigente son las entradas posteriores a la última liquidación Aprobada o Pagada de cada beneficiario.
4. El diálogo muestra el periodo en curso (fechas), la fecha exacta de vigencia de cada opción y, en el cambio de base, el ejemplo numérico de §4.2.
5. El cálculo de cada comprobante usa la configuración y las reglas **vigentes en el instante de su emisión** (`issuedAt` frente a `effectiveFrom`), y el resultado queda en el snapshot.
6. Un cambio **programado** es visible, cancelable antes de entrar en vigencia y queda auditado. Solo puede haber **un cambio programado por alcance** (base, % por defecto de servicios, % por defecto de productos, o regla concreta); uno nuevo reemplaza al anterior previa confirmación.
7. La opción elegida (`applyMode`: `IMMEDIATE`, `NEXT_PERIOD` o `PERIOD_START`) queda en la auditoría.

**Recálculo con «Desde el inicio del periodo vigente» (`PERIOD_START`):**
1. **Vista previa obligatoria:** antes de confirmar, el diálogo muestra cuántas entradas se recalcularán, cuántas quedan fuera por estar en liquidaciones Aprobadas o Pagadas y la diferencia total estimada en la moneda del tenant (por beneficiario si hay más de uno).
2. **Entradas alcanzadas:** cambio de base → todas las del periodo; cambio del % por defecto de servicios o de productos → las de ese tipo cuyo origen era el defecto; cambio de regla → las del ítem (y del profesional, si es una excepción).
3. **Entradas excluidas:** las de liquidaciones Aprobadas o Pagadas, los ajustes manuales y las de comprobantes ya anulados. El recálculo no genera entradas para líneas que nunca tuvieron comisión.
4. **Mecánica:** cada entrada alcanzada se revierte con una contra-entrada (`reasonCode = RECALCULATION`) y se emite una nueva entrada con la regla y la base nuevas, con revisión incrementada. Nada se edita ni se borra (P2).
5. **Liquidaciones en Borrador:** se actualizan con las entradas nuevas y el administrador ve el total corregido.
6. **Vigencia:** el nuevo valor rige desde el inicio del periodo y sustituye a cualquier versión anterior que rigiera dentro del periodo en curso.
7. **Atomicidad:** el recálculo es todo o nada; si falla, no se aplica ni el recálculo ni el cambio (`COMMISSION_RECALCULATION_FAILED`).
8. **Auditoría:** queda un registro del recálculo (usuario, fecha, alcance, periodo, entradas afectadas y diferencia total).

---

## 5. Historias de usuario

### HU-COM-01 · Configurar el módulo de comisiones del negocio

**Como** administrador,
**quiero** configurar los parámetros generales de comisiones de mi negocio,
**para** que el cálculo se ajuste a mis políticas.

**Criterios de aceptación:**
- [ ] La configuración de comisiones es accesible solo para `ADMIN`: la **base de cálculo** y la **comisión general** de servicios y de productos están en **Reglas → «Reglas generales»**; la periodicidad, los cambios programados y el historial están en **Configuración**. Si la feature flag `COMMISSIONS` no está habilitada para el tenant, si la feature flag `COMMISSIONS` no está habilitada para el tenant, la sección no aparece y la API responde `FEATURE_NOT_ENABLED`.
- [ ] Puedo elegir la **base de cálculo**: *Sin IVA* o *Con IVA* (por defecto *Sin IVA*). Cada opción incluye texto de ayuda con el ejemplo de §4.2.
- [ ] Al cambiar la base (o el % por defecto) se muestra el diálogo de §4.4 / HU-COM-09, que indica que el cambio **no es retroactivo** y pregunta desde cuándo aplicarlo.
- [ ] Puedo definir dos valores por defecto: la **comisión general de servicios** y la **de productos** (0–100, hasta 2 decimales; ambos 0 % al inicio). Se aplican solo a ítems del tipo correspondiente que no tengan % estándar propio. Los cambios de base y comisión general quedan pendientes y se guardan juntos con **«Guardar cambios»**.
- [ ] Puedo elegir la **periodicidad de liquidación**: semanal (lunes a domingo), quincenal (días 1–15 y 16–fin de mes), mensual (mes calendario) o manual.
- [ ] Cambiar la periodicidad **no muestra** la pregunta de HU-COM-09: rige para las liquidaciones que se generen después y no altera liquidaciones existentes ni cambios programados.
- [ ] Cada cambio de configuración queda en el historial de auditoría (usuario, fecha/hora, valor anterior y nuevo).
- [ ] Un valor inválido (p. ej. 120 %) muestra un error de campo en rojo con la regla y un ejemplo de formato (p. ej. `Ingresá un porcentaje entre 0 y 100, por ejemplo 40,5`).

### HU-COM-02 · Definir reglas de comisión por ítem y por profesional

**Como** administrador,
**quiero** definir un porcentaje general por ítem y excepciones por profesional,
**para** pagar comisiones distintas según el servicio o producto y quién lo realiza.

**Criterios de aceptación:**
- [ ] Puedo definir un **% general** para cada ítem del catálogo, que aplica a todos los profesionales por defecto.
- [ ] Puedo definir un **% de excepción** para una combinación **profesional + ítem**, que prevalece sobre el % general del ítem.
- [ ] Puedo marcar explícitamente un ítem como **sin comisión** (0 %), distinto de "sin regla definida".
- [ ] Si no existe ni % general ni excepción, se aplica el **% por defecto del tipo del ítem**: el de servicios para un servicio y el de productos para un producto.
- [ ] Las reglas se pueden definir tanto para **servicios** como para **productos**; la vista de Reglas los separa en sub-pestañas (Servicios / Productos).
- [ ] Cada regla admite **vigencia** (fecha desde, fecha hasta opcional). Dos reglas del mismo alcance (mismo ítem, o mismo profesional+ítem) **no pueden solaparse** (`COMMISSION_RULE_OVERLAP`).
- [ ] Una regla vigente puede cerrarse (poner fecha hasta) pero **no se elimina** si ya generó entradas; se desactiva.
- [ ] Existe un **historial de cambios** por regla (quién, cuándo, % anterior y nuevo, vigencia).
- [ ] El **% general** de un servicio o de un producto se define en el **formulario del ítem**, en las pantallas de **Servicios** y de **Productos**, dentro de una sección **«Comisión»**.
- [ ] La misma sección «Comisión» incluye una lista **«Excepciones por profesional»** donde puedo **agregar, editar y quitar** el % de uno o varios profesionales para ese ítem. Un mismo ítem puede tener un % distinto para cada profesional.
- [ ] Al agregar una excepción solo se ofrecen profesionales **activos** que aún no tengan una excepción vigente para ese ítem. Una excepción de un profesional que luego se desactiva sigue visible y se puede cerrar, pero no se puede crear una nueva para él.
- [ ] La sección «Comisión» del formulario del ítem solo es visible para `ADMIN` y si la feature flag `COMMISSIONS` está habilitada; en caso contrario el formulario del ítem no cambia.
- [ ] La pestaña **Reglas** del módulo tiene tres sub-pestañas: **Servicios**, **Productos** y **Reglas generales**. Modelo de precedencia (gana la más específica): **1)** comisión general del tipo → **2)** % estándar del servicio/producto (excepción) → **3)** % de un profesional para ese servicio/producto (excepción individual).
- [ ] En Servicios / Productos los ítems activos se listan **ordenados por nombre, sin filas de categoría**, con un **buscador por nombre** del servicio o producto al inicio de la tabla (sin distinguir mayúsculas ni acentos), y cada ítem muestra **precio**, **% estándar** (marcado «≠ general» si difiere de la comisión general) y las **excepciones por profesional** como chips con el % y la **diferencia** respecto del estándar (p. ej. «Ana 50 % +10»).
- [ ] Encima de la tabla se ven contadores (**N servicios/productos**, **N con excepciones**, **N profesionales**), la **base de cálculo** con acceso a editarla, el interruptor **«Ver solo excepciones»** y la fecha a la que se calcula el % vigente.
- [ ] Al seleccionar un ítem se abre un **popup centrado en la pantalla** (siempre visible, sin importar el scroll) con categoría, nombre, precio y monto base; el **% estándar** del ítem (propio o heredado de la comisión general) con **«Cambiar»** (y volver a la comisión general); la lista de **profesionales** con su % (excepción con diferencia, o «Hereda») y la **comisión estimada** sobre el precio de lista; **«Agregar excepción»** y **«Ver historial de cambios»**. El popup tiene **«Cerrar»** y **«Guardar cambios»** (aplica todos los cambios pendientes).
- [ ] Los cambios hechos en la vista quedan **pendientes** (marcados «sin guardar», con contador y opción **«Descartar»**) y se aplican **todos juntos** con **«Guardar cambios»**, que abre una sola vez el diálogo de HU-COM-09.
- [ ] Todas las vías de edición (formulario del ítem y vista de Reglas) usan las **mismas validaciones**, el mismo historial y el mismo diálogo de HU-COM-09: el resultado es idéntico sin importar desde dónde se edite.
- [ ] Las pantallas de **Servicios** y de **Productos** muestran una advertencia en los ítems sin % general (usan el defecto de su tipo) y un acceso directo a su regla.
- [ ] Las reglas nuevas **no modifican** entradas ya devengadas, salvo que el administrador elija "desde el inicio del periodo vigente" (HU-COM-09).
- [ ] Todo alta, cambio de % o cierre de una regla, hecho con un periodo en curso, dispara el diálogo de HU-COM-09; la fecha elegida se convierte en el `validFrom` de la nueva versión y el `validTo` de la anterior.
- [ ] La vista de Reglas permite ver el % vigente **a una fecha dada** e indica los cambios **programados** pendientes (⏱).

### HU-COM-03 · Vista previa de la liquidación (reemplaza al simulador)

**Como** administrador,
**quiero** ver cuánto cobraría un profesional en un periodo abierto con las comisiones registradas hasta hoy,
**para** anticipar la liquidación sin generarla.

**Criterios de aceptación:**
- [ ] En la pestaña **«Vista previa»** elijo un profesional (obligatorio) y un periodo, que por defecto es el **periodo vigente** según la periodicidad.
- [ ] Se muestra el **total a liquidar**, los subtotales de **servicios**, **productos** y **ajustes**, y el detalle de las comisiones incluidas: exactamente las que entrarían si hoy se generara la liquidación (comisiones aún no liquidadas hasta la fecha «Hasta», incluidas reversiones y saldos arrastrados).
- [ ] Las comisiones que ya están en una **liquidación en borrador** no se cuentan; se avisa que existe ese borrador.
- [ ] La vista previa **no persiste** nada.

### HU-COM-04 · Generación automática de comisiones al emitir un comprobante

**Como** sistema,
**quiero** generar las entradas de comisión al emitir un comprobante,
**para** que el devengo sea automático y consistente.

**Criterios de aceptación:**
- [ ] Al emitir un comprobante se genera **una entrada por línea** con beneficiario asignado, sea de **servicio o de producto**, y se atribuye al periodo según la fecha de emisión.
- [ ] El monto base se calcula según la **base configurada del tenant** en el instante de la emisión (§4), después de descuentos.
- [ ] La entrada guarda un **snapshot**: % aplicado, origen de la regla (id), `baseTypeApplied`, monto base, monto IVA de la línea, moneda y comisión resultante.
- [ ] Las **propinas** no generan comisión.
- [ ] La base parte del **neto ya calculado por línea** (`lineNet`, tras el descuento de esa línea). El descuento global del comprobante **no se prorratea** entre las líneas: no afecta la base de comisión.
- [ ] El proceso es **idempotente**: reintentar la emisión no duplica entradas (clave única por comprobante + línea).
- [ ] El redondeo se hace **por entrada** a la unidad mínima de la moneda (Gs sin decimales) con `HALF_UP`.
- [ ] Una línea sin beneficiario asignado **no genera comisión** y queda listada en el reporte de "líneas sin beneficiario" (con su tipo de ítem).
- [ ] La entrada guarda el **tipo de ítem** (`itemKind`) como snapshot; si el ítem cambia después en el catálogo, la entrada no se altera.
- [ ] Aplica igual a **ventas sueltas de productos** (comprobante sin registro de servicio) siempre que la línea tenga beneficiario asignado.
- [ ] Los comprobantes emitidos **antes** de habilitar el módulo no generan comisión (tampoco con la opción "desde el inicio del periodo vigente").
- [ ] Un fallo al calcular la comisión **no bloquea** la emisión del comprobante: queda un evento pendiente de reproceso y un error registrado (`COMMISSION_CALCULATION_FAILED`).
- [ ] Si la feature flag no está habilitada para el tenant, no se generan entradas.

### HU-COM-05 · Reversión de comisiones por anulación de comprobante

**Como** administrador,
**quiero** que la comisión se revierta si anulo un comprobante,
**para** no pagar comisiones sobre ventas anuladas.

**Criterios de aceptación:**
- [ ] Al anular un comprobante cuyas entradas están en una liquidación **Borrador** o sin liquidar, las entradas se **revierten** con una contra-entrada (no se borran).
- [ ] Si las entradas pertenecen a una liquidación **Aprobada o Pagada**, esa liquidación **no se modifica**: se genera una **entrada de ajuste negativa** que se aplica en la **próxima liquidación** del profesional.
- [ ] La reversión usa el **snapshot** de la entrada original (misma base, mismo %), no la configuración vigente.
- [ ] Si el saldo de una liquidación resulta negativo, se **arrastra** el saldo a la siguiente (no se paga negativo).
- [ ] La anulación es idempotente: anular dos veces no duplica la reversión.
- [ ] Si las entradas fueron recalculadas antes (HU-COM-09), la anulación revierte la **revisión vigente** de cada entrada.
- [ ] **Dependencia con Stock:** si el comprobante anulado contiene productos y el módulo de Stock está activo, la devolución del producto al inventario la gestiona la integración con Stock existente (HU-64) y **no forma parte de este módulo**. La reversión de la comisión es **independiente** de esa devolución: un fallo o demora en Stock no impide revertir la comisión, ni al revés.

### HU-COM-06 · Gestionar liquidaciones por periodo

**Como** administrador,
**quiero** generar, revisar, aprobar y marcar como pagadas las liquidaciones de comisiones,
**para** pagar correctamente a cada profesional y tener un historial.

**Criterios de aceptación:**
- [ ] Puedo generar liquidaciones para un periodo según la periodicidad del tenant (o un rango manual). Se crea una liquidación **Borrador** por beneficiario con las entradas del periodo aún no liquidadas.
- [ ] Una entrada pertenece a **una sola** liquidación; no puede liquidarse dos veces.
- [ ] Estados: **Borrador → Aprobada → Pagada**, y **Anulada** (solo desde Borrador o Aprobada, nunca desde Pagada).
- [ ] La liquidación muestra: detalle por línea (fecha, comprobante, ítem, tipo de ítem, base usada, monto base, %, comisión), subtotales por ítem y por tipo (servicios / productos), ajustes y total.
- [ ] Si hay entradas con **bases distintas** (cambió la configuración en el periodo), se muestra el aviso y la columna "Base" por línea.
- [ ] Puedo agregar **ajustes manuales** (bono o descuento, positivo o negativo) con **motivo obligatorio** únicamente en estado Borrador.
- [ ] Al **aprobar**, la liquidación queda **inmutable** (no se editan líneas ni ajustes).
- [ ] Al marcar **Pagada** registro fecha de pago, método (efectivo, transferencia, otro) y referencia opcional.
- [ ] Cada transición queda auditada (usuario, fecha/hora, estado anterior y nuevo).
- [ ] No se puede generar una liquidación que **solape** periodos ya liquidados para el mismo beneficiario (`COMMISSION_PERIOD_OVERLAP`).
- [ ] Una liquidación sin entradas ni ajustes no se genera.
- [ ] El listado es **paginado** (HU-32) y filtrable por profesional, estado y periodo.

### HU-COM-07 · Vista del profesional sobre sus comisiones

**Como** profesional con acceso al sistema,
**quiero** ver mis comisiones y liquidaciones,
**para** conocer lo que he generado y lo que se me pagó.

**Criterios de aceptación:**
- [ ] Veo mis comisiones devengadas del periodo en curso y mis liquidaciones (estado, periodo, total), con el detalle separado por servicios y por productos.
- [ ] Veo el detalle por línea de mis liquidaciones, en **solo lectura**.
- [ ] **No** veo comisiones ni liquidaciones de otros profesionales, ni la configuración de reglas de otros (la API devuelve `403`/`404` ante intentos de acceso cruzado).
- [ ] Veo la base de cálculo usada en cada línea (con IVA / sin IVA) y el monto base, pero **no** el IVA discriminado ni el total de la línea; esos campos no se exponen en la API del profesional.
- [ ] Si la feature flag no está habilitada, la sección no aparece.

### HU-COM-08 · Reportes y exportación

**Como** administrador,
**quiero** consultar y exportar reportes de comisiones,
**para** analizar costos y conciliar pagos.

**Criterios de aceptación:**
- [ ] Reporte de comisiones por **profesional**, por **ítem**, por **tipo de ítem** (servicios / productos) y por **periodo**, con filtros de fecha, profesional, tipo de ítem y estado de liquidación.
- [ ] Reporte de **líneas sin beneficiario**. (El reporte de «ítems sin % general» se quitó: el aviso se ve en las pantallas de Servicios / Productos y en la vista de Reglas.)
- [ ] **Comprobante de liquidación** imprimible en PDF (datos del negocio, profesional, periodo, detalle, ajustes, total, base de cálculo usada).
- [ ] **Exportación CSV** de entradas y de liquidaciones, con el tipo de ítem, la base y el % aplicados por línea.
- [ ] Los montos y fechas respetan el formato y la zona horaria del servidor.

### HU-COM-09 · Aplicar cambios de cálculo a mitad de periodo

**Como** administrador,
**quiero** que el sistema me pregunte cómo aplicar un cambio de cálculo cuando lo hago a mitad de un periodo,
**para** decidir si rige desde ahora, desde el próximo periodo o desde el inicio del periodo vigente, y evitar liquidaciones inconsistentes.

**Criterios de aceptación:**
- [ ] Al confirmar un cambio alcanzado (base, % por defecto o regla, ver §4.4) con un periodo en curso, se abre un diálogo con tres opciones: **Desde el momento del cambio**, **Desde el inicio del próximo periodo** y **Desde el inicio del periodo vigente**.
- [ ] Ninguna opción viene preseleccionada y no se puede guardar sin elegir una (`COMMISSION_CHANGE_APPLY_MODE_REQUIRED`).
- [ ] El diálogo muestra el periodo en curso (desde–hasta) y la fecha y hora exactas de vigencia de cada opción.
- [ ] Con **Desde el momento del cambio**, los comprobantes emitidos a partir de la confirmación usan el nuevo cálculo y los anteriores del periodo conservan el suyo; el periodo queda mixto y la liquidación lo indica (columna y aviso de HU-COM-06).
- [ ] Con **Desde el inicio del próximo periodo**, el cambio queda **programado**: todo el periodo en curso se calcula con el cálculo anterior y el nuevo rige desde las 00:00 del primer día del próximo periodo.
- [ ] Las opciones **Desde el momento del cambio** y **Desde el inicio del próximo periodo** no modifican entradas ya devengadas ni liquidaciones existentes.
- [ ] Con **Desde el inicio del periodo vigente**, el diálogo muestra una **vista previa** (entradas a recalcular, entradas excluidas por estar en liquidaciones Aprobadas o Pagadas, y diferencia total) y exige confirmar tras verla.
- [ ] Al confirmar esa opción, las entradas alcanzadas se **revierten y se reemitan** con la nueva regla mediante contra-entradas, sin editar ni borrar entradas.
- [ ] Las liquidaciones **Aprobadas o Pagadas** no se modifican; las liquidaciones en **Borrador** se actualizan con las entradas recalculadas y muestran el total corregido.
- [ ] Los ajustes manuales y las entradas de comprobantes anulados no se recalculan.
- [ ] El recálculo es atómico: si falla, no se aplica el cambio ni el recálculo y se informa el error.
- [ ] Con periodicidad **Manual**, el diálogo ofrece solo **Desde el momento del cambio** y **Desde el último corte** (entradas posteriores a la última liquidación Aprobada o Pagada del beneficiario); no ofrece "próximo periodo".
- [ ] Si el cambio recalculado deja un periodo con varios tramos de cálculo previos, el nuevo valor los sustituye para todo el periodo vigente.
- [ ] Los cambios programados se listan (qué cambia, valor actual, valor nuevo, fecha de vigencia, autor) y se pueden **cancelar** antes de que entren en vigencia.
- [ ] Un cambio programado nuevo sobre el mismo alcance **reemplaza** al anterior tras confirmación explícita.
- [ ] Al llegar la fecha de vigencia el nuevo cálculo se aplica automáticamente, sin intervención del administrador, y los comprobantes emitidos desde ese instante lo usan.
- [ ] El cálculo de cada comprobante usa lo vigente en su instante de emisión y lo deja en el snapshot (P3); tras un recálculo, el snapshot de la nueva entrada refleja la regla y la base nuevas.
- [ ] La auditoría registra el modo elegido (`applyMode`), la fecha de vigencia, valor anterior y nuevo, usuario y fecha/hora; también las cancelaciones de cambios programados y cada recálculo (alcance, periodo, entradas afectadas, diferencia total).
- [ ] Solo `ADMIN` puede aplicar o cancelar cambios; un `PROFESSIONAL` recibe `403`.
- [ ] El diálogo y los mensajes están en `en.json` y `es.json`, son accesibles (foco, `role="dialog"`, cierre con Esc sin guardar) y funcionan en modo claro/oscuro y mobile.

### HU-COM-10 · Asignar profesional / vendedor a las líneas del comprobante

> Modifica **HU-14 (Emitir comprobante)**. Es el origen del beneficiario de cada comisión, tanto en servicios como en productos.

**Como** administrador,
**quiero** indicar qué profesional realizó o vendió cada línea del comprobante,
**para** que la comisión de servicios y de productos se atribuya correctamente.

**Criterios de aceptación:**
- [ ] Cada línea del formulario de emisión (servicio o producto) tiene un campo opcional **Profesional / Vendedor** que lista los profesionales activos del tenant.
- [ ] Si el comprobante se crea desde un **registro de servicio**, el campo se **precarga** con el profesional de la línea del registro (si lo tiene) y se puede cambiar o quitar.
- [ ] En un comprobante creado **sin registro de servicio** (p. ej. venta suelta de un producto) el campo parte vacío y se puede asignar manualmente.
- [ ] El valor queda guardado en la línea del comprobante al emitirlo y **no se puede modificar** después, igual que el resto del comprobante emitido.
- [ ] Un profesional inactivo o de otro tenant se rechaza (`PROFESSIONAL_NOT_FOUND` / `INVOICE_LINE_PROFESSIONAL_INACTIVE`).
- [ ] Con la feature flag `COMMISSIONS` habilitada, una línea sin profesional muestra un aviso discreto ("esta línea no generará comisión"); **no impide emitir**.
- [ ] Con la feature flag deshabilitada, el campo no se muestra y el flujo de HU-14 no cambia.
- [ ] El campo y el aviso están en `en.json` y `es.json`, y funcionan en modo claro/oscuro y mobile.
- [ ] Los tests Playwright de HU-14 (emisión de comprobante) se actualizan para cubrir el nuevo campo.

### HU-COM-11 · Habilitar el módulo de comisiones desde la plataforma

**Como** administrador de plataforma (`PLATFORM_ADMIN`),
**quiero** habilitar o deshabilitar el módulo de comisiones por tier y por negocio,
**para** ofrecerlo solo a los negocios que lo contraten, igual que el módulo de Stock.

**Criterios de aceptación:**
- [ ] Existe la feature flag **`COMMISSIONS`**, creada **apagada globalmente** (ningún tenant tiene el módulo hasta que un `PLATFORM_ADMIN` lo active).
- [ ] La flag se gestiona en las pantallas de plataforma existentes: **flags globales**, **tiers** y **detalle del tenant** (override por negocio).
- [ ] La habilitación efectiva sigue la **misma resolución que el resto de las flags**: global **Y** tier **Y** tenant (si no hay valor de tier o de tenant, se asume habilitado).
- [ ] Con la flag efectiva apagada: el menú y las secciones de comisiones no aparecen, el campo Profesional / Vendedor de HU-COM-10 no se muestra, los endpoints responden `FEATURE_NOT_ENABLED` y no se generan entradas de comisión (HU-COM-04).
- [ ] Al **habilitar** la flag por primera vez para un tenant, el módulo arranca con su configuración por defecto (base *Sin IVA*, % por defecto de servicios y de productos en 0 %, periodicidad mensual) y no genera comisiones sobre comprobantes anteriores.
- [ ] Al **deshabilitar** la flag se conservan todos los datos (reglas, entradas, liquidaciones, cambios programados); al reactivarla se retoma donde quedó (C9, C16).
- [ ] Cada cambio de la flag queda auditado con el historial de flags existente (quién, cuándo, valor anterior y nuevo).
- [ ] Solo `PLATFORM_ADMIN` puede cambiar la flag; un `ADMIN` de tenant no puede habilitarla ni deshabilitarla.
- [ ] La flag aparece traducida en `en.json` y `es.json` en las pantallas de plataforma.

### HU-COM-12 · Cambiar el profesional de una comisión asignada por error

**Como** administrador,
**quiero** reasignar una comisión al profesional correcto,
**para** corregir errores de asignación sin tocar la factura.

**Criterios de aceptación:**
- [ ] Desde la pestaña **«Movimientos»** (todas las comisiones registradas, con filtros de fecha, profesional y texto) y desde el **detalle de una liquidación en borrador**, cada comisión de comprobante no revertida ofrece **«Cambiar profesional»**.
- [ ] El diálogo pide el **profesional correcto** (solo activos, distinto del actual) y un **motivo** obligatorio; sin ellos muestra el error de campo.
- [ ] Al confirmar: la factura y sus datos fiscales **no cambian**; se crea una **reversión** de la comisión original (motivo «cambio de profesional», con la nota ingresada) y una **nueva comisión** para el profesional correcto, calculada con **sus reglas** vigentes a la fecha de devengo original (revisión +1). El profesional de la línea del comprobante se actualiza.
- [ ] Si la comisión estaba en una liquidación **en borrador**, la reversión entra en ese borrador; la nueva comisión queda pendiente para el profesional correcto.
- [ ] Si estaba en una liquidación **aprobada o pagada**, se avisa en el diálogo: esa liquidación **no cambia** y la reversión (negativa) y la nueva comisión van a la **próxima** liquidación de cada profesional.
- [ ] Una comisión ya reasignada (revertida) no se puede volver a reasignar (`COMMISSION_ENTRY_NOT_REASSIGNABLE`); errores: `COMMISSION_ENTRY_NOT_FOUND`, `COMMISSION_REASSIGN_REASON_REQUIRED`, `COMMISSION_REASSIGN_SAME_PROFESSIONAL`, `COMMISSION_PROFESSIONAL_INACTIVE`.

---

## 6. Modelo de datos conceptual

> Nombres orientativos; la implementación sigue las convenciones del repo (Flyway, JPA).

| Entidad | Campos clave |
|---------|--------------|
| **CommissionSettings** (versionada, N por tenant) | `tenantId`, `commissionBase` (`NET_OF_TAX` \| `TAX_INCLUDED`), `defaultPercentService`, `defaultPercentProduct`, `effectiveFrom`, `applyMode` (`IMMEDIATE` \| `NEXT_PERIOD` \| `PERIOD_START`), `status` (`SCHEDULED` \| `ACTIVE` \| `SUPERSEDED` \| `CANCELLED`), auditoría. La versión vigente a un instante es la de mayor `effectiveFrom` ≤ instante con estado `ACTIVE`. |
| **SettlementConfig** (1 por tenant) | `tenantId`, `settlementPeriodicity` (`WEEKLY` \| `BIWEEKLY` \| `MONTHLY` \| `MANUAL`), auditoría |
| **CommissionRule** | `tenantId`, `itemId`, `beneficiaryId` (nulo = regla general), `percent`, `validFrom`, `validTo`, `active`, `applyMode` (`IMMEDIATE` \| `NEXT_PERIOD` \| `PERIOD_START`), `status` (`SCHEDULED` \| `ACTIVE` \| `CLOSED` \| `CANCELLED`), auditoría |
| **InvoiceLine** (cambio a entidad existente) | Nuevo campo opcional `professionalId` (beneficiario), inmutable tras emitir (HU-COM-10). |
| **CommissionRuleChange** | `ruleId`, `oldPercent`, `newPercent`, vigencia, `changedBy`, `changedAt` |
| **CommissionEntry** (append-only) | `tenantId`, `beneficiaryId`, `sourceType` (`INVOICE_LINE` \| `REVERSAL` \| `ADJUSTMENT`), `revision` (1 al emitir; +1 en cada recálculo), `reasonCode` (`VOID` \| `RECALCULATION`, solo en reversiones), `recalculationId`, `invoiceId`, `invoiceLineId`, `itemId`, `itemKind` (`SERVICE` \| `PRODUCT`), `baseTypeApplied`, `baseAmount`, `taxAmount`, `percentApplied`, `ruleIdApplied`, `ruleOrigin` (`BENEFICIARY_ITEM` \| `ITEM` \| `TENANT_DEFAULT_SERVICE` \| `TENANT_DEFAULT_PRODUCT`), `commissionAmount`, `currency`, `accrualDate`, `settlementId`, `reversesEntryId` |
| **CommissionRecalculation** | `tenantId`, `scopeType` / `scopeRef` (base, % por defecto de servicios o de productos, regla), `periodFrom`, `periodTo`, `entriesRecalculated`, `entriesExcluded`, `deltaAmount`, `requestedBy`, `requestedAt` |
| **Settlement** | `tenantId`, `beneficiaryId`, `periodFrom`, `periodTo`, `status`, `totalAmount`, `approvedBy/At`, `paidBy/At`, `paymentMethod`, `paymentReference` |
| **SettlementAdjustment** | `settlementId`, `amount` (±), `reason`, `createdBy/At` |
| **SettlementStatusChange** | `settlementId`, `fromStatus`, `toStatus`, `changedBy`, `changedAt` |

Restricciones: clave única `(invoiceLineId, sourceType, revision)` para idempotencia; `CommissionEntry` sin `UPDATE`/`DELETE` salvo asignación de `settlementId` en la liquidación.

## 7. Casos límite

| # | Caso | Comportamiento esperado |
|---|------|-------------------------|
| C1 | Tenant cambia la base de `NET_OF_TAX` a `TAX_INCLUDED` a mitad de periodo | Entradas previas conservan su base; las nuevas usan la nueva. La liquidación avisa la mezcla. |
| C2 | Anulación de comprobante tras cambiar la base | La reversión usa la base del snapshot original. |
| C3 | Línea con IVA exento | Ambas bases dan el mismo monto. |
| C4 | Línea con descuento del 100 % | Base 0 → comisión 0; se genera la entrada de todas formas para trazabilidad. |
| C5 | Dos reglas vigentes del mismo alcance | Bloqueado por validación (`COMMISSION_RULE_OVERLAP`). |
| C6 | Profesional desactivado con comisiones pendientes | Se puede seguir liquidando sus entradas existentes; no devenga nuevas si no se le asignan ventas. |
| C7 | Liquidación con total negativo por ajustes | Se arrastra el saldo negativo a la siguiente liquidación. |
| C8 | Reintento de emisión / evento duplicado | Idempotencia por `(invoiceLineId, sourceType, revision)`. |
| C9 | Tenant desactiva la feature flag con liquidaciones abiertas | Se conserva todo el dato; la UI y las generaciones se ocultan/bloquean hasta reactivar. |
| C10 | Línea con cantidad > 1 | La base es el total de la línea (cantidad × precio, tras descuento). |
| C11 | Cambio con `NEXT_PERIOD` y, antes de que rija, el admin hace otro cambio sobre el mismo alcance | Reemplaza al programado previo tras confirmación; el reemplazado queda `CANCELLED` en la auditoría. |
| C12 | Cambio programado cuya fecha llega mientras hay una liquidación en Borrador del periodo anterior | La liquidación del periodo anterior conserva el cálculo viejo; el nuevo solo afecta comprobantes emitidos desde su fecha de vigencia. |
| C13 | Cambio de periodicidad a mitad de periodo | No dispara la pregunta (no altera el cálculo). Rige para las liquidaciones que se generen después y no altera liquidaciones existentes ni cambios programados ya fijados. |
| C14 | Comprobante emitido en el mismo instante en que entra en vigencia un cambio | Se usa `issuedAt` (UTC en servidor) frente a `effectiveFrom`: si `issuedAt` ≥ `effectiveFrom`, aplica el nuevo; el resultado queda en el snapshot. |
| C15 | Dos cambios con `IMMEDIATE` en el mismo periodo | El periodo queda con tres tramos de cálculo; cada línea de la liquidación indica el que usó. |
| C16 | Tenant desactiva la flag con cambios programados | Se conservan; entran en vigencia en su fecha si la flag está activa, sino quedan sin efecto hasta reactivar. |
| C17 | Venta suelta de un producto sin profesional asignado | No genera comisión; aparece en el reporte de líneas sin beneficiario. |
| C18 | Comprobante con servicios y productos de distintos profesionales | Una entrada por línea, cada una con su beneficiario y con la regla de su ítem / tipo. |
| C19 | Profesional con % de excepción para un servicio pero no para un producto | El servicio usa la excepción; el producto usa el % general del producto o, si no existe, el defecto de productos. |
| C20 | Comprobante emitido antes de habilitar el módulo | Sin entradas; no hay backfill, tampoco con `PERIOD_START`. |
| C21 | Anulación de un comprobante cuyas entradas fueron recalculadas | Se revierte la revisión vigente; las revisiones anteriores ya están compensadas por sus contra-entradas. |
| C22 | `PERIOD_START` con parte del periodo ya en una liquidación Aprobada o Pagada | Solo se recalcula lo que no está en ellas; la vista previa informa cuántas entradas quedan fuera. |
| C23 | Dos recálculos `PERIOD_START` en el mismo periodo | Cada uno reemite sobre la revisión vigente; el historial conserva todas las revisiones. |
| C24 | `PERIOD_START` cuando antes hubo un cambio `IMMEDIATE` en el mismo periodo | El nuevo valor sustituye al anterior para todo el periodo; el tramo `IMMEDIATE` deja de aplicar. |
| C25 | `PERIOD_START` sin entradas alcanzadas | Se aplica el cambio con vigencia desde el inicio del periodo; la vista previa muestra 0 entradas. |

## 8. Códigos de error (backend → i18n `femme.apiErrors.*`)

`FEATURE_NOT_ENABLED`, `COMMISSION_BASE_INVALID`, `COMMISSION_PERCENT_OUT_OF_RANGE`, `COMMISSION_RULE_OVERLAP`, `COMMISSION_RULE_NOT_FOUND`, `COMMISSION_CALCULATION_FAILED`, `COMMISSION_PERIOD_OVERLAP`, `COMMISSION_RECALCULATION_FAILED`, `INVOICE_LINE_PROFESSIONAL_INACTIVE`, `COMMISSION_CHANGE_APPLY_MODE_REQUIRED`, `COMMISSION_PENDING_CHANGE_NOT_FOUND`, `COMMISSION_PENDING_CHANGE_ALREADY_EFFECTIVE`, `SETTLEMENT_NOT_FOUND`, `SETTLEMENT_INVALID_STATE_TRANSITION`, `SETTLEMENT_ADJUSTMENT_REASON_REQUIRED`, `SETTLEMENT_NOT_EDITABLE`, `SETTLEMENT_EMPTY`, `COMMISSION_ENTRY_NOT_FOUND`, `COMMISSION_ENTRY_NOT_REASSIGNABLE`, `COMMISSION_REASSIGN_REASON_REQUIRED`, `COMMISSION_REASSIGN_SAME_PROFESSIONAL`.

## 9. Requisitos transversales

- **Seguridad:** endpoints de configuración, reglas y liquidaciones solo `ADMIN`; endpoints de lectura propia para `PROFESSIONAL`, filtrados por el beneficiario del JWT.
- **Logs:** cada endpoint registra en INFO la solicitud y la respuesta (path, método, tenantId, status) y en ERROR los no-2xx.
- **i18n:** todo texto visible en `en.json` y `es.json`, incluidos errores y etiquetas de la base ("Con IVA" / "Sin IVA").
- **UI:** modo claro y oscuro, mobile-first, tablas dentro de `overflow-x-auto`, validación de campos con `FieldValidationError`, componentes del design-system.
- **Feature flag:** `COMMISSIONS` integrada con el sistema de flags existente (global, tier y tenant); ver HU-COM-11.
- **Performance:** el cálculo no debe añadir latencia perceptible a la emisión del comprobante; reproceso asíncrono ante fallos.

## 10. Plan de pruebas Playwright (cobertura de criterios)

| Historia | Escenarios mínimos |
|----------|--------------------|
| HU-COM-01 | Cambiar base y comisión general desde «Reglas generales» con «Guardar cambios»; validación de % inválido; auditoría visible; flag deshabilitada oculta la sección. |
| HU-COM-02 | Crear % general desde el formulario de un servicio y de un producto; varias excepciones distintas por profesional en el mismo ítem; solo profesionales activos sin excepción vigente en la lista; sección «Comisión» oculta para no admin o con flag deshabilitada; vista de Reglas (categorías, contadores, chips con diferencia, «Ver solo excepciones», panel con comisión estimada, varios cambios con un solo «Guardar cambios», «Descartar»); excepción por profesional prevalece; 0 % explícito; historial de cambios; % vigente a una fecha y programados. |
| HU-COM-03 | Vista previa por profesional del periodo vigente (total y subtotales); borrador existente excluido y avisado; profesional obligatorio; no persiste. |
| HU-COM-04 | Emisión genera entradas con snapshot para líneas de servicio y de producto; % por defecto de servicios vs de productos; venta suelta de producto con vendedor; base sin IVA vs con IVA según config; descuento; IVA exento; propina excluida; idempotencia; línea sin profesional. |
| HU-COM-05 | Anulación pre-liquidación revierte; anulación post-liquidación genera ajuste en la siguiente; reversión tras cambio de base usa snapshot. |
| HU-COM-06 | Flujo Borrador→Aprobada→Pagada; ajuste manual con motivo; inmutabilidad; solapamiento bloqueado; mezcla de bases avisada. |
| HU-COM-07 | Profesional ve solo lo suyo; acceso cruzado rechazado. |
| HU-COM-08 | Reportes con filtros; PDF y CSV de liquidación. |
| HU-COM-09 | Diálogo aparece con periodo en curso en cada periodicidad; sin opción preseleccionada; `IMMEDIATE` deja periodo mixto; `NEXT_PERIOD` programa y no altera el periodo actual; cambio programado visible y cancelable; reemplazo de programado; Manual no pregunta; entrada en vigencia automática (reloj controlado); aplica a base, % por defecto y reglas; `PROFESSIONAL` recibe 403; `PERIOD_START`: vista previa con conteos y diferencia, recálculo con contra-entradas, Borrador actualizado, Aprobada/Pagada intactas, ajustes y anulados excluidos, atomicidad ante error, Manual con "desde el último corte", anulación posterior al recálculo. |
| HU-COM-10 | Campo profesional por línea (servicio y producto); precarga desde registro de servicio; asignación manual en venta suelta; profesional inactivo rechazado; aviso de línea sin comisión; campo oculto con flag deshabilitada; **actualizar los specs existentes de HU-14**. |
| HU-COM-12 | Reasignar desde Movimientos (validaciones, reversión + nueva comisión con las reglas del correcto); desde el detalle de un borrador; con liquidación aprobada: aviso, liquidación intacta, corrección en la próxima; códigos de error. |
| HU-COM-11 | Flag apagada por defecto: ningún tenant ve el módulo; habilitar por tier y por tenant con la resolución global Y tier Y tenant; efectos de la flag apagada (menú, campo de HU-COM-10, endpoints, sin entradas); datos conservados al deshabilitar y reactivar; auditoría; `ADMIN` de tenant no puede cambiarla. |
| Aislamiento | Suite `mt-isolation`: reglas, entradas y liquidaciones de un tenant no visibles en otro; la base configurada es independiente por tenant. |

## 11. Fuera de alcance V1

- Reglas escalonadas por volumen, sueldo base y mínimo garantizado.
- Integración con caja (egreso automático al pagar).
- Combos / paquetes con prorrateo entre varios profesionales.
- Devengo al cobrar (V1 devenga solo al emitir).
- Vista inversa en la **ficha del profesional** (todos sus % por ítem); en V1 las excepciones se editan desde el ítem y desde la vista de Reglas.
- Comisión sobre **ganancia / margen** de productos (precio menos costo): la base de V1 es el precio de venta. Requeriría un dato de costo que hoy el catálogo no guarda.
- Devoluciones de producto con reingreso a stock (la reversión por anulación sí está cubierta).
- Recálculo de periodos **ya cerrados** (liquidaciones Aprobadas o Pagadas) o anteriores al periodo vigente: nada de eso se recalcula en V1.
- Notas de crédito: su tratamiento se definirá cuando ese módulo esté implementado.
- Base de cálculo configurable **por regla o por ítem** (decidido: la base es solo por tenant, sin plan de cambiarlo).
- Notificaciones por email al profesional.

## 12. Decisiones sobre preguntas abiertas (cerradas)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿La base debe poder sobrescribirse por ítem o por regla? | **No.** La base es única por tenant. |
| 2 | ¿El profesional ve el desglose del IVA? | **No.** Solo ve la base usada, el monto base, el % y la comisión (HU-COM-07). |
| 3 | ¿Cómo afectan los descuentos globales a la base? | Se usa el **neto ya calculado por línea**; el descuento global del comprobante no se prorratea ni reduce la base (HU-COM-04). |
| 4 | ¿Cómo se definen los periodos semanal, quincenal y mensual? | **Calendario fijo**: semanal lunes a domingo, quincenal días 1–15 y 16–fin de mes, mensual mes calendario (§4.4). |
| 5 | ¿Qué pasa al cambiar la periodicidad a mitad de periodo? | Rige para las **liquidaciones que se generen después**, **sin pregunta**; no toca liquidaciones existentes ni cambios programados (C13). |
| 6 | ¿La vista de reglas acepta una fecha? | **Sí**: muestra el % vigente a esa fecha, incluidos cambios programados (HU-COM-02). El simulador fue reemplazado por la vista previa de liquidación (HU-COM-03). |
| 7 | ¿Se comisiona por servicios y por productos? | **Sí, ambos**, con las mismas reglas por ítem (§2, HU-COM-02, HU-COM-04). |
| 8 | ¿De dónde sale el beneficiario de una línea? | **Campo profesional / vendedor en cada línea del comprobante**, precargado del registro de servicio y editable (HU-COM-10). |
| 9 | ¿El % por defecto es único? | **No**: uno para servicios y otro para productos (HU-COM-01). |
| 10 | ¿Comprobantes anteriores a habilitar el módulo? | **No comisionan**; no hay recálculo retroactivo (HU-COM-04, C20). |
| 11 | ¿Una línea sin profesional bloquea la emisión? | **No**: solo muestra un aviso y no genera comisión (HU-COM-10). |
| 12 | ¿Se comisiona sobre la ganancia del producto? | **No en V1**: la base es el precio de venta (§11). |
| 13 | ¿Se puede aplicar un cambio a todo el periodo vigente? | **Sí, como tercera opción** elegida por el admin: recalcula con contra-entradas lo no cerrado, con vista previa (§4.4, HU-COM-09). |
| 14 | ¿Los Borradores se recalculan? | **Sí.** Solo las liquidaciones Aprobadas y Pagadas quedan intactas. |
| 15 | ¿Cómo se interpreta con periodicidad Manual? | **Desde el último corte**: entradas posteriores a la última liquidación Aprobada o Pagada del beneficiario. |
| 16 | ¿La devolución de stock al anular forma parte de comisiones? | **No**: la gestiona la integración con Stock (HU-64); la reversión de la comisión es independiente (HU-COM-05). |
| 17 | ¿Dónde se define el % de un ítem y las excepciones por profesional? | En la **sección «Comisión» del formulario del ítem** (Servicios / Productos), con lista de excepciones por profesional, y en la **vista de Reglas** (Servicios / Productos, con panel por ítem) como vista global. **Sin vista inversa** en la ficha del profesional en V1 (HU-COM-02). |
| 18 | ¿Cómo se habilita el módulo? | Feature flag `COMMISSIONS` apagada por defecto, activada por `PLATFORM_ADMIN` por tier y por tenant, como `STOCK_MODULE` (HU-COM-11). |

No quedan preguntas abiertas.
