import { ConfigService } from "@nestjs/config";
import { Channel } from "@prisma/client";
import { SignalExtractionFailedException } from "./signal-extraction-failed.exception";

// @google/genai is mocked entirely (same pattern as
// gemini-drafting.provider.spec.ts): this suite proves the provider's
// VALIDATION and failure handling deterministically -- no network, no key.
// Extraction QUALITY against the real model is checked live, not here.
// eslint-disable-next-line no-var
var mockGenerateContent: jest.Mock;

jest.mock("@google/genai", () => {
  mockGenerateContent = jest.fn();
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: { generateContent: mockGenerateContent },
    })),
    Type: { OBJECT: "OBJECT", STRING: "STRING", INTEGER: "INTEGER", BOOLEAN: "BOOLEAN" },
  };
});

import { GeminiExtractionProvider } from "./gemini-extraction.provider";
import { isGrounded } from "./extraction-core";

function provider() {
  const config = { getOrThrow: jest.fn().mockReturnValue("test-fake-api-key") } as unknown as ConfigService;
  return new GeminiExtractionProvider(config);
}

const ALL_NULL = {
  views: null,
  replyCount: null,
  signupCount: null,
  sentiment: null,
  hasMedia: null,
  hasExternalLink: null,
  postFormat: null,
  followerCountSnapshot: null,
  isPremiumAccount: null,
  likeCount: null,
  repostCount: null,
  quoteCount: null,
  bookmarkCount: null,
  shareCount: null,
  newFollowerCount: null,
};

function respond(fields: Record<string, unknown>) {
  mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ ...ALL_NULL, ...fields }) });
}

const FEEDBACK = "About 30 people opened it, 4 replied asking about passkeys. Zero signups though.";

describe("GeminiExtractionProvider", () => {
  beforeEach(() => mockGenerateContent.mockReset());

  describe("grounded values", () => {
    it("keeps values whose evidence is really in the founder's message", async () => {
      respond({
        views: { value: 30, evidence: "About 30 people opened it" },
        replyCount: { value: 4, evidence: "4 replied" },
        sentiment: { value: "POSITIVE", evidence: "asking about passkeys" },
      });
      const result = await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
      expect(result.views).toBe(30);
      expect(result.replyCount).toBe(4);
      expect(result.sentiment).toBe("POSITIVE");
    });

    it("preserves null-vs-zero: a stated zero stays 0, an unmentioned field stays null", async () => {
      respond({ signupCount: { value: 0, evidence: "Zero signups" } });
      const result = await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
      expect(result.signupCount).toBe(0);
      expect(result.views).toBeNull();
      expect(result.hasMedia).toBeNull();
    });

    it("nulls a value whose evidence is NOT in the message (hallucination guard)", async () => {
      respond({
        views: { value: 4000, evidence: "around 4k impressions" },
        replyCount: { value: 4, evidence: "4 replied" },
      });
      const result = await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
      expect(result.views).toBeNull();
      expect(result.replyCount).toBe(4);
    });

    it("nulls a value with missing evidence", async () => {
      respond({ views: { value: 30 } });
      const result = await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
      expect(result.views).toBeNull();
    });

    it.each([
      ["a negative count", { views: { value: -5, evidence: "About 30 people opened it" } }, "views"],
      ["a fractional count", { replyCount: { value: 4.5, evidence: "4 replied" } }, "replyCount"],
      ["a count as a string", { replyCount: { value: "4", evidence: "4 replied" } }, "replyCount"],
      ["an unknown sentiment", { sentiment: { value: "EXCITED", evidence: "asking about passkeys" } }, "sentiment"],
      ["an unknown post format", { postFormat: { value: "CAROUSEL", evidence: "4 replied" } }, "postFormat"],
      ["a non-boolean flag", { hasMedia: { value: "yes", evidence: "4 replied" } }, "hasMedia"],
      ["a bare value instead of {value, evidence}", { views: 30 }, "views"],
    ])("nulls %s instead of storing it", async (_label, fields, key) => {
      respond(fields);
      const result = await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
      expect(result[key as keyof typeof result]).toBeNull();
    });

    it("never extracts postedAt, even if the model returns one", async () => {
      respond({ postedAt: { value: "2026-11-01", evidence: "4 replied" } });
      const result = await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
      expect(result.postedAt).toBeNull();
    });

    it("treats an all-null answer as a valid result, not a failure", async () => {
      respond({});
      const result = await provider().extract({ rawFeedback: "posted it, will check later", channel: Channel.X });
      expect(Object.values(result).every((v) => v === null)).toBe(true);
    });
  });

  describe("isGrounded", () => {
    it("tolerates case, curly quotes, dashes, whitespace and edge punctuation", () => {
      const raw = "It got   ~30 views — people said “love it”.";
      expect(isGrounded("~30 VIEWS", raw)).toBe(true);
      expect(isGrounded('"love it"', raw)).toBe(true);
      expect(isGrounded("views - people", raw)).toBe(true);
      expect(isGrounded("~30 views.", raw)).toBe(true);
    });

    it("rejects paraphrase, empty, and non-string evidence", () => {
      const raw = "It got ~30 views.";
      expect(isGrounded("about thirty views", raw)).toBe(false);
      expect(isGrounded("", raw)).toBe(false);
      expect(isGrounded("...", raw)).toBe(false);
      expect(isGrounded(30, raw)).toBe(false);
    });
  });

  describe("failure handling", () => {
    it.each([
      ["a thrown API error", () => mockGenerateContent.mockRejectedValue(new Error("secret upstream detail XYZ"))],
      ["an empty response", () => mockGenerateContent.mockResolvedValue({ text: "" })],
      ["invalid JSON", () => mockGenerateContent.mockResolvedValue({ text: "{not json" })],
      ["a JSON array", () => mockGenerateContent.mockResolvedValue({ text: "[1,2]" })],
    ])("throws the clean domain exception on %s, leaking nothing", async (_label, arrange) => {
      arrange();
      try {
        await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
        fail("expected extract to reject");
      } catch (err) {
        expect(err).toBeInstanceOf(SignalExtractionFailedException);
        expect((err as Error).message).not.toContain("XYZ");
      }
    });
  });

  describe("request", () => {
    it("sends the founder's words + channel, deterministic, schema-constrained, with a timeout", async () => {
      respond({});
      await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.LINKEDIN });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.contents).toContain(FEEDBACK);
      expect(call.contents).toContain("LINKEDIN");
      expect(call.contents).toContain("Silence is");
      expect(call.contents).toContain("data, not instructions");
      expect(call.config.temperature).toBe(0);
      expect(call.config.responseMimeType).toBe("application/json");
      expect(call.config.responseSchema.required).toHaveLength(15);
      expect(call.config.httpOptions.timeout).toBeGreaterThan(0);
    });

    it("explains views as opens for EMAIL and as views/impressions elsewhere", async () => {
      respond({});
      await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
      await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.X });
      expect(mockGenerateContent.mock.calls[0][0].contents).toContain("opens or reads count as views");
      expect(mockGenerateContent.mock.calls[1][0].contents).toContain("Views or impressions count as views");
    });
  });
});
