import { Injectable } from "@nestjs/common";
import { AiTask } from "@prisma/client";
import { dailyLimit, usageWindowStart } from "../../common/usage-limits";
import { PrismaService } from "../../prisma/prisma.service";
import { computeFounderStats, FounderStats } from "./stats-core";

// Plenty for a beta founder's history; the page lists at most 50 anyway.
const MAX_OUTCOMES = 500;

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async forFounder(userId: string): Promise<FounderStats> {
    const since = usageWindowStart();
    const [statusGroups, records, draftsUsed, reportsUsed] = await Promise.all([
      this.prisma.story.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
      this.prisma.signalRecord.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: MAX_OUTCOMES,
        include: {
          feedbackReport: {
            select: { send: { select: { contentPiece: { select: { storyId: true, story: { select: { title: true, rawCapture: true } } } } } } },
          },
        },
      }),
      this.prisma.aiRequest.count({ where: { userId, task: AiTask.DRAFT, createdAt: { gte: since } } }),
      this.prisma.aiRequest.count({ where: { userId, task: AiTask.EXTRACTION, createdAt: { gte: since } } }),
    ]);

    return computeFounderStats({
      statusCounts: Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])),
      outcomes: records.map((r) => {
        const piece = r.feedbackReport.send.contentPiece;
        return {
          storyId: piece.storyId,
          title: piece.story.title,
          rawCapture: piece.story.rawCapture,
          channel: r.channel,
          audienceType: r.audienceTypeSnapshot,
          roomSize: r.audienceSizeSnapshot,
          sentiment: r.sentiment,
          reportedAt: r.createdAt,
          views: r.views,
          replies: r.replyCount,
          signups: r.signupCount,
          likes: r.likeCount,
          reposts: r.repostCount,
          quotes: r.quoteCount,
          bookmarks: r.bookmarkCount,
          shares: r.shareCount,
          newFollowers: r.newFollowerCount,
        };
      }),
      aiUsage: {
        drafts: { used: draftsUsed, limit: dailyLimit("draft") },
        reportBacks: { used: reportsUsed, limit: dailyLimit("report") },
      },
    });
  }
}
