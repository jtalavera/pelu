package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.BookingSettings;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BookingSettingsRepository extends JpaRepository<BookingSettings, Long> {

  @Query("SELECT b FROM BookingSettings b JOIN FETCH b.tenant WHERE b.slug = :slug")
  Optional<BookingSettings> findBySlug(@Param("slug") String slug);

  @Query("SELECT b FROM BookingSettings b WHERE b.tenant.id = :tenantId")
  Optional<BookingSettings> findByTenantId(@Param("tenantId") Long tenantId);

  boolean existsBySlug(String slug);
}
