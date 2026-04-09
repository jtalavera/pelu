# HU-13 · Abrir la caja del día


| Campo      | Valor       |
| ---------- | ----------- |
| **ID**     | HU-13       |
| **Módulo** | Facturación |
| **Estado** | `Backlog`   |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** registrar la apertura de caja con el monto inicial en efectivo,  
**para** tener un control del flujo de dinero del día.

---

## Criterios de aceptación

1. **Solicitud de apertura** — Al iniciar el día (o al intentar operar sin caja abierta), el sistema solicita abrir la caja con monto inicial en efectivo.
2. **Emisión de comprobantes** — No se pueden emitir comprobantes hasta abrir la caja (no hay flujo de “saltear” apertura en esta etapa).
3. **Una caja abierta por tenant** — No puede haber más de una caja **abierta** a la vez por negocio; **no se puede abrir** otra si ya existe una abierta. No se obliga a cerrar la caja para seguir operando.
4. **Registro de auditoría** — La apertura queda registrada con fecha, hora y usuario (identificador del admin que abre).

---

## Notas para estimación y pruebas

- **Pruebas:** segundo intento de apertura con caja ya abierta bloqueado, emisión sin caja bloqueada, campos de auditoría correctos.