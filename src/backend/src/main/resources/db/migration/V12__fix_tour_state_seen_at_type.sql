-- V12: Fix seen_at column type in app_user_tour_state.
-- Hibernate 7 maps java.time.Instant to DATETIMEOFFSET(7) on SQL Server,
-- but V11 created the column as DATETIME2. Alter it to match.
ALTER TABLE app_user_tour_state
  ALTER COLUMN seen_at DATETIMEOFFSET(7) NOT NULL;
