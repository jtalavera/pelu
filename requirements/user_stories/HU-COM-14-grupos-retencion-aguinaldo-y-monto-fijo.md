# HU-COM-14 · Comisiones por grupo, retención de aguinaldo y monto fijo por servicio

| Campo      | Valor                         |
| ---------- | ----------------------------- |
| **ID**     | HU-COM-14                     |
| **Módulo** | Comisiones (front y back)     |
| **Estado** | `In Progress`                 |

## Definiciones transversales

Multi-tenant y convenciones: [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Módulo base: [Módulo de comisiones v1](../prds/femme_modulo_comisiones_v1.md).

---

## Historia de usuario

**Como** administradora del salón,  
**quiero** cargar las reglas de comisión de cada profesional por grupo de servicios, con una retención para su aguinaldo y un monto fijo por servicio (costo de producto),  
**para** que las liquidaciones salgan con las reglas reales del salón y que lo retenido se acumule en un fondo que se paga cuando corresponde.

---

## Contexto

Mockup aprobado: «Comisiones v2: reglas del salón». El salón paga a cada profesional un % distinto por grupo de servicios (Brushing, Color, Manos…) y a algunas les retiene un 5 % para su aguinaldo. En Manos y Pies (3.000 por servicio) y en Pestañas (20.000) el producto lo pone la profesional: ese monto fijo se descuenta del precio antes de calcular los porcentajes y se le paga completo. Otros salones pueden querer que ese monto quede para el salón.

### Cómo se calcula una línea

1. Se toma el precio de la línea después de descuentos, con IVA o sin IVA según «Base de cálculo» (Configuración).
2. Se resta el **monto fijo** (nunca queda una base menor que 0; una línea sin precio no genera nada).
3. Sobre el resto: el **% que se paga** y el **% que se retiene** para aguinaldo (la retención solo aplica si el salón la activó).
4. Si el monto fijo es **para la profesional**, se le suma completo a lo que cobra y **no se retiene**. Si es **para el salón**, solo baja la base.
5. Lo que cobra ahora = lo que se paga + el monto fijo cuando es suyo. La retención no se paga en la liquidación: pasa al fondo de aguinaldo cuando la liquidación se **aprueba**.

### Qué regla gana

Profesional + servicio puntual, profesional + grupo, servicio (para todo el equipo), grupo (para todo el equipo) y, por último, el % por defecto de servicios o productos.

---

## Criterios de aceptación

1. **Grupos de comisión** — En Reglas hay una solapa «Grupos». Se puede crear un grupo (nombre obligatorio y sin repetir), renombrarlo y eliminarlo; un grupo con reglas cargadas no se puede eliminar. Cada servicio pertenece como máximo a un grupo.
2. **Servicios sin grupo y sugerencias** — «Grupos» lista los servicios sin grupo; cada uno muestra el grupo que sugiere su nombre (el nombre del grupo, o «baño de crema» / «apli» para Tratamiento) con «Aceptar», o se elige a mano. «Aceptar todas las sugerencias» asigna solo los que tienen sugerencia. Los productos sin grupo se asignan de una vez a un solo grupo.
3. **Reglas por profesional** — «Reglas» abre en «Por profesional» (junto a «Servicios», «Productos» y «Grupos»). Se elige la profesional y se ve una fila por cada grupo con regla propia: Se paga (%), Retención (%), Total, Monto fijo y A quién va. Los demás grupos quedan plegados, con el aviso de que usan el % por defecto.
4. **Editar y guardar** — Escribir los valores deja los cambios sin guardar («N cambios sin guardar»); «Guardar cambios» pregunta desde cuándo rige (como hoy) y las reglas quedan guardadas. Al crear una regla nueva la retención se precarga con la de la profesional.
5. **Validaciones** — Lo que se paga más la retención no puede superar 100 %; el % debe estar entre 0 y 100 con hasta 2 decimales; el monto fijo es un entero en guaraníes. Cada error dice la regla y trae un ejemplo, y mientras haya un error esa fila no se guarda.
6. **Ejemplo en vivo** — Tocar una fila muestra con un precio de prueba: monto fijo, base, lo que se paga, lo que se retiene, lo que cobra la profesional y lo que queda en el salón.
7. **Copiar reglas** — «Copiar reglas de otra profesional…» deja las reglas propias de la elegida como cambios sin guardar de la profesional actual.
8. **Retención de aguinaldo** — En Configuración se activa o desactiva («Retención para aguinaldo»), se define el % por defecto y quién retiene (% por profesional, que precarga sus reglas). Con la retención desactivada las reglas no retienen nada, no se muestra la columna «Retención» y se avisa.
9. **Monto fijo** — En Configuración se elige para quién es por defecto (la profesional o el salón) y cada regla puede cambiarlo. Con destino «profesional» la profesional cobra el monto fijo completo y sin retención; con destino «salón» solo baja la base.
10. **Cálculo y registro** — Al emitir un comprobante cada línea guarda lo calculado: base, % pagado, retención, monto fijo, a quién va y de qué regla salió. Las anulaciones revierten comisión, monto fijo y retención.
11. **Liquidación** — La liquidación y la vista previa muestran el costo de producto y lo retenido; el total es lo que se paga ahora. Cada línea indica su costo de producto y su retención.
12. **Fondo de aguinaldo** — La solapa «Aguinaldo» muestra el total retenido y el saldo de cada profesional con su último pago. Un borrador no suma: la retención entra al aprobar la liquidación y sale si se anula. «Ver movimientos» lista liquidaciones, pagos y ajustes con el saldo corrido.
13. **Pagos del fondo** — Se paga todo el saldo o un monto parcial (no puede superar el saldo), con fecha y medio de pago. «Es por salida de la profesional» paga todo el saldo y cierra el fondo. «Pagar el saldo completo a todas…» registra el pago de cada profesional con saldo.
14. **Ajuste manual** — Se puede sumar o restar al fondo con un motivo obligatorio; no puede dejar el saldo en negativo.
15. **Vista de la profesional** — «Mis comisiones» muestra, cuando el salón retiene, lo retenido del periodo y el aguinaldo acumulado, y en cada línea el costo de producto incluido y lo retenido.
16. **Auditoría** — Los cambios de reglas, grupos y retención quedan en el historial y en los cambios programados con el grupo, la profesional y el valor; se pueden programar (próximo periodo) o aplicar desde el inicio del periodo con recálculo, igual que el resto de las reglas.

---

## Notas

- Casos de las reglas del salón (precio con IVA): Gaby Brushing 100.000 → 45.000 se paga y 5.000 se retiene; Gaby Pestañas 50.000 con monto fijo 20.000 → base 30.000, cobra 33.500 y retiene 1.500; Migue Manos 50.000 con monto fijo 3.000 → base 47.000, cobra 24.150 y retiene 2.350; Jorgelina Manos 50.000 (50 %, sin retención) → cobra 26.500; Aracely producto 80.000 (5 % + 5 %) → cobra 4.000 y retiene 4.000.
- El aguinaldo es un fondo interno del salón; no reemplaza la liquidación legal de haberes.
- La carga inicial de las reglas del salón se hace con «Copiar reglas de otra profesional…» (Migue, Norma y María comparten reglas).
