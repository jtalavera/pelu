# Matriz: criterios de aceptación ↔ tests E2E (Playwright)

**Ámbito:** historias en `requirements/user_stories/` vs specs en `e2e/tests/`.  
**Última revisión:** 2026-04 — alineada con la suite Playwright actual (**95** `test()` en `e2e/tests/*.spec.ts`).

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
| 1 | Pantalla configuración / tenant | ✅ | `HU-02 · 1 admin ve datos del tenant cargados desde el servidor` | — |
| 2 | Campos editables y guardado | ✅ | `HU-02 · 2 guardar cambios persiste y muestra confirmación` | — |
| 3 | Validación RUC formato | ✅ | `HU-02 · 3 validación de formato RUC en cliente` | — |
| 4 | RUC obligatorio para facturar | ✅ | `HU-02 · 4 alerta de RUC cuando falta para facturación (dashboard)` | — |
| 5 | Datos en PDF | 🔶 | ❌ | Validar PDF en Playwright: descarga + parse binario o snapshot hash; o contrato en API de generación PDF. |
| 6 | Guardado explícito (no autoguardado) | ✅ | `HU-02 · 6 cambios sin guardar no persisten al recargar` | — |

---

## HU-02b — Timbrado fiscal (`hu-02b-configurar-timbrado-fiscal.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Sección Timbrado en configuración | ✅ | `pantalla de timbrado bajo Ajustes` | — |
| 2 | Campos del timbrado | ✅ | `HU-02b · 2 formulario Add stamp muestra campos del timbrado` | — |
| 3 | Inicio emisión dentro del rango | ✅ | `HU-02b · 3 número inicial fuera del rango muestra error` | — |
| 4 | Vigencia fin > inicio | ✅ | `HU-02b · 4 fin de vigencia anterior al inicio muestra error` | — |
| 5 | Inmutabilidad tras factura | 🔶 | ❌ | Requiere estado con factura emitida; posible pero datos de prueba pesados. |
| 6 | Un solo activo | ✅ | `HU-02b · 6 solo un timbrado activo: al activar otro, el anterior queda inactivo` | — |
| 7 | Alerta vencimiento &lt; 30 días (dashboard) | ✅ | `HU-02b · 7 alerta de vencimiento en menos de 30 días en el dashboard` | — |
| 8 | Alerta rango &lt; 10 % | ✅ | `HU-02b · 8 alerta de rango de numeración bajo 10%` | — |
| 9 | Bloqueo si vencido/agotado | ✅ | `HU-02b · 9 emisión bloqueada con timbrado no válido para la fecha` | — |

---

## HU-03 — Dashboard principal (`hu-03-dashboard-principal.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Métricas día / ingresos | ✅ | `HU-03 · 1 métricas de ingresos y citas del día` | — |
| 2 | Accesos rápidos (calendario / comprobante) | ✅ | `HU-03 · 2 accesos rápidos a calendario y nueva cita` | — |
| 3 | Polling 1 minuto | 🔶 | ❌ | Validar intervalo de `setInterval`/refetch sin esperar 1 min: interceptar requests o exponer hook de test. |
| 4 | Estado vacío sin datos | ✅ | `HU-03 · 4 estado vacío cuando no hay citas hoy` | — |

---

## HU-04 — Servicios (`hu-04-crear-y-gestionar-servicios.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | CRUD categorías | ✅ | `HU-04 · 1 CRUD categoría: crear y listar` | Alta + listado; editar/eliminar categoría no cubierto explícitamente. |
| 2 | Alta servicio con categoría | ✅ | `HU-04 · 2 alta de servicio con categoría` | — |
| 3 | Edición servicio | ✅ | `HU-04 · 3 edición de servicio` | — |
| 4 | Desactivación preserva historial | 🔶 | ❌ | Requiere datos históricos; posible con API setup. |
| 5 | Lista buscable y filtrable | ⚠️ | `HU-04 · 5 búsqueda y filtro por categoría` | Cubre búsqueda sin resultados; filtro por categoría (dropdown) no asertado explícitamente. |

---

## HU-05 — Profesionales (`hu-05-crear-y-gestionar-profesionales.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Alta con datos + foto opcional | ⚠️ | `HU-05 · 1 alta de profesional con nombre y pestaña de horarios` | Alta + horario; foto opcional no cubierta (ver HU-20). |
| 2 | Horarios semanales | ✅ | `HU-05 · 1 alta de profesional con nombre y pestaña de horarios` | Guardado de ventana horaria Lunes. |
| 3 | Edición / desactivación | ✅ | `HU-05 · 3 desactivar y reactivar profesional` | Edición de datos no cubierta explícitamente. |
| 4 | Lista con estado activa/inactiva | ✅ | `HU-05 · 4 listado muestra estado activo` + `HU-05 · 3` (Inactive) | — |

