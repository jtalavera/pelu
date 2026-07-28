package com.cursorpoc.backend.service;

/**
 * SIFEN HU-02: datos del cliente como receptor del documento. Todos los campos son nullable — un
 * consumidor final sin RUC (AC-04) produce una instancia con todo en {@code null} salvo, quizás,
 * {@code name}.
 */
public record SifenReceiverData(
    String ruc,
    String identityDocumentNumber,
    String name,
    String address,
    String department,
    String city) {}
