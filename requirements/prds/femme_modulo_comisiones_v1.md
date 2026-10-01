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
| P3 | **Snapshot en cada entrada** | Cada entrada guarda congelados: % aplicado, origen de la regla, base de cálculo usada, monto base y moneda. Cambios posteriores de reglas o configuración **no alteran lo ya devengado**. |
| P4 | **Idempotencia** | Reintentos del evento generador (emisión del comprobante) no duplican entradas. |
| P5 | **Auditabilidad** | Toda acción de configuración, aprobación y pago registra quién, cuándo y valor anterior/nuevo. |
| P6 | **Multi-tenant estricto** | Todo dato y toda configuración están aislados por tenant. Cubierto por la suite `mt-isolation`. |

## 2. Glosario

| Término genérico | En peluquería (V1) |
|------------------|--------------------|
| **Beneficiario** | Profesional (`Professional`). |
| **Ítem comisionable** | Servicio o producto (`SalonService`; los productos son servicios de la categoría "Productos", ver HU-31). |
| **Evento generador** | Emisión de un comprobante (`Invoice`). |
| **Línea comisionable** | Línea de comprobante (`InvoiceLine`) asociada a un beneficiario. |
| **Regla de comisión** | Porcentaje aplicable a un ítem, general o por beneficiario. |
| **Entrada de comisión** | Registro inmutable generado por una línea (o un ajuste). |
| **Liquidación** | Agrupación de entradas de un periodo para un beneficiario, que se aprueba y se paga. |

## 3. Decisiones de producto acordadas

| Tema | Decisión |
|------|----------|
| **Devengo** | Al **emitir el comprobante**. Si se anula, la comisión se revierte (ver HU-COM-05). |
| **Tipo de regla (V1)** | **Porcentaje** sobre el valor del ítem. |
| **Resolución del %** | 1) % específico **beneficiario + ítem**, 2) % **general del ítem**, 3) **% por defecto del negocio**. |
| **Base de cálculo** | **Configurable por tenant**: *con IVA* o *sin IVA* (ver §4). Siempre **después de descuentos**. |
| **Pago** | Liquidaciones por periodo con aprobación y marca de pagado. Sin integración con caja en V1. |
| **Anulación tras liquidar** | **Ajuste negativo** en la próxima liquidación; las liquidaciones cerradas son inmutables. |
| **Periodicidad** | Configurable por tenant: semanal, quincenal, mensual o rango manual. |
| **Permisos** | `ADMIN` configura, aprueba, paga y ve todo. `PROFESSIONAL` ve **solo lo suyo**, en lectura. |
| **Habilitación** | Feature flag `COMMISSIONS` por tenant / tier. |

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
2. El cambio **rige hacia adelante**: solo afecta comprobantes emitidos **desde ese momento**. No recalcula entradas existentes (P3).
3. Cada entrada de comisión guarda la base con la que fue calculada (`baseTypeApplied`). Las **reversiones** por anulación usan **el snapshot de la entrada original**, nunca la configuración vigente.
4. En una misma liquidación pueden coexistir entradas calculadas con bases distintas (si el tenant cambió la base durante el periodo). La liquidación y los reportes muestran la base de cada entrada y avisan cuando hay mezcla.
5. La pantalla de configuración muestra una advertencia explícita de que el cambio **no es retroactivo**, con confirmación antes de guardar.

---

## 5. Historias de usuario

### HU-COM-01 · Configurar el módulo de comisiones del negocio

**Como** administrador,
**quiero** configurar los parámetros generales de comisiones de mi negocio,
**para** que el cálculo se ajuste a mis políticas.

