import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, StoryStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateReportDto } from "./dto/create-report.dto";
import { EXTRACTION_PROVIDER, ExtractionProvider } from "./extraction/extraction.provider";

interface PaginationParams {
  page?: number;
  limit?: number;
}

// Story statuses a Send may be reported against. STAGED -> the first report
// on this story flips it to REPORTED. REPORTED -> a later Send on the SAME
// story (the multi-send case) gets reported too; the story simply stays
// REPORTED — the second-writer case, mirrors send.service.ts's STAGED
// handling. CAPTURED/DRAFTED means the piece was never sent, nothing to
// report yet. GRADUATED/ARCHIVED means the loop already moved past
// reporting; a late report there would be a stale event, not a real signal.
const REPORTABLE_STORY_STATUSES: StoryStatus[] = [StoryStatus.STAGED, StoryStatus.REPORTED];

@Injectable()
export class ReportBackService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EXTRACTION_PROVIDER) private readonly extractionProvider: ExtractionProvider,
  ) {}

  async reportBack(dto: CreateReportDto, userId: string) {
    const send = await this.prisma.send.findUnique({
      where: { id: dto.sendId },
      include: { contentPiece: { include: { story: { include: { user: true } } } } },
    });
    const story = send?.contentPiece.story;
    if (!send || !story || story.userId !== userId) {
      throw new NotFoundException(`Send ${dto.sendId} not found`);
    }

    // Fail-closed gate on a moat dimension (README §5 "NEVER synthesize a
    // value for a poolable-layer dimension"): niche is SignalRecord's
    // primary grouping key, snapshotted and frozen forever once written. A
    // guessed/defaulted niche wouldn't be a slightly-worse data point — it
    // would pool incorrectly forever. Refuse the whole write instead of
    // inventing one; nothing is created here (no FeedbackReport, no
    // SignalRecord). Fixing this upstream (onboarding/settings letting the
    // founder set niche) makes this guard stop firing naturally.
    if (!story.user.niche) {
      throw new BadRequestException("Set your niche before reporting back — it's the grouping key for all your insights.");
    }
    const niche = story.user.niche;

    if (!REPORTABLE_STORY_STATUSES.includes(story.status)) {
      throw new ConflictException(
        `Story ${story.id} is ${story.status}; only a STAGED or already-REPORTED story's Send can be reported on`,
      );
    }

    // Service-level duplicate pre-check (mirrors send.service.ts) — the
    // FeedbackReport.sendId @unique constraint is the DB-level backstop for
    // a genuine race, not the primary guard.
    const existingReport = await this.prisma.feedbackReport.findUnique({ where: { sendId: dto.sendId } });
    if (existingReport) {
      throw new ConflictException(`Send ${dto.sendId} has already been reported on`);
    }

    const contentPiece = send.contentPiece;

    // FIRST WRITE INTO THE POOLABLE LAYER (README §5): everything the
    // SignalRecord below snapshots (audienceSizeSnapshot, channel, tone,
    // contentType, niche) was already read above, at THIS moment — never
    // re-joined live inside the transaction. If the founder later edits the
    // draft or switches niche, this recorded fact must not silently
    // rewrite itself.
    //
    // FUTURE SPLIT — do not lose this comment when StubExtractionProvider is
    // replaced by a real, fallible/async LLM call: this single transaction
    // MUST split into two. Persist the FeedbackReport UNCONDITIONALLY first,
    // committed on its own — the founder's raw words must never be lost to
    // an extraction failure or timeout. Then run extraction with retry
    // outside that commit, and only once it succeeds, write SignalRecord and
    // flip Story.status in a second transaction. The raw report is the
    // durable fact; the structured signal is always re-derivable from it
    // later, so losing the signal transiently is recoverable — losing the
    // raw report is not.
    //
    // Uses the interactive (callback) $transaction form, not the array form
    // used in capture.service.ts / send.service.ts: SignalRecord.feedbackReportId
    // must reference the FeedbackReport row's freshly generated id, which
    // only exists once that create resolves inside the transaction — the
    // array form can't express that dependency between steps.
    const result = await this.prisma.$transaction(async (tx) => {
      const feedbackReport = await tx.feedbackReport.create({
        data: { sendId: send.id, rawFeedback: dto.rawFeedback },
      });

      const extracted = await this.extractionProvider.extract({
        rawFeedback: dto.rawFeedback,
        channel: contentPiece.channel,
      });

      const signalRecord = await tx.signalRecord.create({
        data: {
          userId,
          feedbackReportId: feedbackReport.id,
          // Snapshotted dims (§5 rule 1) — frozen copies, not live joins.
          niche,
          channel: contentPiece.channel,
          contentType: story.contentType,
          tone: contentPiece.tone,
          audienceSizeSnapshot: send.audienceSizeSnapshot,
          // Extracted (stubbed today, LLM-backed later) — null preserved
          // exactly as returned, never coerced to 0/false.
          views: extracted.views,
          replyCount: extracted.replyCount,
          signupCount: extracted.signupCount,
          sentiment: extracted.sentiment,
          hasMedia: extracted.hasMedia,
          hasExternalLink: extracted.hasExternalLink,
          postFormat: extracted.postFormat,
          followerCountSnapshot: extracted.followerCountSnapshot,
          isPremiumAccount: extracted.isPremiumAccount,
          postedAt: extracted.postedAt,
          // confidenceLow left at its schema default (true, §5 rule 4) — a
          // single report never earns confidence; not set explicitly here.
        },
      });

      // Consent is NEVER checked here (§5 rule 2): pooling gates
      // cross-founder AGGREGATION READS at query time, not this write. An
      // opted-out founder still owns and needs their own signal history for
      // their self-relative baseline.
      await tx.story.update({ where: { id: story.id }, data: { status: StoryStatus.REPORTED } });

      return { ...feedbackReport, signalRecord };
    });

    return result;
  }

  async findAll(userId: string, { page = 1, limit = 20 }: PaginationParams) {
    const skip = (page - 1) * limit;
    const where: Prisma.FeedbackReportWhereInput = { send: { contentPiece: { story: { userId } } } };

    const [data, total] = await Promise.all([
      this.prisma.feedbackReport.findMany({
        where,
        include: { signalRecord: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.feedbackReport.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, userId: string) {
    const feedbackReport = await this.prisma.feedbackReport.findUnique({
      where: { id },
      include: {
        signalRecord: true,
        send: { include: { contentPiece: { include: { story: true } } } },
      },
    });
    if (!feedbackReport || feedbackReport.send.contentPiece.story.userId !== userId) {
      throw new NotFoundException(`FeedbackReport ${id} not found`);
    }
    return feedbackReport;
  }
}
