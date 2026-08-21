# HU-50 · Formato estándar de planillas Excel (servicios, clientes, profesionales)

| Campo      | Valor                                            |
| ---------- | --------------------------------------------------|
| **ID**     | HU-50                                             |
| **Módulo** | Plataforma · Importación de datos vía Excel       |
| **Estado** | `Done`                                            |

**Valores de estado sugeridos:** `Backlog` · `Ready` · `In Progress` · `Done`

## Definiciones transversales

Multi-tenant: datos y acciones solo del **tenant** actual (negocio / HU-02), salvo el rol Platform Admin. Convenciones (zona horaria del servidor, formato de moneda, etc.): [PRD Femme MVP v1](../prds/femme_historias_usuario_mvp_v1.md#definiciones-transversales). Alcance de la importación (solo Platform Admin, en onboarding): [PRD Gestión multi-tenant v1](./prd_multi_tenant_management_v1.md#definiciones-transversales-multi-tenant--plataforma).

---

## Historia de usuario

**Como** Platform Admin,
**quiero** que exista un formato de planilla Excel estándar y documentado para cada entidad importable,
**para** poder cargar los datos iniciales de un tenant de forma consistente y predecible.

---

## Criterios de aceptación

1. **Una plantilla por entidad** — Existen tres formatos de planilla distintos: servicios, clientes y profesionales, cada uno con su propio conjunto fijo de columnas.
2. **Columnas de Servicios** — `categoria` (obligatoria, se crea si no existe en el tenant), `nombre` (obligatoria), `precio` (obligatoria, número entero en guaraníes, sin separadores), `duracion_minutos` (obligatoria, entero positivo), `impuesto` (opcional; si se omite, el servicio se crea sin impuesto asociado), `activo` (opcional, `SI`/`NO`, default `SI`).
3. **Columnas de Clientes** — `nombre_completo` (obligatoria), `telefono` (opcional), `email` (opcional), `ruc` (opcional), `documento_identidad` (opcional), `direccion` (opcional), `activo` (opcional, `SI`/`NO`, default `SI`).
4. **Columnas de Profesionales** — `nombre_completo` (obligatoria), `telefono` (opcional), `email` (opcional), `direccion` (opcional), `activo` (opcional, `SI`/`NO`, default `SI`). El PIN y el acceso al sistema no se cargan por Excel; se configuran manualmente después (ver HU-22).
5. **Primera fila de encabezados** — El sistema exige que la primera fila contenga exactamente los nombres de columna documentados (sin distinguir mayúsculas/minúsculas ni espacios extra al inicio/fin); si falta una columna obligatoria, rechaza el archivo completo antes de procesar ninguna fila.
6. **Encoding y formato de archivo** — Solo se aceptan archivos `.xlsx`; un archivo con otra extensión o corrupto se rechaza con un mensaje claro.
7. **Documentación accesible** — El formato de cada plantilla está documentado en un lugar visible para el Platform Admin al momento de importar, no solo en este documento.

---

## Notas para estimación y pruebas

- **Dependencias:** Ninguna — historia base de la épica.
- **Pruebas sugeridas:** archivo con todas las columnas obligatorias presentes; archivo con una columna obligatoria faltante rechazado antes de procesar filas; archivo con extensión inválida rechazado; encabezados con mayúsculas/espacios extra aceptados.
