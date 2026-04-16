# Matriz: criterios de aceptación ↔ tests E2E (Playwright)

**Ámbito:** historias en `requirements/user_stories/` vs specs en `e2e/tests/`.  
**Última revisión:** 2026-04 (matriz inicial; los tests **no** cubren aún todos los criterios).

## Política (obligatoria para nuevos y cambios en e2e)

Cada historia de usuario con criterios de aceptación numerados **debe** tener, en Playwright, **al menos una validación explícita por criterio** (aserción que demuestre el comportamiento esperado: UI, red, estado de datos, o combinación). Si un criterio no puede cubrirse de forma razonable solo con Playwright, debe quedar marcado en esta matriz como 🔶 y documentarse la alternativa (test de API, contrato, revisión manual, herramienta externa).

**Leyenda**

| Símbolo | Significado |
|--------|-------------|
| ✅ | Cubierto por un test e2e actual (aserción alineada al criterio). |
| ⚠️ | Cobertura parcial (solo presencia de UI / smoke; no valida la regla completa). |
| ❌ | Sin cobertura e2e actual. |
| 🔶 | Validación con Playwright **no clara** o costosa; requiere decisión (ver columna *Notas*). |

---

## HU-01 — Iniciar sesión (`hu-01-iniciar-sesion.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Formulario email/contraseña | ✅ | `muestra el formulario de login` | — |
| 2 | Error genérico si login falla | ✅ | `credenciales incorrectas muestran mensaje genérico` | — |
| 3 | Login exitoso → panel / home | ✅ | `login exitoso redirige al panel` (+ `loginAsDemo` en otros specs) | — |
| 4 | Sesión 8 h / inactividad | 🔶 | ❌ | Esperar 8 h no es viable; alternativas: mock de tiempo, test de API con JWT `exp` manipulado, o test unitario del guard de rutas. |
| 5 | Recuperación contraseña (flujo completo) | ⚠️ | `enlace a recuperación de contraseña` | Solo navega a `/forgot-password`; no envía form ni verifica email/logs. 🔶 Comprobar envío real requiere mock de API o lectura de logs en entorno controlado. |

---

## HU-02 — Configurar datos del negocio (`hu-02-configurar-datos-del-negocio.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Pantalla configuración / tenant | ⚠️ | `pantalla de negocio bajo Ajustes` | Solo `getByLabel("Business name")`; no demuestra rol admin ni datos del tenant vía API. |
| 2 | Campos editables y guardado | ❌ | — | Requiere flujo guardar + GET o mensaje éxito. |
| 3 | Validación RUC formato | ❌ | — | Introducir RUC inválido y aserción `FieldValidationError`. |
| 4 | RUC obligatorio para facturar | ❌ | — | Mejor en HU-14 o API; o intento facturar sin RUC con datos seed. |
| 5 | Datos en PDF | 🔶 | ❌ | Validar PDF en Playwright: descarga + parse binario o snapshot hash; o contrato en API de generación PDF. |
| 6 | Guardado explícito (no autoguardado) | ❌ | — | Cambiar campo sin guardar, recargar, verificar no persistido; luego guardar y verificar. |

---

## HU-02b — Timbrado fiscal (`hu-02b-configurar-timbrado-fiscal.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Sección Timbrado en configuración | ⚠️ | `pantalla de timbrado bajo Ajustes` | Asume timbrado semilla + botón Desactivar. |
| 2 | Campos del timbrado | ❌ | — | Alta/edición con formulario completo. |
| 3 | Inicio emisión dentro del rango | ❌ | — | Casos borde en formulario “Add stamp”. |
| 4 | Vigencia fin > inicio | ❌ | — | Fechas inválidas → error. |
| 5 | Inmutabilidad tras factura | 🔶 | ❌ | Requiere estado con factura emitida; posible pero datos de prueba pesados. |
| 6 | Un solo activo | ❌ | — | Dos timbrados, activar uno, verificar el otro inactivo. |
| 7 | Alerta vencimiento &lt; 30 días (dashboard) | ❌ | — | Sembrar timbrado que venza pronto o mock; enlazar con HU-03. |
| 8 | Alerta rango &lt; 10 % | ❌ | — | Ajustar `next_emission` cerca del tope. |
| 9 | Bloqueo si vencido/agotado | ❌ | — | Intentar emitir factura con timbrado inválido. |

