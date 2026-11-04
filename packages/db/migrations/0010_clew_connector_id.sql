-- The core connector behind the question threads is `clew`, not the product's Swedish name (D26). Rows written before the rename follow.
UPDATE "thread" SET "connector" = 'clew' WHERE "connector" = 'startsidan';
