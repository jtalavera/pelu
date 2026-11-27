package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.WhatsAppOptOut;
import com.cursorpoc.backend.domain.WhatsAppUnreachable;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.WhatsAppOptOutRepository;
import com.cursorpoc.backend.repository.WhatsAppUnreachableRepository;
import com.cursorpoc.backend.util.PhoneNumberNormalizer;
import java.time.Instant;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-WAP-03: who may receive WhatsApp notices. Consent is per client and bound to the number it was
 * given for; opt-outs and unreachable numbers are per PHONE and apply to every salon (one shared
 * number). The verification code never goes through these checks: the client asks for it herself.
 */
@Service
public class WhatsAppConsentService {

  /** Why a message must not be sent over WhatsApp. */
  public enum Block {
    /** The client has no valid consent for this number (never given, withdrawn, phone changed). */
    NO_CONSENT,
    /** The phone asked to stop (platform-wide). */
    OPTED_OUT,
    /** The generic "cliente ocasional" never receives WhatsApp. */
    GENERIC_CLIENT,
    /** Meta reported the number has no WhatsApp. */
    UNREACHABLE
  }

  public static final String SOURCE_STAFF = "STAFF";

  private final ClientRepository clients;
  private final WhatsAppOptOutRepository optOuts;
  private final WhatsAppUnreachableRepository unreachable;

  public WhatsAppConsentService(
      ClientRepository clients,
      WhatsAppOptOutRepository optOuts,
      WhatsAppUnreachableRepository unreachable) {
    this.clients = clients;
    this.optOuts = optOuts;
    this.unreachable = unreachable;
  }

  /**
   * Whether a notice to {@code phone} may go out. Phone-level checks always apply; the client-level
   * consent applies when the message is tied to a client ({@code clientId}). A message of an online
   * booking without a registered client carries its own consent, attested by whoever queued it
   * (HU-WAP-04).
   */
  @Transactional(readOnly = true)
  public Optional<Block> blockFor(long tenantId, Long clientId, String phone) {
    if (phone == null || optOuts.existsById(phone)) {
      return Optional.of(Block.OPTED_OUT);
    }
    if (unreachable.existsById(phone)) {
      return Optional.of(Block.UNREACHABLE);
    }
    if (clientId != null) {
      Client c = clients.findByIdAndTenant_Id(clientId, tenantId).orElse(null);
      if (c == null || !c.isWhatsappOptIn() || !phone.equals(c.getWhatsappOptInPhone())) {
        return Optional.of(Block.NO_CONSENT);
      }
      if (c.isGeneric()) {
        return Optional.of(Block.GENERIC_CLIENT);
      }
    }
    return Optional.empty();
  }

  public boolean isOptedOut(String phone) {
    return phone != null && optOuts.existsById(phone);
  }

  /** Records a platform-wide opt-out ({@code BAJA}); effective immediately. */
  @Transactional
  public void optOut(String phone, String source) {
    if (phone != null && !optOuts.existsById(phone)) {
      optOuts.save(new WhatsAppOptOut(phone, Instant.now(), source));
    }
  }

  /** Reverses an opt-out ({@code ALTA}, or a new consent through the online booking). */
  @Transactional
  public void optIn(String phone) {
    if (phone != null) {
      optOuts.deleteById(phone);
    }
  }

  /** The number cannot receive WhatsApp (HU-WAP-07 criterio 4). */
  @Transactional
  public void markUnreachable(String phone, String reason) {
    if (phone != null && !unreachable.existsById(phone)) {
      unreachable.save(new WhatsAppUnreachable(phone, Instant.now(), reason));
    }
  }

  /** The client's phone changed: the old unreachable mark is for the old number, so it is moot. */
  @Transactional
  public void clearUnreachable(String phone) {
    if (phone != null) {
      unreachable.deleteById(phone);
    }
  }

  /** E.164 of a stored phone, or empty when it cannot be normalized. */
  public static Optional<String> normalize(String phone) {
    return PhoneNumberNormalizer.normalize(phone);
  }

  /**
   * HU-WAP-03 criterio 8: after the salon edits a client's phone, drops the consent that was given
   * for the previous number. Returns true when a consent was cleared.
   */
  public static boolean invalidateIfPhoneChanged(Client client) {
    if (!client.isWhatsappOptIn()) {
      return false;
    }
    String now = normalize(client.getPhone()).orElse(null);
    if (now != null && now.equals(client.getWhatsappOptInPhone())) {
      return false;
    }
    client.setWhatsappOptIn(false);
    client.setWhatsappOptInPhone(null);
    return true;
  }
}
