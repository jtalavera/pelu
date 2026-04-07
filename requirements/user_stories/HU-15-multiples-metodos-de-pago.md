# HU-15 · Registrar pagos con múltiples métodos

| Campo | Valor |
|--------|--------|
| **ID** | HU-15 |
| **Módulo** | Facturación |
| **Estado** | `Backlog` |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** dividir el pago de un comprobante entre más de un método,  
**para** registrar correctamente cuando la cliente paga parte en efectivo y parte con tarjeta.

---

## Criterios de aceptación

1. **Varios métodos** — En el flujo de facturación se pueden agregar más de un método de pago con su monto cada uno.
2. **Cuadre con total** — La suma de los montos por método debe igualar el total del comprobante para poder confirmar; si no, el sistema impide confirmar y muestra el error.
3. **Saldo pendiente** — Mientras se cargan métodos, el sistema muestra el monto restante por asignar (total − suma asignada).

---

## Notas para estimación y pruebas

- Depende de HU-14 (totales y confirmación).
- **Pruebas:** un solo método (regresión), dos métodos que suman exacto, desajuste de $1, redondeos si aplica.
