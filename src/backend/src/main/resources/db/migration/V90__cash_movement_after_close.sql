-- A tip withdrawal made while no cash register is open is recorded on the last closed one, flagged as
-- "after close": it shows in that register's movements but never changes its expected cash, counted
-- cash or difference (the closing figures stay frozen; the next opening starts from the real cash).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cash_movements') AND name = 'after_close')
BEGIN
    ALTER TABLE cash_movements ADD after_close BIT NOT NULL CONSTRAINT df_cash_movements_after_close DEFAULT 0;
END
