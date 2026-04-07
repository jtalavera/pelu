# HU-02b · Configurar timbrado fiscal


| Campo      | Valor                                 |
| ---------- | ------------------------------------- |
| **ID**     | HU-02b                                |
| **Módulo** | Autenticación & configuración inicial |
| **Estado** | `Backlog`                             |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** registrar el timbrado habilitado por la SET y definir desde qué número comenzar a emitir facturas,  
**para** que el sistema genere la numeración correlativa correcta conforme a la resolución vigente.

**Contexto:** En Paraguay, la SET asigna timbrado, rango y vigencia; las facturas deben respetar rango y timbrado.

---

## Criterios de aceptación

1. **Ubicación y acceso** — Existe una sección “Timbrado” dentro de Configuración, accesible solo para el administrador.
2. **Campos del timbrado** — Se puede registrar un timbrado con: número de timbrado (numérico), fecha inicio de vigencia, fecha de vencimiento, número desde, número hasta, número de inicio de emisión (continuidad desde sistema anterior).
3. **Rango de inicio de emisión** — El “número de inicio de emisión” debe estar entre “número desde” y “número hasta”; si no, el guardado se bloquea con mensaje de error.
4. **Vigencia** — La fecha de vencimiento debe ser posterior a la fecha de inicio de vigencia; si no, error claro.
5. **Inmutabilidad tras uso** — Tras emitir al menos una factura con ese timbrado, no se puede modificar el número de timbrado ni el rango; solo desactivar y crear uno nuevo.
6. **Un activo** — Puede haber más de un timbrado registrado, pero solo uno activo a la vez (activar uno desactiva el otro o el flujo equivalente documentado).
7. **Alerta vencimiento** — El dashboard muestra alerta cuando el timbrado activo vence en menos de 30 días.
8. **Alerta rango** — Alerta cuando queda menos del 10 % del rango de numeración disponible.
9. **Bloqueo por vencimiento o agotamiento** — Si el timbrado está vencido o el rango está agotado, no se pueden emitir nuevas facturas y se muestra un mensaje explicativo con instrucciones para cargar un nuevo timbrado.

---

## Notas para estimación y pruebas

- **Pruebas:** límites de rango, cambio de timbrado activo, primera factura → bloqueo de edición, alertas (fechas y porcentaje simulados), bloqueo al vencer/agotar.