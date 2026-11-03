-- SignalRecord.tone becomes nullable: null = the post's angle was never
-- honestly classified. Additive / non-destructive (drops a constraint only).
-- AlterTable
ALTER TABLE "SignalRecord" ALTER COLUMN "tone" DROP NOT NULL;

-- Backfill: Tone.OTHER on SignalRecord was only ever the drafting fallback
-- ("uncategorized"), never a genuinely chosen angle -- exactly the
-- OTHER-as-stand-in CLAUDE.md §5 forbids on a moat dimension. Re-express
-- those rows as the honest unknown.
UPDATE "SignalRecord" SET "tone" = NULL WHERE "tone" = 'OTHER';
