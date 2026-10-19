# HU-10 · Crear un cliente


| Campo      | Valor          |
| ---------- | -------------- |
| **ID**     | HU-10          |
| **Módulo** | Cliente básico |
| **Estado** | `Done`      |


**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador,  
**quiero** registrar los datos básicos de una cliente incluyendo su RUC si corresponde,  
**para** vincularla a sus turnos y mantener sus datos en el directorio del negocio.

---

## Criterios de aceptación

1. **Campos** — Se puede crear una cliente con: nombre completo, teléfono, email y RUC; todos opcionales excepto el nombre.
2. **Validación RUC** — Si se informa RUC, acepta formato paraguayo (`XXXXXXXX-D`) y valida el dígito verificador al guardar.
3. **Unicidad** — Antes de guardar, el sistema verifica duplicados por teléfono, email o RUC **solo cuando el campo tiene valor** (valores vacíos no participan en la unicidad); si hay conflicto, muestra qué campo está duplicado.
4. **Disponibilidad inmediata** — La cliente creada está disponible de inmediato para búsqueda al agendar un turno (listado y buscador de clientes).
5. **Cliente ocasional — identificador** — Existe opción de “cliente ocasional” representada por un **identificador genérico** del sistema (sin alta con datos obligatorios); su uso en agendas y ventas se describe en las historias correspondientes.

---

## Implementación actual (código, 2026-04)

- **Ruta:** `/app/clients` — modal “New client” en `ClientsPage`.
- **API:** `POST /api/clients` con validación de RUC opcional.
- **E2E:** `e2e/tests/hu-10-crear-cliente.spec.ts`.

---

## Notas para estimación y pruebas

- **Pruebas:** solo nombre mínimo, RUC válido/inválido, duplicados en cada campo, cliente ocasional en alta.