**Criterios de aceptación:**
- [ ] Existe una pantalla de configuración de comisiones accesible solo para `ADMIN`; si la feature flag `COMMISSIONS` no está habilitada para el tenant, la sección no aparece y la API responde `FEATURE_NOT_ENABLED`.
- [ ] Puedo elegir la **base de cálculo**: *Sin IVA* o *Con IVA* (por defecto *Sin IVA*). Cada opción incluye texto de ayuda con el ejemplo de §4.2.
- [ ] Al cambiar la base se muestra una confirmación que indica que el cambio **no es retroactivo** y solo afecta comprobantes emitidos de ahí en adelante.
- [ ] Puedo definir el **% por defecto del negocio** (0–100, hasta 2 decimales; por defecto 0 %).
- [ ] Puedo elegir la **periodicidad de liquidación**: semanal, quincenal, mensual o manual.
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
- [ ] Si no existe ni % general ni excepción, se aplica el **% por defecto del negocio**.
- [ ] Cada regla admite **vigencia** (fecha desde, fecha hasta opcional). Dos reglas del mismo alcance (mismo ítem, o mismo profesional+ítem) **no pueden solaparse** (`COMMISSION_RULE_OVERLAP`).
- [ ] Una regla vigente puede cerrarse (poner fecha hasta) pero **no se elimina** si ya generó entradas; se desactiva.
- [ ] Existe un **historial de cambios** por regla (quién, cuándo, % anterior y nuevo, vigencia).
- [ ] Puedo ver una **matriz** de profesionales × ítems con el % efectivo y su origen (excepción / general / defecto del negocio).
- [ ] El catálogo muestra una advertencia en los ítems sin % general (usan el defecto del negocio).
- [ ] Las reglas nuevas **no modifican** entradas ya devengadas.

### HU-COM-03 · Simulador de comisión

**Como** administrador,
**quiero** simular qué comisión se aplicaría a un ítem y profesional,
**para** validar mis reglas antes de que impacten en liquidaciones.

**Criterios de aceptación:**
- [ ] Ingreso: ítem, profesional, monto de la línea con IVA, tasa de IVA, descuento opcional y fecha (por defecto hoy).
- [ ] Salida: monto base según la **base configurada del tenant** (con la fórmula visible), % aplicado, **origen del %** (excepción / general / defecto del negocio) y comisión resultante.
- [ ] Puedo ver el resultado con la **otra base** a modo de comparación (sin guardar nada).
- [ ] El simulador **no persiste** datos.

### HU-COM-04 · Generación automática de comisiones al emitir un comprobante

**Como** sistema,
**quiero** generar las entradas de comisión al emitir un comprobante,
**para** que el devengo sea automático y consistente.

**Criterios de aceptación:**
- [ ] Al emitir un comprobante se genera **una entrada por línea** con profesional asignado y se atribuye al periodo según la fecha de emisión.
- [ ] El monto base se calcula según la **base configurada del tenant** en el instante de la emisión (§4), después de descuentos.
- [ ] La entrada guarda un **snapshot**: % aplicado, origen de la regla (id), `baseTypeApplied`, monto base, monto IVA de la línea, moneda y comisión resultante.
- [ ] Las **propinas** no generan comisión.
- [ ] La base parte del **neto ya calculado por línea** (`lineNet`, tras el descuento de esa línea). El sistema solo admite descuentos por línea, por lo que no hay prorrateo de descuentos globales.
- [ ] El proceso es **idempotente**: reintentar la emisión no duplica entradas (clave única por comprobante + línea).
- [ ] El redondeo se hace **por entrada** a la unidad mínima de la moneda (Gs sin decimales) con `HALF_UP`.
- [ ] Una línea sin profesional asignado **no genera comisión** y queda listada en el reporte de "líneas sin beneficiario".
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
- [ ] **Notas de crédito (cuando existan):** se comportan igual que la anulación, con reversión **proporcional al monto acreditado**, usando el snapshot original (misma base y mismo %) y ajuste negativo en la próxima liquidación si la comisión ya fue liquidada. El diseño debe soportarlo sin cambios en el modelo de datos (`sourceType = REVERSAL` con `reversesEntryId` y monto parcial); su implementación se planifica junto con el módulo de notas de crédito.

### HU-COM-06 · Gestionar liquidaciones por periodo

**Como** administrador,
**quiero** generar, revisar, aprobar y marcar como pagadas las liquidaciones de comisiones,
**para** pagar correctamente a cada profesional y tener un historial.

