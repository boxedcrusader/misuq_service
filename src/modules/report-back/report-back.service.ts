import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Channel, ContentType, Niche, Prisma, SignalRecord, StoryStatus, Tone } from "@prisma/client";
import { assertUnderDailyLimit, usageWindowStart } from "../../common/usage-limits";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateReportDto } from "./dto/create-report.dto";
import { EXTRACTION_PROVIDER, ExtractedSignal, ExtractionProvider } from "./extraction/extraction.provider";
import { SignalExtractionFailedException } from "./extraction/signal-extraction-failed.exception";

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

// One immediate retry covers a transient blip (timeout, 5xx). Anything
// beyond that is what POST /reports/:id/extract is for.
const EXTRACTION_ATTEMPTS = 2;

const NICHE_REQUIRED = "Set your niche before reporting back — it's the grouping key for all your insights.";

// Everything a SignalRecord snapshots from the private layer (README §5
// rule 1) — gathered once, passed explicitly, never re-joined live.
interface SignalSnapshot {
  userId: string;
  niche: Niche;
  channel: Channel;
  contentType: ContentType;
  tone: Tone | null;
  audienceSizeSnapshot: number;
}

// ContentPiece.tone OTHER means "the drafting step couldn't classify the
// angle" — honest on content, a synthesized grouping key if pooled
// (CLAUDE.md §5). The moat gets the honest unknown instead. Unlike niche,
// this can't fail closed: the founder has no way to fix an LLM's
// classification, and the rest of the signal is still real.
function poolableTone(tone: Tone): Tone | null {
  return tone === Tone.OTHER ? null : tone;
}

