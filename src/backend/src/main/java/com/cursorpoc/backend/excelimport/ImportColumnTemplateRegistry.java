package com.cursorpoc.backend.excelimport;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * HU-50 AC-1: single source of truth for the three standard import column templates (servicios,
 * clientes, profesionales). Grounded in the real JPA entities ({@code SalonService}, {@code
 * Client}, {@code Professional} — see their fields) rather than invented columns, per the PRD
 * ("Formato estándar de Excel"). Column keys are the literal Spanish header names AC-2..AC-4
 * mandate — the file format is part of the product spec, not translated UI copy.
 *
 * <ul>
 *   <li>AC-2 Servicios: {@code categoria} (created in the tenant if missing — maps to {@code
 *       ServiceCategory.name}), {@code nombre} ({@code SalonService.name}), {@code precio} ({@code
 *       SalonService.priceMinor}, integer Guaraníes, no separators), {@code duracion_minutos}
 *       ({@code SalonService.durationMinutes}), optional {@code impuesto} (maps to {@code
 *       Tax.name}; omitted = no tax), optional {@code activo} (SI/NO, default SI, maps to {@code
 *       SalonService.active}).
 *   <li>AC-3 Clientes: {@code nombre_completo} ({@code Client.fullName}), optional {@code
 *       telefono}/{@code email}/{@code ruc}/{@code documento_identidad}/{@code direccion}/{@code
 *       activo} (mapping to {@code Client.phone}/{@code email}/{@code ruc}/{@code
 *       identityDocumentNumber}/{@code address}/{@code active}).
 *   <li>AC-4 Profesionales: {@code nombre_completo} ({@code Professional.fullName}), optional
 *       {@code telefono}/{@code email}/{@code direccion}/{@code activo}. PIN and system access are
 *       deliberately excluded — configured manually per HU-22, never via Excel.
 * </ul>
 */
@Component
public class ImportColumnTemplateRegistry {

  private static final Map<ImportEntityType, List<ImportColumnDefinition>> TEMPLATES =
      Map.of(
          ImportEntityType.SERVICES,
          List.of(
              new ImportColumnDefinition("categoria", true),
              new ImportColumnDefinition("nombre", true),
              new ImportColumnDefinition("precio", true),
              new ImportColumnDefinition("duracion_minutos", true),
              new ImportColumnDefinition("impuesto", false),
              new ImportColumnDefinition("activo", false)),
          ImportEntityType.CLIENTS,
          List.of(
              new ImportColumnDefinition("nombre_completo", true),
              new ImportColumnDefinition("telefono", false),
              new ImportColumnDefinition("email", false),
              new ImportColumnDefinition("ruc", false),
              new ImportColumnDefinition("documento_identidad", false),
              new ImportColumnDefinition("direccion", false),
              new ImportColumnDefinition("activo", false)),
          ImportEntityType.PROFESSIONALS,
          List.of(
              new ImportColumnDefinition("nombre_completo", true),
              new ImportColumnDefinition("telefono", false),
              new ImportColumnDefinition("email", false),
              new ImportColumnDefinition("direccion", false),
              new ImportColumnDefinition("activo", false)));

  public List<ImportColumnDefinition> columnsFor(ImportEntityType entityType) {
    return TEMPLATES.get(entityType);
  }

  public Map<ImportEntityType, List<ImportColumnDefinition>> allTemplates() {
    return TEMPLATES;
  }
}
