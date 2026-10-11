/**
 * Stock cross-system suite (playwright.stock.config.ts): ports and e2e-only shared secrets.
 * The pelu side mirrors src/backend/src/main/resources/application-e2e.properties (SSO secret,
 * integration client) plus the overrides the config passes via SPRING_APPLICATION_JSON; the
 * control-stock side mirrors its own application-e2e.properties (bootstrap client, trusted issuer).
 */
export const PELU_API_PORT = 8082;
export const PELU_SPA_PORT = 5175;
export const STOCK_API_PORT = 8090;
export const STOCK_SPA_PORT = 5180;
/** pelu → this proxy → Stock, so specs can take Stock "down" or inject errors (see stock-proxy.mjs). */
export const STOCK_PROXY_PORT = 8091;

export const PELU_API_BASE = `http://127.0.0.1:${PELU_API_PORT}`;
export const PELU_SPA_BASE = `http://localhost:${PELU_SPA_PORT}`;
export const STOCK_API_BASE = `http://127.0.0.1:${STOCK_API_PORT}`;
export const STOCK_SPA_BASE = `http://localhost:${STOCK_SPA_PORT}`;
export const STOCK_PROXY_BASE = `http://127.0.0.1:${STOCK_PROXY_PORT}`;

/** Handoff (SSO) secret + issuer — pelu signs, Stock verifies (HostTokenVerifier). */
export const HANDOFF_SECRET = "e2e-pelu-handoff-secret-min-32-characters!!";
export const HANDOFF_ISSUER = "pelu-e2e";

/** pelu's M2M client in Stock (Stock's bootstrap client in its e2e profile). */
export const STOCK_CLIENT_ID = "pelu-e2e";
export const STOCK_CLIENT_SECRET = "e2e-platform-client-secret";

/** Stock's technical user in pelu (flags pull). */
export const INTEGRATION_CLIENT_ID = "control-stock";
export const INTEGRATION_CLIENT_SECRET = "e2e-stock-integration-client-secret";
