-- D116: who holds a user name a source sent (`holders` in the people store) compares the name in the composed form (NFC)
-- and without regard to case under ICU's root collation, on both sides, so that a name held by a row stored decomposed
-- (NFD) beside a composed one names nobody. The unique index on user names (0054, L13) does not fold composition and
-- cannot serve that comparison, so every lookup read every person in the installation, and a refresh whose rows name a
-- person, a read of a declared view, a search and a started propose each make one. This index has the comparison's own
-- expression. It is not unique, since a row stored decomposed may stand beside a composed one. Unicode normalisation
-- needs a database in UTF-8. The migration writes no rows, and 0054 before it leaves no change signal pending
-- (`tests/db/person-keys-upgrade.test.ts`), so it needs no SET CONSTRAINTS.
CREATE INDEX "auth_person_user_name_nfc" ON "auth_person" USING btree (lower(normalize("user_name", NFC) collate "und-x-icu"));
