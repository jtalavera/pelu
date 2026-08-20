# HU-52 · Importar clientes desde Excel

| Campo      | Valor                                            |
| ---------- | --------------------------------------------------|
| **ID**     | HU-52                                             |
| **Módulo** | Plataforma · Importación de datos vía Excel       |
| **Estado** | `Backlog`                                         |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (unicidad de clientes ignora valores vacíos, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Formato estándar de importación: [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** importar la cartera de clientes de un tenant desde una planilla Excel,
**para** no tener que cargarlos uno por uno al dar de alta un negocio nuevo.

---

## Criterios de aceptación

1. **Selección de archivo y tenant** — El Platform Admin elige el tenant destino y sube un archivo `.xlsx` con el formato de HU-50.
2. **Nombre obligatorio** — Filas sin `nombre_completo` se rechazan individualmente sin detener la importación del resto.
3. **Unicidad respetando reglas del PRD MVP** — Se aplican las mismas reglas de unicidad por tenant que en el alta manual de clientes: teléfono, email o RUC no vacíos duplicados dentro del mismo tenant se rechazan fila por fila.
4. **RUC validado** — Si se completa `ruc`, se valida con el mismo dígito verificador paraguayo usado en el alta manual de clientes; un RUC inválido rechaza esa fila puntual.
5. **Campos vacíos permitidos** — Filas con solo `nombre_completo` completo son válidas; el resto de columnas opcionales pueden quedar vacías.
6. **Aislamiento** — Los clientes importados quedan asociados exclusivamente al tenant seleccionado y no colisionan con clientes de otros tenants aunque compartan teléfono, email o RUC.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-50 (formato estándar), HU-37 (el tenant debe existir).
- **Pruebas sugeridas:** importación exitosa; fila sin nombre rechazada; RUC inválido rechazado; duplicado de teléfono/email/RUC dentro del mismo tenant rechazado; mismos datos de contacto en tenants distintos aceptados.
