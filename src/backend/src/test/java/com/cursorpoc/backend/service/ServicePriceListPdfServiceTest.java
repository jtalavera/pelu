package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.lowagie.text.pdf.PdfReader;
import com.lowagie.text.pdf.parser.PdfTextExtractor;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** Issue #217 "Lista de precios compartible". */
@ExtendWith(MockitoExtension.class)
class ServicePriceListPdfServiceTest {

  @Mock private SalonServiceRepository salonServiceRepository;
  @Mock private BusinessProfileRepository businessProfileRepository;

  private ServicePriceListPdfService newService() {
    return new ServicePriceListPdfService(salonServiceRepository, businessProfileRepository);
  }

  private static SalonService service(String name, long priceMinor) {
    SalonService svc = new SalonService();
    svc.setName(name);
    svc.setPriceMinor(BigDecimal.valueOf(priceMinor));
    svc.setActive(true);
    return svc;
  }

  private static String extractText(byte[] pdf) throws Exception {
    PdfReader reader = new PdfReader(pdf);
    try {
      PdfTextExtractor extractor = new PdfTextExtractor(reader);
      StringBuilder out = new StringBuilder();
      for (int i = 1; i <= reader.getNumberOfPages(); i++) {
        out.append(extractor.getTextFromPage(i)).append('\n');
      }
      return out.toString();
    } finally {
      reader.close();
    }
  }

  private BusinessProfile profileWith(String fantasyName, String businessName) {
    Tenant tenant = new Tenant();
    tenant.setId(1L);
    BusinessProfile profile = new BusinessProfile();
    profile.setTenant(tenant);
    profile.setBusinessName(businessName);
    profile.setSifenFantasyName(fantasyName);
    return profile;
  }

  @Test
  void includesOnlyActiveServicesRepositoryQuery() {
    // The repository query itself (findByTenant_IdAndActiveTrueOrderByNameAsc) is what enforces
    // "active = true only" — the service just renders whatever it returns. Verifying it asks for
    // the active-only, tenant-scoped query is the unit-level contract for that AC; the SQL
    // predicate itself is exercised by ServiceCatalogService/repository-level coverage.
    when(salonServiceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(1L))
        .thenReturn(List.of(service("Corte", 50_000)));
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(profileWith(null, "Peluqueria Demo")));

    byte[] pdf = newService().buildPriceListPdf(1L);

    org.mockito.Mockito.verify(salonServiceRepository)
        .findByTenant_IdAndActiveTrueOrderByNameAsc(1L);
    assertThat(pdf).isNotEmpty();
  }

  @Test
  void rendersActiveServiceNameAndFormattedPrice() throws Exception {
    when(salonServiceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(1L))
        .thenReturn(List.of(service("Corte de cabello", 150_000)));
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(profileWith(null, "Peluqueria Demo")));

    byte[] pdf = newService().buildPriceListPdf(1L);
    String text = extractText(pdf);

    assertThat(text).contains("Corte de cabello");
    // Same format as the frontend's formatGuaraniesGs: "Gs. " + dot-grouped, no decimals.
    assertThat(text).contains("Gs. 150.000");
  }

  @Test
  void headerUsesFantasyNameWhenConfigured() throws Exception {
    when(salonServiceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(1L))
        .thenReturn(List.of(service("Corte", 50_000)));
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(profileWith("Salón Bella", "Peluqueria Demo S.A.")));

    byte[] pdf = newService().buildPriceListPdf(1L);
    String text = extractText(pdf);

    assertThat(text).contains("Salón Bella");
  }

  @Test
  void headerFallsBackToBusinessNameWhenNoFantasyName() throws Exception {
    when(salonServiceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(1L))
        .thenReturn(List.of(service("Corte", 50_000)));
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(profileWith(null, "Peluqueria Demo S.A.")));

    byte[] pdf = newService().buildPriceListPdf(1L);
    String text = extractText(pdf);

    assertThat(text).contains("Peluqueria Demo S.A.");
  }

  @Test
  void handlesMissingBusinessProfileGracefully() {
    when(salonServiceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(1L))
        .thenReturn(List.of(service("Corte", 50_000)));
    when(businessProfileRepository.findByTenantId(1L)).thenReturn(Optional.empty());

    byte[] pdf = newService().buildPriceListPdf(1L);

    assertThat(pdf).isNotEmpty();
  }
}