---

## HU-06 — Calendario (`hu-06-calendario-de-turnos.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Vista semanal | ✅ | `HU-06 · 3 navegación semanas actualiza el rango mostrado` | Rango semanal visible y actualizable. |
| 2 | Tarjeta: cliente, servicio, profesional | ✅ | `HU-06 · 2 tarjeta muestra cliente, servicio y profesional` | — |
| 3 | Navegación semanas | ✅ | `HU-06 · 3 navegación semanas actualiza el rango mostrado` | — |
| 4 | Filtro por profesional | ✅ | `HU-06 · 4 filtro por profesional reduce resultados` | — |
| 5 | Clic → detalle | ✅ | `HU-06 · 5 clic en tarjeta abre detalle` | — |

---

## HU-07 — Agendar turno (`hu-07-agendar-un-turno.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Crear con fecha/hora/prof/serv/cliente u ocasional | ✅ | `HU-07 · 1 crear turno con cliente, servicio y profesional` | Cliente con nombre (no flujo “ocasional” en agenda). |
| 2 | Sin solapamiento | ✅ | `HU-07 · 2 sin solapamiento: segundo turno mismo slot muestra error` | 409 + mensaje en diálogo. |
| 3 | Refresco inmediato en calendario | ✅ | `HU-07 · 3 tras crear, el turno aparece en la grilla` | — |
| 4 | Estado inicial Pendiente | ✅ | `HU-07 · 4 estado inicial Pendiente en el detalle` | — |
| 5 | Duración bloquea intervalo | ❌ | — | Segundo turno solapado por duración del servicio no cubierto. |

---

## HU-08 — Cambiar estado (`hu-08-cambiar-estado-de-un-turno.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Estados permitidos en UI | ✅ | `HU-08 · 1 y 2 cambiar estado desde detalle a Completado` | — |
| 2 | Cambio desde detalle | ✅ | `HU-08 · 1 y 2 cambiar estado desde detalle a Completado` | — |
| 3 | Cancelación con razón | ✅ | `HU-08 · 3 cancelación con razón` | — |
| 4 | Completado diferenciado visualmente | ✅ | `HU-08 · 4 Completado se distingue en el detalle` | — |
| 5 | No borrado físico | 🔶 | ❌ | Mejor contrato API / BD; UI no demuestra ausencia de DELETE. |

---

## HU-09 — Editar / reagendar (`hu-09-editar-o-reagendar-turno.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Campos editables según reglas | ✅ | `HU-09 · 1 y 3 editar hora y ver cambio en la grilla` | Edición de hora. |
| 2 | Revalidación disponibilidad | ❌ | — | No hay intento de solape en edición. |
| 3 | Refresco en calendario | ✅ | `HU-09 · 1 y 3 editar hora y ver cambio en la grilla` | — |
| 4 | Solo Pendiente/Confirmado editables | ✅ | `HU-09 · 4 no se puede editar turno Completado` | — |

---

## HU-10 — Crear cliente (`hu-10-crear-cliente.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Campos (nombre obligatorio) | ✅ | `HU-10 · 1 guardar cliente con nombre obligatorio` | — |
| 2 | RUC formato + dígito verificador | ✅ | `HU-10 · 2 RUC inválido muestra mensaje de validación` | Formato; dígito verificador no asertado explícitamente. |
| 3 | Unicidad tel/email/RUC | ⚠️ | `HU-10 · 3 unicidad teléfono: segundo cliente mismo teléfono falla` | Solo teléfono. |
| 4 | Disponible al agendar/facturar | ✅ | `HU-10 · 4 cliente disponible en búsqueda de facturación` | — |
| 5 | Cliente ocasional (identificador genérico) | ✅ | `HU-10 · 5 cliente ocasional en factura` | — |

---

## HU-11 — Buscar cliente (`hu-11-buscar-cliente-existente.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Buscador en turno y factura | ⚠️ | `listado de clientes con búsqueda` + `HU-10 · 4` (factura) | Búsqueda en `/app/clients`; en agenda no cubierto explícitamente. |
| 2 | Búsqueda incremental ≥2 caracteres | ✅ | `HU-11 · 2 búsqueda incremental con 2+ caracteres filtra resultados` | — |
| 3 | Resultados con nombre/tel/RUC | ✅ | `HU-11 · 3 resultados muestran teléfono y RUC cuando existen` | — |
| 4 | Alta rápida sin perder contexto | ❌ | — | — |
| 5 | Autocompletado factura | ⚠️ | `HU-10 · 4 cliente disponible en búsqueda de facturación` | — |
| 6 | Cliente ocasional | ✅ | `HU-10 · 5 cliente ocasional en factura` | En spec HU-10. |

