package com.cursorpoc.backend.web.dto;

import java.util.List;

public record PagedTipWithdrawalsResponse(
    List<TipWithdrawalHistoryItemResponse> content,
    int page,
    int size,
    long totalElements,
    int totalPages) {}
