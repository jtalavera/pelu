package com.cursorpoc.backend.whatsapp;

import java.util.Optional;

/**
 * The variable part of the link button of a template: {@code <slug>/turno/<token>} lets the client
 * see or change a turno (HU-RSV-06). Neither the salon's public address (slug, A0/A2) nor the
 * signed token (A5) exist yet, so until they do no template with a link button can be sent and the
 * reminders keep going by email, exactly as before. A5 implements this.
 */
public interface ManageLinkProvider {

  /** The link suffix for this turno, or empty when there is none (then WhatsApp is not used). */
  Optional<String> linkSuffix(long tenantId, long appointmentId);
}
