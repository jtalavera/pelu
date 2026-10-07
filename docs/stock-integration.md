# Integración Femme (pelu) ↔ control-stock — MVP (HU-59..HU-67)

Lo que pelu implementa para que un salón use Stock. Contrato del otro lado: `control-stock/docs/04-integracion-pelu.md`.

## Piezas

| Pieza | Dónde |
|---|---|
| Flags `STOCK_MODULE` (OFF global), `STOCK_PHYSICAL_COUNT`, `STOCK_TOURS` | `V69`, `FemmeDataInitializer` — misma resolución "Y" que cualquier flag |
| Tipo Servicio/Producto + SKU en el catálogo y en el upload de plataforma (`tipo`, `sku`) | `V70`, `ServiceCatalogService`, `ServiceImportService` |
| Catálogo separado: Servicios y Productos con pantallas y categorías propias (`service_categories.kind`) | `V72`, `ServiceCatalogService`, `CatalogItemsPage` — [HU](../requirements/user_stories/catalogo-separado-servicios-productos.md) |
| Outbox transaccional (`stock_outbox`) + estado por salón (`stock_tenant_link`) | `V71`, paquete `com.cursorpoc.backend.stock` |
| Despertador: cola `stock-integration` (Service Bus) o cola local en proceso | `StockServiceBusConfiguration`, `ServiceBusStockOutboxQueue`, `LocalAsyncStockOutboxQueue` |
| Worker por salón, en orden, con lease de 5 min y reintentos 1m/5m/15m/1h/4h/24h → `FAILED` | `StockOutboxProcessor`, `StockOutboxPersistenceService` |
| Reconciliador cada minuto (vencidos y leases expirados) | `StockOutboxReconciler` |
| Activación / flags / nombre-estado del salón → `TENANT_UPSERT`, `FEATURE_FLAGS_SYNC`, `CATALOG_FULL_SYNC` | `StockFeatureFlagPublisher` |
| Venta (`POST_SALE`, clave `PELU:INVOICE:{id}:{rev}`) y reversión (anular, cancelación SIFEN, inutilización, corrección) | `StockDomainEventListener` ← `InvoiceStockEvent` |
| SSO a Stock (`POST /api/sso/stock`, HS256 con secreto propio, 5 min) | `StockSsoService`, ítem "Stock" en `AppShell` |
| Disponible al facturar (`GET /api/stock/availability`) | `StockAvailabilityService`, `BillingPage` |
| Pull de flags de Stock (`POST /api/integration/oauth/token`, `GET /api/integration/feature-flags/resolved`) | `IntegrationController`, `IntegrationAuthenticationFilter` |
| Panel "Integración con Stock", reintentar/descartar, contador en dashboard, sync manual de catálogo | `PlatformStockController`, `PlatformStockIntegrationPage`, `TenantStockSection` |

Los eventos se escriben **en la misma transacción** que la factura/anulación/edición (eventos de Spring
síncronos) y solo para salones con `STOCK_MODULE`. El envío ocurre después del commit, fuera de la
transacción: facturar nunca espera ni falla por Stock.

## Configuración

| Variable / secreto | Valor |
|---|---|
| `APP_FEMME_STOCK_ENABLED` | `true` para enviar (Terraform `stock_enabled`) |
| `APP_FEMME_STOCK_BASE_URL` | URL de la API de Stock (Terraform `stock_api_base_url`) |
| `APP_FEMME_STOCK_CLIENT_ID` | `pelu` (cliente bootstrap de Stock) |
| `FEMME_SERVICEBUS_STOCK_QUEUE` | `stock-integration`. Vacío → cola en proceso + reconciliador |
| Key Vault `app-femme-stock-client-secret` | secreto del cliente `pelu` en Stock |
| Key Vault `app-femme-stock-sso-secret` | secreto HS256 del SSO (= `APP_STOCK_PELU_HS256_SECRET` en Stock) |
| Key Vault `app-femme-integration-token-secret` | firma de los tokens de `/api/integration` (≥ 32 bytes) |
| Key Vault `app-femme-integration-client-secret` | secreto del usuario técnico `control-stock` (= `APP_STOCK_PELU_CLIENT_SECRET`) |
| Variable de entorno de GitHub `VITE_STOCK_SPA_URL` | origen del SPA de Stock; sin ella el ítem "Stock" no aparece |

En Stock: `APP_STOCK_PELU_ISSUER=femme`, `APP_STOCK_PELU_HOME_URL=<femme>/app`,
`APP_STOCK_PELU_LOGOUT_URL=<femme>/login?reason=stock_logout`, `APP_STOCK_FLAGS_RECONCILER_ENABLED=true`,
`APP_STOCK_PELU_API_URL=<api femme>`, `APP_STOCK_PELU_TOKEN_URL=<api femme>/api/integration/oauth/token`,
`APP_STOCK_PELU_CLIENT_ID=control-stock`.

Los secretos faltantes no impiden arrancar: lo que los necesita responde `STOCK_NOT_CONFIGURED`.

## Operación y diagnóstico

- **"Tu negocio todavía no está habilitado en Stock"** (`TENANT_NOT_PROVISIONED` al abrir Stock): el
  `TENANT_UPSERT` del salón todavía no se entregó. Mirá la cola en Plataforma → Integración con Stock
  (o la tabla `stock_outbox`).
- **Eventos `PENDING` que no avanzan** (`stopped: NOT_DUE` en el log): el primer evento no entregado
  de un salón está en espera de reintento y, como el orden por salón se respeta, bloquea al resto.
  La espera crece 1m/5m/15m/1h/4h/24h tras cada falla. "Reintentar" en el panel solo aplica a
  `FAILED`; para adelantar uno en espera:
  `UPDATE stock_outbox SET next_attempt_at = SYSUTCDATETIME() WHERE id = <n> AND status = 'PENDING'`
  (el reconciliador lo recoge en ≤ 1 minuto).
- **`STOCK_NOT_CONFIGURED`** en `last_error`: faltan variables (`APP_FEMME_STOCK_*`) o el secreto
  `app-femme-stock-client-secret` en el Key Vault al arrancar el backend.
- **`STOCK_UNREACHABLE HttpTimeoutException`**: casi siempre arranque en frío de Stock (en dev escala
  a cero, ~60 s). Es transitorio, pero manda el evento al siguiente backoff: adelantalo como arriba.
- **SSO rechazado**: `APP_STOCK_PELU_ISSUER` en Stock debe ser exactamente `femme`
  (`app.femme.stock.sso.issuer`) y el secreto HS256 debe ser el mismo en ambos Key Vaults.

## Pruebas

- Unitarias/integración: `./gradlew test` (paquete `stock`: cliente HTTP contra servidor simulado, outbox
  completo en H2, tokens M2M y SSO verificados como `HostTokenVerifier`).
- Playwright cruzado con Stock real: `npm run test:stock` (ver CLAUDE.md).
- Aislamiento: `tests/mt-isolation/mt-stock.spec.ts` (suite `test:mt`) y `tests/stock/stock-aislamiento.spec.ts`.