**Criterios de aceptación:**
- [ ] Puedo generar liquidaciones para un periodo según la periodicidad del tenant (o un rango manual). Se crea una liquidación **Borrador** por beneficiario con las entradas del periodo aún no liquidadas.
- [ ] Una entrada pertenece a **una sola** liquidación; no puede liquidarse dos veces.
- [ ] Estados: **Borrador → Aprobada → Pagada**, y **Anulada** (solo desde Borrador o Aprobada, nunca desde Pagada).
- [ ] La liquidación muestra: detalle por línea (fecha, comprobante, ítem, base usada, monto base, %, comisión), subtotales por ítem, ajustes y total.
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
- [ ] Veo mis comisiones devengadas del periodo en curso y mis liquidaciones (estado, periodo, total).
- [ ] Veo el detalle por línea de mis liquidaciones, en **solo lectura**.
- [ ] **No** veo comisiones ni liquidaciones de otros profesionales, ni la configuración de reglas de otros (la API devuelve `403`/`404` ante intentos de acceso cruzado).
- [ ] Veo la base de cálculo usada en cada línea (con IVA / sin IVA) y el monto base, pero **no** el IVA discriminado ni el total de la línea; esos campos no se exponen en la API del profesional.
- [ ] Si la feature flag no está habilitada, la sección no aparece.

### HU-COM-08 · Reportes y exportación

**Como** administrador,
**quiero** consultar y exportar reportes de comisiones,
**para** analizar costos y conciliar pagos.

**Criterios de aceptación:**
- [ ] Reporte de comisiones por **profesional**, por **ítem** y por **periodo**, con filtros de fecha, profesional y estado de liquidación.
- [ ] Reporte de **líneas sin beneficiario** y de **ítems sin % general** (usan el defecto).
- [ ] **Comprobante de liquidación** imprimible en PDF (datos del negocio, profesional, periodo, detalle, ajustes, total, base de cálculo usada).
- [ ] **Exportación CSV** de entradas y de liquidaciones, con la base y el % aplicados por línea.
- [ ] Los montos y fechas respetan el formato y la zona horaria del servidor.

---

## 6. Modelo de datos conceptual

> Nombres orientativos; la implementación sigue las convenciones del repo (Flyway, JPA).

| Entidad | Campos clave |
|---------|--------------|
| **CommissionSettings** (1 por tenant) | `tenantId`, `commissionBase` (`NET_OF_TAX` \| `TAX_INCLUDED`), `defaultPercent`, `settlementPeriodicity` (`WEEKLY` \| `BIWEEKLY` \| `MONTHLY` \| `MANUAL`), auditoría |
| **CommissionRule** | `tenantId`, `itemId`, `beneficiaryId` (nulo = regla general), `percent`, `validFrom`, `validTo`, `active`, auditoría |
| **CommissionRuleChange** | `ruleId`, `oldPercent`, `newPercent`, vigencia, `changedBy`, `changedAt` |
| **CommissionEntry** (append-only) | `tenantId`, `beneficiaryId`, `sourceType` (`INVOICE_LINE` \| `REVERSAL` \| `ADJUSTMENT`), `invoiceId`, `invoiceLineId`, `itemId`, `baseTypeApplied`, `baseAmount`, `taxAmount`, `percentApplied`, `ruleIdApplied`, `ruleOrigin` (`BENEFICIARY_ITEM` \| `ITEM` \| `TENANT_DEFAULT`), `commissionAmount`, `currency`, `accrualDate`, `settlementId`, `reversesEntryId` |
| **Settlement** | `tenantId`, `beneficiaryId`, `periodFrom`, `periodTo`, `status`, `totalAmount`, `approvedBy/At`, `paidBy/At`, `paymentMethod`, `paymentReference` |
| **SettlementAdjustment** | `settlementId`, `amount` (±), `reason`, `createdBy/At` |
| **SettlementStatusChange** | `settlementId`, `fromStatus`, `toStatus`, `changedBy`, `changedAt` |

Restricciones: clave única `(invoiceLineId, sourceType)` para idempotencia; `CommissionEntry` sin `UPDATE`/`DELETE` salvo asignación de `settlementId` en la liquidación.

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
| C8 | Reintento de emisión / evento duplicado | Idempotencia por `(invoiceLineId, sourceType)`. |
| C9 | Tenant desactiva la feature flag con liquidaciones abiertas | Se conserva todo el dato; la UI y las generaciones se ocultan/bloquean hasta reactivar. |
| C10 | Línea con cantidad > 1 | La base es el total de la línea (cantidad × precio, tras descuento). |