---

## HU-03 — Dashboard principal (`hu-03-dashboard-principal.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Métricas día / ingresos | ⚠️ | `muestra el dashboard tras iniciar sesión` | Solo texto “Appointments today”; no valida números ni ingresos. |
| 2 | Accesos rápidos (calendario / comprobante) | ❌ | — | Clic en botones y aserción de navegación. |
| 3 | Polling 1 minuto | 🔶 | ❌ | Validar intervalo de `setInterval`/refetch sin esperar 1 min: interceptar requests o exponer hook de test. |
| 4 | Estado vacío sin datos | ❌ | — | Tenant sin turnos o seed dedicado. |

---

## HU-04 — Servicios (`hu-04-crear-y-gestionar-servicios.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | CRUD categorías | ❌ | — | — |
| 2 | Alta servicio con categoría | ❌ | — | — |
| 3 | Edición servicio | ❌ | — | — |
| 4 | Desactivación preserva historial | 🔶 | ❌ | Requiere datos históricos; posible con API setup. |
| 5 | Lista buscable y filtrable | ❌ | — | Solo lead text visible en smoke actual. |

---

## HU-05 — Profesionales (`hu-05-crear-y-gestionar-profesionales.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Alta con datos + foto opcional | ❌ | — | — |
| 2 | Horarios semanales | ❌ | — | — |
| 3 | Edición / desactivación | ❌ | — | — |
| 4 | Lista con estado activa/inactiva | ⚠️ | `página de profesionales con alta disponible` | Solo heading + botón nuevo. |

---

## HU-06 — Calendario (`hu-06-calendario-de-turnos.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Vista semanal | ⚠️ | `vista semanal de citas` | Solo heading “Appointments”. |
| 2 | Tarjeta: cliente, servicio, profesional | ❌ | — | Requiere turnos seed o crear en test. |
| 3 | Navegación semanas | ❌ | — | Clic prev/next y aserción de rango de fechas. |
| 4 | Filtro por profesional | ❌ | — | — |
| 5 | Clic → detalle | ❌ | — | — |

---

## HU-07 — Agendar turno (`hu-07-agendar-un-turno.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Crear con fecha/hora/prof/serv/cliente u ocasional | ❌ | — | Solo abre modal. |
| 2 | Sin solapamiento | ❌ | — | Dos turnos mismo slot → error API o toast. |
| 3 | Refresco inmediato en calendario | ❌ | — | Tras crear, buscar celda con el turno. |
| 4 | Estado inicial Pendiente | ❌ | — | Tras crear, abrir detalle. |
| 5 | Duración bloquea intervalo | ❌ | — | Servicio largo vs segundo turno solapado. |

---

## HU-08 — Cambiar estado (`hu-08-cambiar-estado-de-un-turno.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Estados permitidos en UI | ❌ | — | Solo label “Professional” en modal nuevo (no es cambio de estado). |
| 2 | Cambio desde detalle | ❌ | — | — |
| 3 | Cancelación con razón | ❌ | — | — |
| 4 | Completado diferenciado visualmente | ❌ | — | — |
| 5 | No borrado físico | 🔶 | ❌ | Mejor contrato API / BD; UI no demuestra ausencia de DELETE. |

---

## HU-09 — Editar / reagendar (`hu-09-editar-o-reagendar-turno.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Campos editables según reglas | ❌ | — | Solo abre/cierra modal nuevo. |
| 2 | Revalidación disponibilidad | ❌ | — | — |
| 3 | Refresco en calendario | ❌ | — | — |
| 4 | Solo Pendiente/Confirmado editables | ❌ | — | — |

