-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('DRAFT_ONLY', 'STARTER', 'GROWTH', 'SCALE');

-- CreateEnum
CREATE TYPE "Niche" AS ENUM ('DEV_TOOLS', 'AI_TOOLS', 'PRODUCTIVITY', 'NO_CODE', 'MARKETING_TOOLS', 'ANALYTICS', 'DESIGN_TOOLS', 'ECOMMERCE', 'FINTECH', 'OTHER');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('FEATURE_ANNOUNCEMENT', 'MILESTONE', 'LESSON_LEARNED', 'OTHER');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'X', 'LINKEDIN', 'BLOG', 'DISCORD');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('PREVIEW', 'WIDE');

-- CreateEnum
CREATE TYPE "Tone" AS ENUM ('VULNERABLE', 'CONFIDENT', 'EDUCATIONAL', 'CASUAL', 'PROFESSIONAL', 'HUMBLE', 'CELEBRATORY', 'REFLECTIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "AudienceType" AS ENUM ('EMAIL_LIST', 'DISCORD', 'BETA_USERS', 'PEERS');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'MIXED', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "PostFormat" AS ENUM ('SINGLE', 'THREAD', 'QUOTE', 'REPLY', 'LONGFORM');

-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('CAPTURED', 'DRAFTED', 'STAGED', 'REPORTED', 'GRADUATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentPieceStatus" AS ENUM ('DRAFTED', 'EDITED', 'SENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'DRAFT_ONLY',
    "aggregateLearningConsent" BOOLEAN NOT NULL DEFAULT false,
    "niche" "Niche",
    "hashedRefreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawCapture" TEXT NOT NULL,
    "title" TEXT,
    "contentType" "ContentType" NOT NULL,
    "status" "StoryStatus" NOT NULL DEFAULT 'CAPTURED',
    "graduatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPiece" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "stage" "Stage" NOT NULL,
    "tone" "Tone" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ContentPieceStatus" NOT NULL DEFAULT 'DRAFTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPiece_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audience" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AudienceType" NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Audience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Send" (
    "id" TEXT NOT NULL,
    "contentPieceId" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "audienceSizeSnapshot" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Send_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackReport" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "rawFeedback" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "styleSample" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedbackReportId" TEXT NOT NULL,
    "niche" "Niche" NOT NULL,
    "channel" "Channel" NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "tone" "Tone" NOT NULL,
    "audienceSizeSnapshot" INTEGER NOT NULL,
    "views" INTEGER,
    "replyCount" INTEGER,
    "signupCount" INTEGER,
    "sentiment" "Sentiment",
    "postedAt" TIMESTAMP(3),
    "followerCountSnapshot" INTEGER,
    "hasMedia" BOOLEAN,
    "hasExternalLink" BOOLEAN,
    "postFormat" "PostFormat",
    "isPremiumAccount" BOOLEAN,
    "confidenceLow" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatedInsight" (
    "id" TEXT NOT NULL,
    "niche" "Niche" NOT NULL,
    "channel" "Channel" NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "tone" "Tone" NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "positiveRate" DOUBLE PRECISION,
    "avgReplyCount" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatedInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Audience_userId_idx" ON "Audience"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Send_contentPieceId_audienceId_key" ON "Send"("contentPieceId", "audienceId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackReport_sendId_key" ON "FeedbackReport"("sendId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceProfile_userId_key" ON "VoiceProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SignalRecord_feedbackReportId_key" ON "SignalRecord"("feedbackReportId");

-- CreateIndex
CREATE INDEX "SignalRecord_userId_idx" ON "SignalRecord"("userId");

-- CreateIndex
CREATE INDEX "SignalRecord_niche_channel_contentType_tone_idx" ON "SignalRecord"("niche", "channel", "contentType", "tone");

-- CreateIndex
CREATE INDEX "SignalRecord_niche_channel_postFormat_idx" ON "SignalRecord"("niche", "channel", "postFormat");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatedInsight_niche_channel_contentType_tone_key" ON "AggregatedInsight"("niche", "channel", "contentType", "tone");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audience" ADD CONSTRAINT "Audience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Send" ADD CONSTRAINT "Send_contentPieceId_fkey" FOREIGN KEY ("contentPieceId") REFERENCES "ContentPiece"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Send" ADD CONSTRAINT "Send_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "Send"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceProfile" ADD CONSTRAINT "VoiceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalRecord" ADD CONSTRAINT "SignalRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalRecord" ADD CONSTRAINT "SignalRecord_feedbackReportId_fkey" FOREIGN KEY ("feedbackReportId") REFERENCES "FeedbackReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

