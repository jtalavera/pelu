package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.ProfessionalOptionResponse;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The assistant tools never take tenant or role from the model: both come from {@link
 * AssistantContext}. Also: what each role may see, and the date handling.
 */
class AssistantToolsTest {

  private static final long TENANT = 7L;

  private final AssistantRecordTools records = mock(AssistantRecordTools.class);
  private final ClientService clients = mock(ClientService.class);
  private final ServiceCatalogService catalog = mock(ServiceCatalogService.class);
  private final ProfessionalDirectoryService professionals =
      mock(ProfessionalDirectoryService.class);
  private final AppointmentService appointments = mock(AppointmentService.class);
  private final FemmeTimeProperties time = new FemmeTimeProperties();
  private final JsonMapper json = JsonMapper.builder().build();
  private final AssistantTools tools =
      new AssistantTools(
          clients,
          catalog,
          professionals,
          appointments,
          time,
          json,
          mock(AssistantProposalTools.class),
          mock(AssistantAgendaTools.class),
          records);

  private static AssistantContext admin() {
    return new AssistantContext(TENANT, 1L, UserRole.ADMIN, null, "hoy");
  }

  private static AssistantContext professional() {
    return new AssistantContext(TENANT, 2L, UserRole.PROFESSIONAL, 9L, "hoy");
  }

  private static ClientResponse client(long id, String name, String phone, String ruc) {
    return new ClientResponse(
        id, name, phone, "e@x.com", ruc, true, 3, null, null, null, null, null, null, null, null,
        null, null, null, null, null, null);
  }

  private JsonNode run(AssistantContext ctx, String tool, String args) {
    return json.readTree(tools.execute(ctx, tool, args));
  }

  @Test
  void fichaToolsAreKnownAndRoutedToTheirClass() {
    assertThat(AssistantTools.isKnown("ver_ficha_abierta")).isTrue();
    assertThat(AssistantTools.isKnown("proponer_ficha")).isTrue();
    var outcome = ToolOutcome.of("{\"data\":{}}");
    when(records.handles("ver_ficha_abierta")).thenReturn(true);
    when(records.run(any(), eq("ver_ficha_abierta"), any())).thenReturn(outcome);

    assertThat(tools.run(admin(), "ver_ficha_abierta", "{\"clientId\":42}")).isSameAs(outcome);
  }

  @Test
  void fichaToolSpecsAreAddedForTheRole() {
    var spec = new AssistantModelClient.ToolSpec("proponer_ficha", "d", "{}");
    when(records.specsFor(professional())).thenReturn(List.of(spec));

    assertThat(tools.specsFor(professional())).contains(spec);
  }

  @Test
  void everyToolIsReadOnlyAndHasNoTenantOrRoleParameter() {
    for (var spec : tools.specsFor(admin())) {
      assertThat(spec.parametersSchema()).doesNotContain("tenant").doesNotContain("role");
    }
    assertThat(tools.specsFor(admin()))
        .extracting(s -> s.name())
        .containsExactly(
            "buscar_clientes",
            "listar_servicios",
            "listar_productos",
            "listar_profesionales",
            "turnos_del_dia");
  }

  @Test
  void buscarClientes_usesTheTenantOfTheContext_notOneFromTheArguments() {
    when(clients.search(eq(TENANT), eq("maria"), any(), any(), any()))
        .thenReturn(List.of(client(1, "Maria Gomez", "0981", "80000005-6")));

    // The model tries to smuggle another tenant in: it is simply ignored.
    JsonNode out = run(admin(), "buscar_clientes", "{\"query\":\"maria\",\"tenantId\":999}");

    ArgumentCaptor<Long> tenant = ArgumentCaptor.forClass(Long.class);
    verify(clients).search(tenant.capture(), eq("maria"), any(), any(), any());
    assertThat(tenant.getValue()).isEqualTo(TENANT);
    JsonNode row = out.get("data").get("clients").get(0);
    assertThat(row.get("fullName").asString()).isEqualTo("Maria Gomez");
    assertThat(row.get("phone").asString()).isEqualTo("0981");
    assertThat(row.get("ruc").asString()).isEqualTo("80000005-6");
    // Never the e-mail or any other profile field.
    assertThat(row.has("email")).isFalse();
  }