## 8. Códigos de error (backend → i18n `femme.apiErrors.*`)

`FEATURE_NOT_ENABLED`, `COMMISSION_BASE_INVALID`, `COMMISSION_PERCENT_OUT_OF_RANGE`, `COMMISSION_RULE_OVERLAP`, `COMMISSION_RULE_NOT_FOUND`, `COMMISSION_CALCULATION_FAILED`, `COMMISSION_PERIOD_OVERLAP`, `SETTLEMENT_NOT_FOUND`, `SETTLEMENT_INVALID_STATE_TRANSITION`, `SETTLEMENT_ADJUSTMENT_REASON_REQUIRED`, `SETTLEMENT_NOT_EDITABLE`, `SETTLEMENT_EMPTY`.

## 9. Requisitos transversales

- **Seguridad:** endpoints de configuración, reglas y liquidaciones solo `ADMIN`; endpoints de lectura propia para `PROFESSIONAL`, filtrados por el beneficiario del JWT.
- **Logs:** cada endpoint registra en INFO la solicitud y la respuesta (path, método, tenantId, status) y en ERROR los no-2xx.
- **i18n:** todo texto visible en `en.json` y `es.json`, incluidos errores y etiquetas de la base ("Con IVA" / "Sin IVA").
- **UI:** modo claro y oscuro, mobile-first, tablas dentro de `overflow-x-auto`, validación de campos con `FieldValidationError`, componentes del design-system.
- **Feature flag:** `COMMISSIONS` integrada con el sistema de flags por tenant/tier.
- **Performance:** el cálculo no debe añadir latencia perceptible a la emisión del comprobante; reproceso asíncrono ante fallos.

## 10. Plan de pruebas Playwright (cobertura de criterios)

| Historia | Escenarios mínimos |
|----------|--------------------|
| HU-COM-01 | Cambiar base con confirmación; validación de % inválido; auditoría visible; flag deshabilitada oculta la sección. |
| HU-COM-02 | Crear % general; excepción por profesional prevalece; 0 % explícito; solapamiento rechazado; historial de cambios; matriz de % efectivos. |
| HU-COM-03 | Simulación con base sin IVA y con IVA; comparación; no persiste. |
| HU-COM-04 | Emisión genera entradas con snapshot; base sin IVA vs con IVA según config; descuento; IVA exento; propina excluida; idempotencia; línea sin profesional. |
| HU-COM-05 | Anulación pre-liquidación revierte; anulación post-liquidación genera ajuste en la siguiente; reversión tras cambio de base usa snapshot. |
| HU-COM-06 | Flujo Borrador→Aprobada→Pagada; ajuste manual con motivo; inmutabilidad; solapamiento bloqueado; mezcla de bases avisada. |
| HU-COM-07 | Profesional ve solo lo suyo; acceso cruzado rechazado. |
| HU-COM-08 | Reportes con filtros; PDF y CSV de liquidación. |
| Aislamiento | Suite `mt-isolation`: reglas, entradas y liquidaciones de un tenant no visibles en otro; la base configurada es independiente por tenant. |

## 11. Fuera de alcance V1

- Reglas escalonadas por volumen, sueldo base y mínimo garantizado.
- Integración con caja (egreso automático al pagar).
- Combos / paquetes con prorrateo entre varios profesionales.
- Devengo al cobrar (V1 devenga solo al emitir).
- Base de cálculo configurable **por regla o por ítem** (decidido: la base es solo por tenant, sin plan de cambiarlo).
- Notificaciones por email al profesional.

## 12. Decisiones sobre preguntas abiertas (cerradas)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿La base debe poder sobrescribirse por ítem o por regla? | **No.** La base es única por tenant. |
| 2 | ¿El profesional ve el desglose del IVA? | **No.** Solo ve la base usada, el monto base, el % y la comisión (HU-COM-07). |
| 3 | ¿Cómo afectan los descuentos globales a la base? | Se usa el **neto ya calculado por línea**; el sistema solo admite descuento por línea, no hay prorrateo (HU-COM-04). |
| 4 | ¿Las notas de crédito se comportan como la anulación? | **Sí**, con reversión proporcional al monto acreditado; se implementa junto con el módulo de notas de crédito (HU-COM-05). |

No quedan preguntas abiertas.
