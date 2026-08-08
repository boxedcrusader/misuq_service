import { Channel, PostFormat, Sentiment } from "@prisma/client";

// The exact output shape a real (LLM-backed) extractor must satisfy. null
// means "not reported/unknown"; it must never be coerced to 0/false — that
// would fabricate a "nothing happened" fact the founder never said (README
// §5 rule 4 neighbor: null-vs-zero).
export interface ExtractedSignal {
  views: number | null;
  replyCount: number | null;
  signupCount: number | null;
  sentiment: Sentiment | null;
  hasMedia: boolean | null;
  hasExternalLink: boolean | null;
  postFormat: PostFormat | null;
  followerCountSnapshot: number | null;
  isPremiumAccount: boolean | null;
  postedAt: Date | null;
}

export interface ExtractionProvider {
  extract(input: {
    rawFeedback: string;
    channel: Channel;
  }): Promise<ExtractedSignal>;
}

export const EXTRACTION_PROVIDER = "EXTRACTION_PROVIDER";
