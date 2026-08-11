-- SIFEN HU-03 AC-02: service descriptions must support long, detailed text (up to 2000 chars),
-- wider than the 500-char cap that was enough for the traditional (non-SIFEN) invoice flow.
ALTER TABLE invoice_lines ALTER COLUMN description NVARCHAR(2000) NOT NULL;
