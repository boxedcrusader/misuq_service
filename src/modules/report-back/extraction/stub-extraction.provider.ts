import { Injectable } from "@nestjs/common";
import { Channel, Sentiment } from "@prisma/client";
import { ExtractedSignal, ExtractionProvider } from "./extraction.provider";

// TEST-ONLY since GeminiExtractionProvider replaced it in report-back.module.ts
// (2026-11-03) — binding it in the app would write fabricated, permanent
// SignalRecords for every real report.
//
// Deterministic, no randomness, no network call, and deliberately IGNORES
// rawFeedback/channel content — this is the seam a real LLM provider slots
// into later by being bound to EXTRACTION_PROVIDER in report-back.module.ts
// instead of this class. ReportBackService only ever depends on the
// ExtractionProvider interface.
//
// The fixed output is the contract itself: views/replyCount/sentiment are
// populated (a real extractor found something), while signupCount and every
// distribution field are null (not reported/unknown) rather than 0/false.
// Proving that these nulls survive all the way into SignalRecord is the
// point of this module's null-preservation test.
@Injectable()
export class StubExtractionProvider implements ExtractionProvider {
  async extract(_input: { rawFeedback: string; channel: Channel }): Promise<ExtractedSignal> {
    return {
      views: 4000,
      replyCount: 2,
      signupCount: null,
      likeCount: null,
      repostCount: null,
      quoteCount: null,
      bookmarkCount: null,
      shareCount: null,
      newFollowerCount: null,
      sentiment: Sentiment.POSITIVE,
      hasMedia: null,
      hasExternalLink: null,
      postFormat: null,
      followerCountSnapshot: null,
      isPremiumAccount: null,
      postedAt: null,
    };
  }
}