  @Test
  void buscarClientes_forAProfessional_returnsNamesOnly_andSearchesByNameOnly() {
    when(clients.search(eq(TENANT), eq("0981"), any(), any(), any()))
        .thenReturn(List.of(client(1, "Maria Gomez", "0981", "80000005-6")));

    // Matches only by phone: a professional must not find anyone that way (HU-68 AC12).
    JsonNode byPhone = run(professional(), "buscar_clientes", "{\"query\":\"0981\"}");
    assertThat(byPhone.get("data").get("clients")).isEmpty();

    when(clients.search(eq(TENANT), eq("maria"), any(), any(), any()))
        .thenReturn(List.of(client(1, "Maria Gomez", "0981", "80000005-6")));
    JsonNode byName = run(professional(), "buscar_clientes", "{\"query\":\"maria\"}");
    JsonNode row = byName.get("data").get("clients").get(0);
    assertThat(row.get("fullName").asString()).isEqualTo("Maria Gomez");
    assertThat(row.has("phone")).isFalse();
    assertThat(row.has("ruc")).isFalse();
  }

  @Test
  void buscarClientes_rejectsTooShortQueries_withoutHittingTheService() {
    JsonNode out = run(admin(), "buscar_clientes", "{\"query\":\"a\"}");

    assertThat(out.get("error").asString()).isEqualTo("QUERY_TOO_SHORT");
    verify(clients, never()).search(anyLong(), any(), any(), any(), any());
  }

  @Test
  void buscarClientes_capsTheResultsAndSaysSo() {
    List<ClientResponse> many =
        java.util.stream.IntStream.range(0, 25)
            .mapToObj(i -> client(i, "Cliente " + i, "098" + i, null))
            .toList();
    when(clients.search(eq(TENANT), eq("cliente"), any(), any(), any())).thenReturn(many);

    JsonNode data = run(admin(), "buscar_clientes", "{\"query\":\"cliente\"}").get("data");

    assertThat(data.get("clients")).hasSize(AssistantTools.MAX_CLIENTS);
    assertThat(data.get("truncated").asBoolean()).isTrue();
  }

  @Test
  void listarServicios_onlyActiveServices_withNameAndFormattedPriceAndNothingElse() {
    when(catalog.listServices(eq(TENANT), eq(Optional.empty()), any(), eq("SERVICE")))
        .thenReturn(List.of(service(1, "Corte", true), service(2, "Servicio viejo", false)));

    JsonNode rows = run(admin(), "listar_servicios", "{}").get("data").get("services");

    assertThat(rows).hasSize(1);
    JsonNode row = rows.get(0);
    assertThat(row.get("name").asString()).isEqualTo("Corte");
    // Fixed format (HU-AST-02 AC6): the price arrives formatted like the app shows it.
    assertThat(row.get("price").asString()).isEqualTo("Gs. 50.000");
    // Only id (for later tool calls), name and price: no category, duration or tax data.
    List<String> fields = new java.util.ArrayList<>();
    row.propertyNames().forEach(fields::add);
    assertThat(fields).containsExactly("id", "name", "price");
  }

