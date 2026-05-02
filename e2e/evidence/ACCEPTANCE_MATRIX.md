# Matriz: criterios de aceptación ↔ tests E2E (Playwright)

**Ámbito:** historias en `requirements/user_stories/` y specs en `e2e/tests/`.\
**Última revisión:** 2026-04 — **`120`** casos `test()` con suite verde usando backend + H2 (perfil **`e2e`**).

## Cómo correr los e2e (obligatorio para validar igual que desarrollo local)

Sin Spring Boot solo se levanta Vite (`localhost:5173`); login y casi todo el producto necesitan API.

```bash
cd e2e && npm run test:with-backend
# opcional velocidad máxima de acciones UI:
cd e2e && E2E_PLAYWRIGHT_ACTION_SPEED=1 npm run test:with-backend
```

Configuración: `e2e/playwright.config.ts` (`webServer` con `./gradlew bootRun` cuando `E2E_WITH_BACKEND=1`).

## Política

Cada historia con criterios numerados debe poder trazarse a **al menos una** aserción Playwright nominal (nombre del test o tabla siguiente). Si un criterio no tiene test e2e, debe figurar 🔶 aquí **con causa** y alternativa cuando aplique.

| Símbolo | Significado |
| ------- | ----------- |
| ✅ | Cubierto por test e2e actual (tabla siguiente). |
| 🔶 | No cubierto en e2e o solo parcial; ver *Notas*. |
| ⚠️ | Cobertura parcial (smoke/UI sin regla completa). |

---

## HU-01 · Iniciar sesión (`hu-01-iniciar-sesion.spec.ts`)

| # | Criterio | Estado | Cobertura / notas |
| - | -------- | ------ | ----------------- |
| 1–3 | Formulario, credenciales, login redirect | ✅ | `muestra el formulario de login`; `credenciales incorrectas`; `login exitoso redirige al panel` |
| 4–5 | Recuperación: enlace + envío válido muestra mensaje | ✅ | `enlace a recuperación de contraseña`; `HU-01 · 5 envío...` |

*Eliminados de HU-01*: expiración 8 h (no estable como criterio e2e estable sin mocks de tiempo).

---

## HU-02 · Configurar datos del negocio (`hu-02-configurar-datos-del-negocio.spec.ts`)

| # | Criterio | Estado | Cobertura / notas |
| - | -------- | ------ | ----------------- |
| 1–3 | Pantalla tenant, guardado, RUC formato | ✅ | `HU-02 · 1` … `· 3` |
| 4 | Guardado sin persistencia sin Save | ✅ | `HU-02 · 4 cambios sin guardar...` |

*Movidos a HU-14*: banner RUC faltante; PDF de negocio.

---

## HU-02b · Timbrado (`hu-02b-configurar-timbrado-fiscal.spec.ts`)

| # | Criterio | Estado | Cobertura / notas |
| - | -------- | ------ | ----------------- |
| 1–3 | Pantalla UI, rangos fecha | ✅ | implícito en campos (`HU-02b · 2`), `HU-02b · 3`, `HU-02b · 4` |
| 5–7 | Timbrados; activo único; alertas 30d y 10% | ✅ | `HU-02b · 5` … `· 7` |

*Eliminados (dependían de emisión factura HU-14 posterior en la numeración vieja)*: inmutabilidad tras uso; bloqueo emisión desde timbrado. El bloque en emisión se valida en **HU-14**.

---

## HU-03 · Dashboard (`hu-03-dashboard-principal.spec.ts`)

| # | Criterio | Estado | Cobertura / notas |
| - | -------- | ------ | ----------------- |
| 1–2 | Métricas; acceso calendario / nueva cita | ✅ | `HU-03 · 1`, `HU-03 · 2` |
| 4 | Estado vacío sin citas | ✅ | `HU-03 · 4` |

*Eliminado de HU-03*: enlace rápido a emitir factura (HU-14 mayor). 🔶 **Polling 1 minuto** (`DashboardPage`): no asertamos interval sin instrumentar código.

---

## HU-04–HU-09 · Agendamiento

| HU | Estado | Principales tests |
| -- | ------ | ------------------- |
| HU-04 (`hu-04-*`) | ✅ | CRUD categoría/servicio, edición, búsqueda/filtro (`HU-04 · 1`, `· 2`, `· 3`, `· 5`) |
| HU-05 (`hu-05-*`) | ✅ | Email duplicado; alta; estado; deactivate (`HU-05 · unicidad email`, `· 1`, `· 4`, `· 3`) |
| HU-06 (`hu-06-*`) | ✅ | Semana navegable; tarjeta; filtro; detalle (`HU-06 · 1 y · 3`, `· 2`, `· 4`, `· 5`) |
| HU-07 (`hu-07-*`) | ⚠️ / 🔶 | Crear turno solape Pendiente aparece (`· 1`, `· 2`, `· 3`, `· 4`); 🔶 bloque por **duración** del servicio (AC 5) sin caso dedicado |
| HU-08 (`hu-08-*`) | ✅ | Cambio estado cancelación/completado (`HU-08 · …`); 🔶 **DELETE físico** no probado en UI |
| HU-09 (`hu-09-*`) | ⚠️ | Editar hora; completado readonly; 🔶 validación disponibilidad al editar (AC 2) sin solape deliberado |