---

## HU-12 — Perfil cliente (`hu-12-ver-y-editar-perfil-cliente.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Listado con búsqueda | ✅ | `HU-12 · 1 y 2 listado y columnas visibles` | — |
| 2 | Columnas nombre/tel/RUC/visitas | ⚠️ | `HU-12 · 1 y 2 listado y columnas visibles` | Nombre, tel, “No RUC”; columna visitas no asertada. |
| 3 | Perfil + historial turnos/facturas | ✅ | `HU-12 · 3 perfil e historial (pestañas)` | Historial de turnos vacío asertado. |
| 4 | Edición con validaciones | ✅ | `HU-12 · 4 edición con validación RUC` | — |
| 5 | Unicidad al editar | ❌ | — | — |
| 6 | Baja lógica (desactivar, no borrar) | ⚠️ | `ruta de detalle responde (404 controlado si no hay id)` | No cubre desactivar; ver HU-21. |

---

## HU-13 — Abrir caja (`hu-13-abrir-caja-del-dia.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Solicitud apertura con monto | ✅ | `abrir caja con monto inicial y ver confirmación` | — |
| 2 | No emitir sin caja | ✅ | `HU-13 · 2 no emitir factura sin caja abierta` | Validación vía API (`CASH_SESSION_NOT_OPEN`). |
| 3 | Una caja abierta / no abrir segunda | ✅ | `HU-13 · 3 no abrir segunda caja si ya hay una abierta` | API. |
| 4 | Auditoría usuario/fecha | ⚠️ | implícito si backend guarda | 🔶 UI podría mostrar “Opened by”; validar vía texto o API. |

---

## HU-14 — Emitir comprobante (`hu-14-emitir-comprobante.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Desde turno completado o independiente | ❌ | — | Solo emisión independiente en pestaña Billing. |
| 2 | Varios ítems | ✅ | `HU-14 · 2 varios ítems y HU-14 · 6 método de pago` | — |
| 3 | Cliente existente u ocasional | ✅ | `HU-14 · 3 cliente ocasional` (+ cliente existente en mismo spec vía `HU-14 · 2`) | — |
| 4 | RUC en factura / override | ❌ | — | — |
| 5 | Descuento fijo / % | ✅ | `HU-14 · 5 descuento porcentaje` | Solo %; descuento fijo no cubierto. |
| 6 | Método de pago | ✅ | `HU-14 · 2 varios ítems y HU-14 · 6 método de pago` | — |
| 7 | Numeración 7 dígitos / rango timbrado | ❌ | — | No aserta número emitido vs rango. |
| 8 | Bloqueo sin timbrado válido | ✅ | `HU-14 · 8 sin timbrado activo bloquea emisión` | — |
| 9 | PDF contenido completo | 🔶 | ❌ | Igual que HU-02 PDF: parse o contrato backend. |

---

## HU-15 — Múltiples métodos de pago (`hu-15-multiples-metodos-de-pago.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Varios métodos con montos | ✅ | `HU-15 · 1 y 2 dos métodos cuya suma iguala el total` | — |
| 2 | Suma = total para confirmar | ✅ | `HU-15 · 1 y 2` + `HU-15 · 2 suma distinta del total muestra error de API` | Caso positivo y negativo. |
| 3 | Saldo pendiente visible | ✅ | `HU-15 · 3 saldo pendiente visible cuando falta asignar` | — |

---

## HU-16 — Historial comprobantes (`hu-16-historial-de-comprobantes.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Listado orden fecha desc | ⚠️ | `pestaña de historial de facturas` + `HU-16 · 2` | Orden descendente no asertado explícitamente. |
| 2 | Filtros fecha/cliente/estado | ⚠️ | `HU-16 · 2 filtros por fecha y estado` | Filtro de texto por cliente en tabla; filtros de fecha/estado no asertados explícitamente. |
| 3 | Columnas número/fecha/cliente/total/estado | ✅ | `HU-16 · 3 columnas visibles en la tabla` | — |
| 4 | Detalle + descarga PDF | 🔶 | ❌ | PDF como arriba. |

---

