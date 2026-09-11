package com.cursorpoc.backend.excelimport;

/**
 * HU-50 AC-1..AC-4: one column of a standard import template. {@code key} is the exact header
 * literal the file must carry in row 1 (compared case-insensitively, trimmed — AC-5); it is never
 * translated, since it is a file-format contract, not user-facing copy.
 */
public record ImportColumnDefinition(String key, boolean required) {}
