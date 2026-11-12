package com.cursorpoc.backend.config;

/**
 * SpEL for the single frontend base URL used to build links in emails (activation, password reset).
 *
 * <p>{@code app.frontend.url} (APP_FRONTEND_URL) is a comma-separated list of CORS origins, so it
 * cannot be concatenated into a link as-is. This resolves to {@code app.frontend.primary-url}
 * (APP_FRONTEND_PRIMARY_URL) when set, otherwise to the first entry of {@code app.frontend.url}.
 * Use as {@code @Value(FrontendUrl.PRIMARY_EXPR)}.
 */
public final class FrontendUrl {

  public static final String PRIMARY_EXPR =
      "#{'${app.frontend.primary-url:}'.trim().isEmpty()"
          + " ? '${app.frontend.url}'.split(',')[0].trim()"
          + " : '${app.frontend.primary-url}'.trim()}";

  private FrontendUrl() {}
}