---

## HU-10 — Crear cliente (`hu-10-crear-cliente.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Campos (nombre obligatorio) | ⚠️ | `abre el formulario de nuevo cliente` | No envía formulario. |
| 2 | RUC formato + dígito verificador | ❌ | — | — |
| 3 | Unicidad tel/email/RUC | ❌ | — | Requiere dos clientes seed. |
| 4 | Disponible al agendar/facturar | ❌ | — | Búsqueda tras crear. |
| 5 | Cliente ocasional (identificador genérico) | ❌ | — | Flujo en factura o turno. |

---

## HU-11 — Buscar cliente (`hu-11-buscar-cliente-existente.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Buscador en turno y factura | ❌ | — | Solo placeholder en listado `/app/clients`. |
| 2 | Búsqueda incremental ≥2 caracteres | ❌ | — | — |
| 3 | Resultados con nombre/tel/RUC | ❌ | — | — |
| 4 | Alta rápida sin perder contexto | ❌ | — | — |
| 5 | Autocompletado factura | ❌ | — | — |
| 6 | Cliente ocasional | ❌ | — | — |

---

## HU-12 — Perfil cliente (`hu-12-ver-y-editar-perfil-cliente.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Listado con búsqueda | ❌ | — | — |
| 2 | Columnas nombre/tel/RUC/visitas | ❌ | — | — |
| 3 | Perfil + historial turnos/facturas | ❌ | — | — |
| 4 | Edición con validaciones | ❌ | — | — |
| 5 | Unicidad al editar | ❌ | — | — |
| 6 | Baja lógica (desactivar, no borrar) | ⚠️ | `ruta de detalle responde` | Solo error 404 para id inexistente; no cubre desactivar. |

---

## HU-13 — Abrir caja (`hu-13-abrir-caja-del-dia.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Solicitud apertura con monto | ✅ | `abrir caja con monto inicial y ver confirmación` | — |
| 2 | No emitir sin caja | ❌ | — | Ir a factura con sesión cerrada (cerrar en test o tenant nuevo). |
| 3 | Una caja abierta / no abrir segunda | ❌ | — | Tras abrir, POST open de nuevo → error o UI. |
| 4 | Auditoría usuario/fecha | ⚠️ | implícito si backend guarda | 🔶 UI podría mostrar “Opened by”; validar vía texto o API. |

---

## HU-14 — Emitir comprobante (`hu-14-emitir-comprobante.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Desde turno completado o independiente | ❌ | — | Solo form “Issue Invoice” con caja abierta. |
| 2 | Varios ítems | ❌ | — | — |
| 3 | Cliente existente u ocasional | ❌ | — | — |
| 4 | RUC en factura / override | ❌ | — | — |
| 5 | Descuento fijo / % | ❌ | — | — |
| 6 | Método de pago | ❌ | — | Cubierto parcialmente en HU-15. |
| 7 | Numeración 7 dígitos / rango timbrado | ❌ | — | — |
| 8 | Bloqueo sin timbrado válido | ❌ | — | Requiere desactivar timbrados vía datos. |
| 9 | PDF contenido completo | 🔶 | ❌ | Igual que HU-02 PDF: parse o contrato backend. |

---

## HU-15 — Múltiples métodos de pago (`hu-15-multiples-metodos-de-pago.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Varios métodos con montos | ⚠️ | `formulario de factura incluye sección de métodos de pago` | No agrega segunda línea ni confirma. |
| 2 | Suma = total para confirmar | ❌ | — | Caso negativo: suma ≠ total. |
| 3 | Saldo pendiente visible | ❌ | — | Leer “Remaining” / hint en UI. |

---

