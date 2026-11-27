package com.cursorpoc.backend.whatsapp;

/** {@code wamid} is the message id Meta returns; HU-WAP-07 matches delivery statuses with it. */
public record WhatsAppSendResult(String wamid) {}
