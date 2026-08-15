-- Additive, non-destructive: adds ContentPiece.generatedBody as the immutable
-- snapshot of the drafting provider's output. Existing rows are backfilled
-- from `body` (the only honest source value available for rows drafted
-- before this column existed) before the NOT NULL constraint is applied, so
-- this never fails against a populated table. `body` itself is untouched.

-- AlterTable: add as nullable first, existing rows would otherwise violate
-- a NOT NULL constraint immediately.
ALTER TABLE "ContentPiece" ADD COLUMN "generatedBody" TEXT;

-- Backfill: for every pre-existing row, the only known "generated" value is
-- whatever body currently holds (no edit endpoint existed before this
-- migration, so body === what the drafting provider produced for all of
-- them).
UPDATE "ContentPiece" SET "generatedBody" = "body" WHERE "generatedBody" IS NULL;

-- Tighten: now safe to require, matching the schema's non-nullable field.
ALTER TABLE "ContentPiece" ALTER COLUMN "generatedBody" SET NOT NULL;