  @Test
  void listarProductos_asksForProducts_onlyActiveOnes_inTheSameFixedFormat() {
    when(catalog.listServices(eq(TENANT), eq(Optional.empty()), any(), eq("PRODUCT")))
        .thenReturn(List.of(service(7, "Shampoo", true), service(8, "Producto viejo", false)));

    JsonNode data = run(admin(), "listar_productos", "{}").get("data");

    JsonNode rows = data.get("products");
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).get("name").asString()).isEqualTo("Shampoo");
    assertThat(rows.get(0).get("price").asString()).isEqualTo("Gs. 50.000");
    List<String> fields = new java.util.ArrayList<>();
    rows.get(0).propertyNames().forEach(fields::add);
    assertThat(fields).containsExactly("id", "name", "price");
    // Products never show up under «services».
    assertThat(data.has("services")).isFalse();
  }

  @Test
  void listarProductos_isOpenToAProfessionalToo_andNeverAsksForServices() {
    when(catalog.listServices(eq(TENANT), eq(Optional.empty()), any(), eq("PRODUCT")))
        .thenReturn(List.of(service(7, "Shampoo", true)));

    assertThat(run(professional(), "listar_productos", "{}").get("data").get("products"))
        .hasSize(1);
    verify(catalog, never()).listServices(eq(TENANT), any(), any(), eq("SERVICE"));
  }

  @Test
  void listarProfesionales_onlyActiveOnes() {
    when(professionals.listOptions(TENANT))
        .thenReturn(
            List.of(
                new ProfessionalOptionResponse(1, "Lucia Perez", "Lu", "Lu", true),
                new ProfessionalOptionResponse(2, "Hugo Diaz", null, "Hugo Diaz", false)));

    JsonNode rows =
        run(professional(), "listar_profesionales", "{}").get("data").get("professionals");

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).get("name").asString()).isEqualTo("Lu");
  }

  @Test
  void turnosDelDia_queriesTheBusinessDayInTheBusinessZone() {
    ZoneId zone = time.zoneId();
    when(appointments.list(eq(TENANT), any(), any(), any(), any()))
        .thenReturn(
            List.of(
                new AppointmentResponse(
                    5,
                    10L,
                    "Maria Gomez",
                    3,
                    "Lucia",
                    4,
                    "Corte",
                    30,
                    LocalDate.parse("2026-11-20")
                        .atTime(14, 30)
                        .atZone(zone)
                        .toInstant()
                        .toString(),
                    LocalDate.parse("2026-11-20").atTime(15, 0).atZone(zone).toInstant().toString(),
                    "PENDING",
                    null,
                    null,
                    false,
                    null,
                    null)));

    JsonNode data =
        run(admin(), "turnos_del_dia", "{\"date\":\"2026-11-20\",\"professionalId\":3}")
            .get("data");

    ArgumentCaptor<Instant> from = ArgumentCaptor.forClass(Instant.class);
    ArgumentCaptor<Instant> to = ArgumentCaptor.forClass(Instant.class);
    verify(appointments).list(eq(TENANT), from.capture(), to.capture(), eq(3L), eq(null));
    assertThat(from.getValue())
        .isEqualTo(LocalDate.parse("2026-11-20").atStartOfDay(zone).toInstant());
    assertThat(to.getValue())
        .isEqualTo(LocalDate.parse("2026-11-21").atStartOfDay(zone).toInstant());
    JsonNode row = data.get("appointments").get(0);
    assertThat(row.get("start").asString()).isEqualTo("14:30");
    assertThat(row.get("clientName").asString()).isEqualTo("Maria Gomez");
    assertThat(data.get("date").asString()).isEqualTo("2026-11-20");
  }

  @Test
  void resolveDate_understandsRelativeWordsInSpanishAndEnglish() {
    ZoneId zone = time.zoneId();
    LocalDate today = LocalDate.now(zone);

    assertThat(tools.resolveDate("hoy", zone)).isEqualTo(today);
    assertThat(tools.resolveDate("Today", zone)).isEqualTo(today);
    assertThat(tools.resolveDate("mañana", zone)).isEqualTo(today.plusDays(1));
    assertThat(tools.resolveDate("MANANA", zone)).isEqualTo(today.plusDays(1));
    assertThat(tools.resolveDate("2026-12-31", zone)).isEqualTo(LocalDate.parse("2026-12-31"));
    assertThatThrownBy(() -> tools.resolveDate("el jueves", zone)).hasMessage("INVALID_DATE");
    assertThatThrownBy(() -> tools.resolveDate(null, zone)).hasMessage("INVALID_DATE");
  }

  @Test
  void invalidInput_becomesAnErrorResultForTheModel_neverAnException() {
    assertThat(run(admin(), "turnos_del_dia", "{\"date\":\"pasado\"}").get("error").asString())
        .isEqualTo("INVALID_DATE");
    assertThat(
            run(admin(), "turnos_del_dia", "{\"date\":\"hoy\",\"clientId\":\"abc\"}")
                .get("error")
                .asString())
        .isEqualTo("INVALID_ARGUMENTS");
    assertThat(run(admin(), "borrar_todo", "{}").get("error").asString()).isEqualTo("UNKNOWN_TOOL");
    assertThat(run(admin(), "buscar_clientes", "esto no es json").get("error").asString())
        .isEqualTo("TOOL_FAILED");
  }

  @Test
  void aFailingService_isReportedWithoutLeakingItsMessage() {
    when(professionals.listOptions(TENANT))
        .thenThrow(new IllegalStateException("db password=hunter2"));

    String raw = tools.execute(admin(), "listar_profesionales", "{}");

    assertThat(raw).contains("TOOL_FAILED").doesNotContain("hunter2");
  }

  private static ServiceResponse service(long id, String name, boolean active) {
    return new ServiceResponse(
        id,
        1,
        "Cabello",
        "k",
        null,
        null,
        null,
        name,
        BigDecimal.valueOf(50000),
        30,
        active,
        "SERVICE",
        null);
  }
}
