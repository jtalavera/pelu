package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload;
import com.cursorpoc.backend.domain.enums.UserRole;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** Invoicing while a ficha card is still unsaved must not silently drop that card. */
class AssistantProposalToolsFichaPendingTest {

  private static final long TENANT = 7L;
  private static final AssistantContext ADMIN =
      new AssistantContext(TENANT, 1L, UserRole.ADMIN, null, "hoy", 5L);

  private final AssistantInvoiceDrafts invoiceDrafts = mock(AssistantInvoiceDrafts.class);
  private final AssistantDraftService draftService = mock(AssistantDraftService.class);
  private final JsonMapper json = JsonMapper.builder().build();
  private final AssistantProposalTools tools =
      new AssistantProposalTools(invoiceDrafts, draftService, json);

  @Test
  void refusesWhileAFichaDraftOfThatClientIsActive() {
    when(draftService.activeRecordPayload(ADMIN)).thenReturn(Optional.of(pendingFor(42L)));

    assertThatThrownBy(
            () -> tools.run(ADMIN, "proponer_factura", json.readTree("{\"clientId\":42}")))
        .hasMessage("FICHA_DRAFT_PENDING");
    verify(invoiceDrafts, never()).build(any(Long.class), any());
  }

  @Test
  void doesNotGetInTheWayOfAnotherClientOrWithoutAFichaDraft() {
    when(invoiceDrafts.build(any(Long.class), any()))
        .thenThrow(new AssistantTools.ToolException("NOTHING_TO_INVOICE"));
    when(draftService.activeRecordPayload(ADMIN)).thenReturn(Optional.of(pendingFor(42L)));

    assertThatThrownBy(
            () -> tools.run(ADMIN, "proponer_factura", json.readTree("{\"clientId\":43}")))
        .hasMessage("NOTHING_TO_INVOICE"); // it got as far as building the invoice

    when(draftService.activeRecordPayload(ADMIN)).thenReturn(Optional.empty());
    assertThatThrownBy(
            () -> tools.run(ADMIN, "proponer_factura", json.readTree("{\"clientId\":42}")))
        .hasMessage("NOTHING_TO_INVOICE");
  }

  private static ServiceRecordDraftPayload pendingFor(long clientId) {
    return new ServiceRecordDraftPayload(
        clientId, "MARIA", 500L, null, null, List.of(), List.of(), List.of(), null, "fp");
  }
}
