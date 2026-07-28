package com.cursorpoc.backend.web.dto;

public record BusinessProfileResponse(
    String businessName,
    String ruc,
    String address,
    String phone,
    String contactEmail,
    String logoDataUrl,
    boolean rucValidForInvoicing,
    String taxpayerType,
    String economicActivityCode,
    String economicActivityDescription,
    String sifenDepartmentCode,
    String sifenDepartmentName,
    String sifenCityCode,
    String sifenCityName,
    String sifenFantasyName,
    String kudeFooterMessage) {}
