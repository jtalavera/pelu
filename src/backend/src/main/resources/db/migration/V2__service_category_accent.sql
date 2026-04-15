ALTER TABLE service_categories ADD accent_key NVARCHAR(32) NOT NULL
  CONSTRAINT df_service_categories_accent DEFAULT 'stone';
