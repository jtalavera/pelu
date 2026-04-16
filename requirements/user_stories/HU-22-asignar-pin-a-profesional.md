# HU-22 · Asignar PIN a profesional

| Campo      | Valor                  |
| ---------- | ---------------------- |
| **ID**     | HU-22                  |
| **Módulo** | Gestión de profesionales |
| **Estado** | `Backlog`              |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02). Convenciones (zona horaria del servidor, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales).

---

## Historia de usuario

**Como** administrador del negocio (tenant admin),  
**quiero** asignar un PIN numérico a cada profesional,  
**para** que pueda identificarse rápidamente en el sistema sin necesidad de email y contraseña.

---

## Criterios de aceptación

1. **Campo PIN en formulario** — El formulario de edición de profesional incluye un campo "PIN" numérico de 4 a 7 dígitos.
2. **PIN obligatoriamente numérico** — El sistema rechaza cualquier PIN que contenga caracteres no numéricos, mostrando un mensaje de error claro.
3. **Longitud válida** — El sistema rechaza PINs con menos de 4 o más de 7 dígitos; el error indica el rango permitido.
4. **Unicidad por tenant** — No pueden existir dos profesionales con el mismo PIN dentro del mismo tenant. El sistema muestra error si se intenta guardar un PIN ya asignado a otra profesional activa o inactiva del mismo tenant.
5. **PIN opcional** — Es posible guardar una profesional sin PIN asignado; el campo puede dejarse vacío.
6. **PIN almacenado de forma segura** — El PIN se almacena hasheado (no en texto plano) en la base de datos.
7. **Visualización enmascarada** — El PIN no se muestra en texto claro en la UI (se muestra como `••••` o similar) salvo durante la edición activa del campo.
8. **Edición y limpieza** — El administrador puede cambiar o borrar el PIN de una profesional en cualquier momento. Al borrar el PIN, la profesional queda sin PIN asignado.
9. **Persistencia** — El PIN asignado persiste tras recargar la página y tras editar otros datos de la profesional.

---

## Notas para estimación y pruebas

- **Dependencias:** HU-05 (formulario de profesionales).
- **Pruebas sugeridas:** PIN válido de 4, 5, 6 y 7 dígitos guardado correctamente, PIN no numérico rechazado, PIN fuera de rango (menos de 4 o más de 7 dígitos) rechazado, PIN duplicado dentro del tenant rechazado, campo vacío aceptado, cambio de PIN existente, verificación de que el PIN no está en texto plano en la BD.