@Injectable()
export class ReportBackService {
  private readonly logger = new Logger(ReportBackService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EXTRACTION_PROVIDER) private readonly extractionProvider: ExtractionProvider,
  ) {}

  // Two commits, deliberately (this is the split the old "FUTURE SPLIT"
  // comment here called for once extraction became a real, fallible LLM
  // call):
  //
  //   1. FeedbackReport + Story -> REPORTED, committed together, BEFORE any
  //      LLM call. The founder's raw words are the durable fact and must
  //      never be lost to an extraction failure or timeout. (It also keeps a
  //      15s Gemini call out of a DB transaction, whose default interactive
  //      timeout is 5s.)
  //   2. Extraction (with retry) + SignalRecord, best-effort. On failure the
  //      response carries signalRecord: null and the report stays
  //      re-extractable via retryExtraction() -- the structured signal is
  //      always re-derivable from the raw report; the raw report is not
  //      re-derivable from anything.
  //
  // Deliberate deviation from that old comment, which said to flip
  // Story.status only in step 2: REPORTED records the HUMAN event (the
  // founder reported back), which has happened by step 1. Tying it to
  // extraction would leave a story stuck at STAGED after a Gemini failure
  // -- the founder would be asked "how did it land?" again and their
  // resubmit would 409 as a duplicate, with no way forward.
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
      throw new BadRequestException(NICHE_REQUIRED);
    }

    if (!REPORTABLE_STORY_STATUSES.includes(story.status)) {
      throw new ConflictException(
        `Story ${story.id} is ${story.status}; only a STAGED or already-REPORTED story's Send can be reported on`,
      );
    }

    // Service-level duplicate pre-check (mirrors send.service.ts) — the
    // FeedbackReport.sendId @unique constraint is the DB-level backstop for
    // a genuine race (caught below).
    const existingReport = await this.prisma.feedbackReport.findUnique({ where: { sendId: dto.sendId } });
    if (existingReport) {
      throw new ConflictException(`Send ${dto.sendId} has already been reported on`);
    }

    // Per-account daily cap on Gemini-backed extraction (common/usage-limits.ts),
    // checked before anything is written.
    const reportsInWindow = await this.prisma.feedbackReport.count({
      where: { send: { contentPiece: { story: { userId } } }, createdAt: { gte: usageWindowStart() } },
    });
    assertUnderDailyLimit("report", reportsInWindow);

    // Snapshotted NOW, at report time, from the rows read above — not
    // re-read when the signal is written a moment later.
    const snapshot: SignalSnapshot = {
      userId,
      niche: story.user.niche,
      channel: send.contentPiece.channel,
      contentType: story.contentType,
      tone: poolableTone(send.contentPiece.tone),
      audienceSizeSnapshot: send.audienceSizeSnapshot,
    };

    // Step 1 — the durable human fact.
    let feedbackReport;
    try {
      feedbackReport = await this.prisma.$transaction(async (tx) => {
        const report = await tx.feedbackReport.create({
          data: { sendId: send.id, rawFeedback: dto.rawFeedback },
        });
        await tx.story.update({ where: { id: story.id }, data: { status: StoryStatus.REPORTED } });
        return report;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`Send ${dto.sendId} has already been reported on`);
      }
      throw error;
    }

    // Step 2 — the derived signal, best-effort.
    let signalRecord: SignalRecord | null = null;
    try {
      signalRecord = await this.recordSignal(feedbackReport.id, dto.rawFeedback, snapshot);
    } catch (error) {
      this.logger.warn(
        `Signal extraction failed for FeedbackReport ${feedbackReport.id}; raw report kept, ` +
          `retry with POST /reports/${feedbackReport.id}/extract (${error instanceof Error ? error.message : String(error)})`,
      );
    }

    return { ...feedbackReport, signalRecord };
  }

  // Re-runs extraction for a saved report that has no SignalRecord yet
  // (step 2 above failed). Idempotent by refusal: a report that already has
  // its signal 409s rather than writing a second one — and the
  // SignalRecord.feedbackReportId @unique constraint backstops a race.
  //
  // Snapshot caveat: dimensions are read at RETRY time, not original report
  // time. Today only User.niche could differ between the two, and nothing
  // can change niche yet; revisit when a niche-editing endpoint exists.
  async retryExtraction(feedbackReportId: string, userId: string) {
    const report = await this.prisma.feedbackReport.findUnique({
      where: { id: feedbackReportId },
      include: {
        signalRecord: true,
        send: { include: { contentPiece: { include: { story: { include: { user: true } } } } } },
      },
    });
    const story = report?.send.contentPiece.story;
    if (!report || !story || story.userId !== userId) {
      throw new NotFoundException(`FeedbackReport ${feedbackReportId} not found`);
    }
    if (report.signalRecord) {
      throw new ConflictException(`FeedbackReport ${feedbackReportId} already has its signal`);
    }
    if (!story.user.niche) {
      throw new BadRequestException(NICHE_REQUIRED);
    }

    const signalRecord = await this.recordSignal(report.id, report.rawFeedback, {
      userId,
      niche: story.user.niche,
      channel: report.send.contentPiece.channel,
      contentType: story.contentType,
      tone: poolableTone(report.send.contentPiece.tone),
      audienceSizeSnapshot: report.send.audienceSizeSnapshot,
    });

    const { send: _send, signalRecord: _none, ...feedbackReport } = report;
    return { ...feedbackReport, signalRecord };
  }

  // FIRST WRITE INTO THE POOLABLE LAYER (README §5). Consent is NEVER
  // checked here (§5 rule 2): pooling gates cross-founder AGGREGATION READS
  // at query time, not this write. An opted-out founder still owns and
  // needs their own signal history for their self-relative baseline.
  private async recordSignal(feedbackReportId: string, rawFeedback: string, snapshot: SignalSnapshot) {
    const extracted = await this.extractWithRetry({ rawFeedback, channel: snapshot.channel });

    try {
      return await this.prisma.signalRecord.create({
        data: {
          feedbackReportId,
          // Snapshotted dims (§5 rule 1) — frozen copies, not live joins.
          ...snapshot,
          // Extracted — null preserved exactly as returned, never coerced
          // to 0/false.
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
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`FeedbackReport ${feedbackReportId} already has its signal`);
      }
      throw error;
    }
  }

  private async extractWithRetry(input: { rawFeedback: string; channel: Channel }): Promise<ExtractedSignal> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.extractionProvider.extract(input);
      } catch (error) {
        if (attempt >= EXTRACTION_ATTEMPTS) {
          // Providers other than Gemini (tests, future ones) may throw
          // anything; callers always see the clean domain exception.
          throw error instanceof HttpException ? error : new SignalExtractionFailedException();
        }
        this.logger.warn(`Extraction attempt ${attempt} failed; retrying`);
      }
    }
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
