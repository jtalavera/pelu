package com.cursorpoc.backend.assistant;

/**
 * Life of a draft: {@code DRAFT} until the person confirms, discards it, asks for a change ({@code
 * SUPERSEDED} by a new draft) or it is not confirmed in 24 h ({@code EXPIRED}). {@code CONFIRMING}
 * is only visible while a confirmation is in flight.
 */
public enum AssistantDraftStatus {
  DRAFT,
  SUPERSEDED,
  DISCARDED,
  EXPIRED,
  CONFIRMING,
  CONFIRMED
}