## HU-16 — Historial comprobantes (`hu-16-historial-de-comprobantes.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Listado orden fecha desc | ❌ | — | Solo heading “Invoice history”. |
| 2 | Filtros fecha/cliente/estado | ❌ | — | — |
| 3 | Columnas número/fecha/cliente/total/estado | ❌ | — | — |
| 4 | Detalle + descarga PDF | ❌ | — | 🔶 PDF como arriba. |

---

## HU-17 — Anular comprobante (`hu-17-anular-comprobante.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Anular desde detalle | ❌ | — | Solo campo búsqueda historial. |
| 2 | Razón obligatoria | ❌ | — | — |
| 3 | Estado anulado visible en historial | ❌ | — | — |
| 4 | Restricción cierre caja / día anterior | 🔶 | ❌ | Requiere escenario temporal + caja cerrada; datos de prueba o API. |

---

## HU-18 — Cerrar caja (`hu-18-cerrar-caja-del-dia.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Resumen totales y por método | ❌ | — | Solo botón “Close cash register” visible. |
| 2 | Arqueo efectivo contado | ❌ | — | — |
| 3 | Diferencia sobrante/faltante | ❌ | — | — |
| 4 | Registro auditoría cierre | ❌ | — | — |
| 5 | Post-cierre no emitir hasta nueva apertura | ❌ | — | Flujo largo: cerrar → intentar factura → error. |

---

## HU-19 — Fixes calendario (`hu-19-fixes-varios-calendario.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1–3 | Autobúsqueda prof/serv/cliente en diálogo | ⚠️ | `filtro de profesionales con placeholder` | Solo placeholder global; no valida filtrado por campo. |
| 4 | Filtro profesionales en vista principal | ❌ | — | Escribir en filtro y comprobar opciones reducidas. |
| 5 | Solapes lado a lado + hover | ❌ | — | Requiere 2+ citas mismo slot; hover en Playwright es frágil (🔶 viewport). |
| 6 | Solo estados Pendiente/Confirmado/En curso en grilla | ❌ | — | Seed con turnos en otros estados. |

---

## HU-20 — Fixes profesionales (`hu-20-fixes-varios-profesionales.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | File picker foto con `accept` | ❌ | — | `input[type=file]` atributo `accept`. |
| 2 | Validación extensión | ❌ | — | Archivo con extensión incorrecta. |
| 3 | Peso máx. 5 MB | 🔶 | ❌ | Subir blob &gt; 5MB en e2e es posible pero pesado. |
| 4 | Dimensiones máx. 500×500 | 🔶 | ❌ | Generar imagen en test o fixture binaria. |
| 5 | Time picker alineado al calendario | ❌ | — | Comparar componente o clase CSS en ambos flujos. |

---

## HU-21 — Fixes clientes (`hu-21-fixes-varios-clientes.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Botón “Nuevo Cliente” (copy) | ❌ | — | `getByRole('button', …)` texto exacto i18n. |
| 2 | Copy masculino “cliente” en todo el módulo | 🔶 | ❌ | Muchas cadenas: mejor test de i18n (snapshot de claves) o lista de `page.getByText` para `es`. |
| 3 | Un solo toast al guardar edición | ❌ | — | Contar toasts tras guardar. |
| 4 | Desactivar sin `alert` nativo | ❌ | — | Verificar que sea modal de diseño. |
| 5 | Reactivar tras desactivar | ❌ | — | — |
| 6 | Filtro “Todas” incluye inactivos | ❌ | — | — |
| 7 | Botones masculino coherentes | 🔶 | ❌ | Ligado al criterio 2. |

---

## Resumen numérico (aprox.)

| Métrica | Cantidad |
|--------|----------|
| Criterios totales (suma de filas anteriores) | ~120+ |
| ✅ explícitos | pocos (principalmente HU-01 parcial, HU-13 parcial) |
| Pendiente ❌ / ⚠️ / 🔶 | mayoría |

*Esta matriz debe actualizarse cuando se añadan tests que cierren filas (cambiar estado y referenciar el nombre del `test()` o archivo).*