## HU-17 — Anular comprobante (`hu-17-anular-comprobante.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Anular desde detalle | ✅ | `HU-17 · 1 y 2 anular con razón obligatoria` | — |
| 2 | Razón obligatoria | ✅ | `HU-17 · 1 y 2 anular con razón obligatoria` | — |
| 3 | Estado anulado visible en historial | ✅ | `HU-17 · 3 estado anulado visible en historial` | — |
| 4 | Restricción cierre caja / día anterior | 🔶 | ❌ | Requiere escenario temporal + caja cerrada; datos de prueba o API. |

---

## HU-18 — Cerrar caja (`hu-18-cerrar-caja-del-dia.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Resumen totales y por método | ⚠️ | `HU-18 · 1 y 2 cierre con arqueo y resumen` | Cierre exitoso; desglose por método no asertado explícitamente. |
| 2 | Arqueo efectivo contado | ✅ | `HU-18 · 1 y 2 cierre con arqueo y resumen` | — |
| 3 | Diferencia sobrante/faltante | ⚠️ | `HU-18 · 3 diferencia sobregiro o faltante` | Cierre con conteo alto; mensaje de diferencia no asertado explícitamente. |
| 4 | Registro auditoría cierre | ❌ | — | — |
| 5 | Post-cierre no emitir hasta nueva apertura | ✅ | `HU-18 · 5 tras cierre no emitir hasta nueva apertura` | API `CASH_SESSION_NOT_OPEN`. |

---

## HU-19 — Fixes calendario (`hu-19-fixes-varios-calendario.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1–3 | Autobúsqueda prof/serv/cliente en diálogo | ⚠️ | `filtro de profesionales con placeholder de búsqueda` | Placeholder visible; autobúsqueda por campo en modal no cubierta fila a fila. |
| 4 | Filtro profesionales en vista principal | ✅ | `HU-19 · 4 filtro de profesional en vista principal reduce opciones` | — |
| 5 | Solapes lado a lado + hover | 🔶 | ❌ | Hover en Playwright es frágil (🔶 viewport). |
| 6 | Solo estados Pendiente/Confirmado/En curso en grilla | ✅ | `HU-19 · 6 turno Completado no aparece en la grilla` | Cubre exclusión de Completado; otros estados no exhaustivos. |

---

## HU-20 — Fixes profesionales (`hu-20-fixes-varios-profesionales.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | File picker foto con `accept` | ✅ | `HU-20 · 1 input de foto usa accept de tipos de imagen` | — |
| 2 | Validación extensión | ✅ | `HU-20 · 2 validación de extensión de archivo rechaza .txt` | — |
| 3 | Peso máx. 5 MB | 🔶 | ❌ | Subir blob &gt; 5MB en e2e es posible pero pesado. |
| 4 | Dimensiones máx. 500×500 | 🔶 | ❌ | Generar imagen en test o fixture binaria. |
| 5 | Time picker alineado al calendario | ✅ | `HU-20 · 5 time picker en horario usa input type time` | — |

---

## HU-21 — Fixes clientes (`hu-21-fixes-varios-clientes.spec.ts`)

| # | Criterio (resumen) | Estado | Cobertura actual | Notas |
|---|-------------------|--------|-------------------|--------|
| 1 | Botón “Nuevo Cliente” (copy) | ✅ | `HU-21 · 1 botón Nuevo cliente visible` | Texto i18n `+ New client` en EN. |
| 2 | Copy masculino “cliente” en todo el módulo | 🔶 | ❌ | Muchas cadenas: mejor test de i18n (snapshot de claves) o lista de `page.getByText` para `es`. |
| 3 | Un solo toast al guardar edición | ✅ | `HU-21 · 3 una sola alerta de éxito al guardar edición en perfil` | — |
| 4 | Desactivar sin `alert` nativo | ✅ | `HU-21 · 4 desactivar usa modal de confirmación` | — |
| 5 | Reactivar tras desactivar | ✅ | `HU-21 · 5 reactivar cliente inactivo` | — |
| 6 | Filtro “Todas” incluye inactivos | ✅ | `HU-21 · 6 filtro Todas incluye inactivos en el listado` | — |
| 7 | Botones masculino coherentes | 🔶 | ❌ | Ligado al criterio 2. |

---

## Resumen numérico (aprox.)

| Métrica | Cantidad |
|--------|----------|
| Criterios totales (suma de filas anteriores) | ~120+ |
| `test()` en `e2e/tests/*.spec.ts` | **95** |
| ✅ explícitos | mayoría de historias con al menos un criterio ✅ |
| Pendiente ❌ / ⚠️ / 🔶 | ver tablas anteriores |

*Actualizar esta matriz al añadir o renombrar `test()` o al cambiar el alcance de una historia.*
