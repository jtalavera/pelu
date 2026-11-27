package com.cursorpoc.backend.whatsapp;

/** A template as Meta reports it (HU-WAP-02). */
public record WhatsAppRemoteTemplate(
    String name, String language, String status, String category, String reason) {}
