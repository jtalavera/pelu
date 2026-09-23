package com.cursorpoc.backend.excelimport;

/**
 * HU-50 (Épica E — Importación de datos vía Excel): the three entities a Platform Admin can import
 * for a tenant during onboarding (PRD "Alcance de la importación"). {@link #pathSegment} is the
 * literal URL segment used by {@code PlatformImportTemplateController} and the value the frontend
 * sends back — kept distinct from {@code name()} so the API contract does not silently change if
 * the enum constants are ever reordered or renamed.
 */
public enum ImportEntityType {
  SERVICES("services"),
  CLIENTS("clients"),
  PROFESSIONALS("professionals");

  private final String pathSegment;

  ImportEntityType(String pathSegment) {
    this.pathSegment = pathSegment;
  }

  public String pathSegment() {
    return pathSegment;
  }

  /** Resolves the entity from its URL path segment, or {@code null} when unknown. */
  public static ImportEntityType fromPathSegment(String value) {
    for (ImportEntityType type : values()) {
      if (type.pathSegment.equalsIgnoreCase(value)) {
        return type;
      }
    }
    return null;
  }
}
