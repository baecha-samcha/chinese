-- NULL preserves unknown provenance for existing data; never infer textbook.
ALTER TABLE vocabulary ADD COLUMN source INTEGER CHECK(source IN (0, 1));
ALTER TABLE sentences ADD COLUMN source INTEGER CHECK(source IN (0, 1));
