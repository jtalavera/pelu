# Plantillas de WhatsApp para presentar a Meta (Pelu / Flowbit)

Versión 1 · 26/11/2026 · Idioma de todas: **Español (`es`)** · Variables **posicionales** (`{{1}}`, `{{2}}`…)

Se crean en el administrador de WhatsApp de Meta (Message templates → Create template). Para cada una: nombre, categoría, idioma, cuerpo, pie, botones y **valores de ejemplo** (Meta los exige para cada variable).

**Antes de cargarlas**
- Reemplazá `DOMINIO` por el dominio público del frontend, en las seis URL de botón (`https://DOMINIO/r/{{1}}`). Tiene que ser `https` y un dominio tuyo.
- Todos los botones de enlace usan la **misma base** `https://DOMINIO/r/`. Lo variable (`{{1}}`) lleva el resto de la ruta. Ejemplos de lo que enviará el sistema: `bella/turno/abc123` (ver o cambiar un turno) o `bella` (página de reservas del salón).
- Mantené los textos tal cual: son estrictamente transaccionales. Agregar promociones o descuentos puede hacer que Meta los recategorice como «marketing».
- Las variables no pueden estar al inicio ni al final del cuerpo; en estos textos ya están ubicadas así.

**Valores de ejemplo sugeridos (para los campos «Sample»):** `{{1}}` María · `{{2}}` Salón Bella · `{{3}}` Corte y brushing · `{{4}}` viernes 28/11 · `{{5}}` 15:30 · `{{6}}` Laura

---

## 1. `pelu_codigo_verificacion`
- **Categoría:** Autenticación
- **Configuración:** botón **«Copiar código»**; activar «agregar recomendación de seguridad» (no compartir el código); **vencimiento del código: 10 minutos**.
- **Cuerpo:** lo genera Meta (no se redacta). La variable `{{1}}` es el código. Ejemplo: `482915`.

## 2. `pelu_turno_confirmado`
- **Categoría:** Utilidad
- **Cuerpo:**
  `Hola {{1}}, tu turno en {{2}} está confirmado: {{3}}, el {{4}} a las {{5}} con {{6}}. Podés verlo o cambiarlo con el botón de abajo.`
- **Pie:** `Respondé BAJA para dejar de recibir avisos`
- **Botón de enlace:** texto `Ver o cambiar turno` · URL `https://DOMINIO/r/{{1}}` · ejemplo `bella/turno/abc123`

## 3. `pelu_turno_pendiente`
- **Categoría:** Utilidad
- **Cuerpo:**
  `Hola {{1}}, recibimos tu solicitud de turno en {{2}}: {{3}}, el {{4}} a las {{5}}. El salón la va a confirmar y te avisamos por este medio.`
- **Pie:** `Respondé BAJA para dejar de recibir avisos`
- **Botón de enlace:** texto `Ver mi solicitud` · URL `https://DOMINIO/r/{{1}}` · ejemplo `bella/turno/abc123`

## 4. `pelu_turno_no_disponible`
- **Categoría:** Utilidad
- **Cuerpo:**
  `Hola {{1}}, {{2}} no pudo confirmar tu solicitud de {{3}} para el {{4}}. Podés elegir otro horario con el botón de abajo.`
- **Pie:** `Respondé BAJA para dejar de recibir avisos`
- **Botón de enlace:** texto `Elegir otro horario` · URL `https://DOMINIO/r/{{1}}` · ejemplo `bella`

## 5. `pelu_propuesta_horario`
- **Categoría:** Utilidad
- **Cuerpo:**
  `Hola {{1}}, {{2}} te propone cambiar tu turno de {{3}} del {{4}}. Elegí el nuevo horario con el botón de abajo.`
- **Pie:** `Respondé BAJA para dejar de recibir avisos`
- **Botón de enlace:** texto `Elegir nuevo horario` · URL `https://DOMINIO/r/{{1}}` · ejemplo `bella/turno/abc123`

## 6. `pelu_recordatorio_turno`
- **Categoría:** Utilidad
- **Cuerpo:**
  `Hola {{1}}, te recordamos tu turno en {{2}}: {{3}}, el {{4}} a las {{5}}. ¿Podés venir?`
- **Pie:** `Respondé BAJA para dejar de recibir avisos`
- **Botones (en este orden):**
  1. Respuesta rápida: `Confirmo`
  2. Respuesta rápida: `No puedo ir`
  3. Enlace: texto `Ver mi turno` · URL `https://DOMINIO/r/{{1}}` · ejemplo `bella/turno/abc123`

## 7. `pelu_turno_cancelado`
- **Categoría:** Utilidad
- **Cuerpo:**
  `Hola {{1}}, tu turno en {{2}} de {{3}} del {{4}} quedó cancelado.`
- **Pie:** `Respondé BAJA para dejar de recibir avisos`
- **Botón de enlace:** texto `Ver horarios` · URL `https://DOMINIO/r/{{1}}` · ejemplo `bella`
- *Si Meta lo recategoriza a «marketing» por el botón, se quita el botón y se vuelve a presentar.*

---

## Orden de las variables (lo que implementará el sistema)

| Plantilla | `{{1}}` | `{{2}}` | `{{3}}` | `{{4}}` | `{{5}}` | `{{6}}` |
| --------- | ------- | ------- | ------- | ------- | ------- | ------- |
| `pelu_turno_confirmado` | nombre | salón | servicio | fecha | hora | profesional |
| `pelu_turno_pendiente` | nombre | salón | servicio | fecha | hora | — |
| `pelu_turno_no_disponible` | nombre | salón | servicio | fecha | — | — |
| `pelu_propuesta_horario` | nombre | salón | servicio | fecha | — | — |
| `pelu_recordatorio_turno` | nombre | salón | servicio | fecha | hora | — |
| `pelu_turno_cancelado` | nombre | salón | servicio | fecha | — | — |

Si Meta pide cambiar un texto, el **orden de las variables no debe cambiar** sin avisar, porque el código las envía por posición.

## Nota
Armé este formato según mi conocimiento de la API y del administrador de Meta, sin consultar su documentación vigente en esta sesión. Si la pantalla de Meta pide algo distinto (por ejemplo otros nombres de campos o límites de longitud), ajustá y avisame para actualizar la especificación.
