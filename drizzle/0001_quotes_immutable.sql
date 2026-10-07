-- Quotes are immutable (SPEC §4.3: capture re-checks the stored quote; a quote must never change after it is shown).
CREATE OR REPLACE FUNCTION quotes_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'quotes are immutable (% on quote %)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quotes_no_update_or_delete
  BEFORE UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION quotes_immutable();
