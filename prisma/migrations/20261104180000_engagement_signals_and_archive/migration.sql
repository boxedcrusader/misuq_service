-- AlterTable
ALTER TABLE "SignalRecord" ADD COLUMN     "bookmarkCount" INTEGER,
ADD COLUMN     "likeCount" INTEGER,
ADD COLUMN     "newFollowerCount" INTEGER,
ADD COLUMN     "quoteCount" INTEGER,
ADD COLUMN     "repostCount" INTEGER,
ADD COLUMN     "shareCount" INTEGER;

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "archivedFromStatus" "StoryStatus";

