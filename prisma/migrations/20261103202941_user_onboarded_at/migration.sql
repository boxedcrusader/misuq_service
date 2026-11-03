-- When the founder finished onboarding. Additive, nullable, NOT backfilled:
-- inventing completion times for existing rows would synthesize an event that
-- never happened. Existing users simply read as "not onboarded yet".
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "onboardedAt" TIMESTAMP(3);