---

## HU-10 · Cliente (`hu-10-crear-cliente.spec.ts`)

| # | Estado | Cobertura |
| - | ------ | --------- |
| 1–4 | ✅ | `HU-10 · 1` … `· 4` (listado/directorio para · 4). |
| *(ocasional en factura)* | ✅ | HU-14 (`cliente ocasional`). |

---

## HU-11 (`hu-11-buscar-cliente-existente.spec.ts`)

✅ Incremental (`HU-11 · 2`), datos en fila (`HU-11 · 3`), lista con búsqueda (smoke inicial). Alta en modal agendar queda cubierta en **HU-07**.

---

## HU-12 (`hu-12-*`)

✅ Columnas/listado/perfil/edición/HU-25 historia mixta comprobantes en perfil cliente.

🔶 **`visitCount` column** no asertado de forma exhaustiva.

---

## HU-13 · Caja (`hu-13-abrir-caja-del-dia.spec.ts`)

| # | Estado | Cobertura |
| - | ------ | --------- |
| 1–2 | ✅ | `HU-13 · 1`, `HU-13 · 2`. |

Sin emisión factura aquí — **bloque sin caja** es **HU-14 · 8**.

---

## HU-14 (`hu-14-emitir-comprobante.spec.ts`)

| # | Criterio corto | Test |
| - | ---------------- | ---- |
| 1–3 | Formulario / ítems / ocasional | `HU-14 · 1`, `· 2`, `· 3` |
| 5–6 | Descuento %; método pago dentro de líneas | `· 5` + método en `HU-14 · 2` |
| 7 | Timbrado no válido (sin activo + vencido) | `HU-14 · 7` dos tests |
| 8–9 | Caja cerrada API; banner RUC | `HU-14 · 8`, `· 9` |
| 10 | PDF tipo `application/pdf` + firma `%PDF` | `HU-14 · 10` (API después de crear factura) |
| HU-25 relacionados | Listas cliente/servicio; sync cliente | tests `HU-25 · *` mismo archivo |

🔶 **`HU-14 · numeración formato 7`** asertión regex en resultado `Invoice XXXXXXX` en `HU-14 · 2`. Override solo factura HU-04 **RUC** parcialmente vía `HU-25 · factura con edición...`.

---

## HU-15 (`hu-15-multiples-metodos-de-pago.spec.ts`)

✅ Dos métodos; error suma; saldo pendiente (`HU-15 · …`).

---

## HU-16 (`hu-16-historial-de-comprobantes.spec.ts`)

✅ Filtros búsqueda (`· 2`); tabla columnas (`· 1 y · 3`).

🔶 **PDF desde historial (detalle)** mismo endpoint que HU-14 (`GET /pdf`); UX modal no duplicado.

---

## HU-17 (`hu-17-anular-comprobante.spec.ts`)

✅ Razón/anular/estado en historial. *Restricción temporal con cierre HU-18*: retirado de historia (evitar dependencia hacia historia mayor).

---

## HU-18 (`hu-18-cerrar-caja-del-dia.spec.ts`)

✅ Arqueo/resumen/post-cierre no emitir; 🔶 algunos subtotales en UI no línea a línea asertados.

---

## HU-19 (`hu-19-fixes-varios-calendario.spec.ts`)

✅ Filtros; completado oculto; 🔶 placeholders autobúsqueda `SearchableSelect` parcial (`HU-19 · 4`). Hover solapes HU-25 suplente.

---

## HU-20 · Profesional (`hu-20-*`)

✅ Accept imagen/time picker (`HU-20 · 1`, `· 2`, `· 5`). 🔶 tamaño peso/imagen 500px no e2e (coste).

---

## HU-21 · Clientes (`hu-21-*`)

✅ Toasts/desactivación/filtros (tests `HU-21 · …`). 🔶 copy masculino total i18n: lista larga mejor tests de snapshots/locales.

---

## HU-22 (`hu-22-*`)

✅ PIN validaciones y guardados (no AC 6 **hash en BD** — 🔶 sólo ingeniería / inspección).

---

## HU-23 (`hu-23-*`)

✅ Tokens/activación/revocación lista en spec.

---

## HU-24 (`hu-24-*`)

✅ Accesos y restricciones. 🔶 navegación **mes** completa calendar (HU-24 AC texto) — no test dedicado corto.

---

## HU-25 (`hu-14` + HU-19 donde aplica)

Criterios 1–3 y 8 en archivo de historia HU-25 remiten a tests HU-14 `HU-25 ·` y calendario; criterios 4–6 documentados 🔶 donde no existe spec exclusivo (`Enter`, formato centrado línea).

---

## Métricas

| Métrica | Valor |
| ------- | ----- |
| `test()` globales `e2e/tests` | **120** |
| Scripts | `npm run test` (Vite sólo); `npm run test:with-backend` (**recomendado**) |
