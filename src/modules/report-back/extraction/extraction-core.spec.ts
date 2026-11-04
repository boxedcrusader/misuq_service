import { Logger } from "@nestjs/common";
import { evidenceSupportsZero, parseExtractedSignal } from "./extraction-core";

// The zero guard: a count of 0 says "confirmed, nothing happened", so it is
// only kept when the quoted words say that. Found live 2026-11-03 on Claude
// Haiku 5.5: "Got some replies" came back as replyCount 0 with a genuine
// quote, which isGrounded alone can't catch.
const logger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;

function parse(raw: string, fields: Record<string, unknown>) {
  return parseExtractedSignal(JSON.stringify(fields), raw, logger);
}

describe("evidenceSupportsZero", () => {
  it.each([
    "no replies",
    "Zero signups though",
    "crickets honestly",
    "nobody replied",
    "no one signed up",
    "none of them replied",
    "didn't get a single reply",
    "didn’t get any replies", // curly apostrophe, as phones type it
    "haven't had a signup",
    "not one reply",
    "not a single signup",
    "got 0 signups",
    "silence",
  ])("accepts %p", (evidence) => {
    expect(evidenceSupportsZero(evidence)).toBe(true);
  });

  it.each([
    "Got some replies",
    "a few people replied",
    "it flopped",
    "not a lot of replies",
    "10 replies",
    "2,000 views",
    "I know a couple signed up",
    "",
  ])("rejects %p", (evidence) => {
    expect(evidenceSupportsZero(evidence)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(evidenceSupportsZero(0)).toBe(false);
    expect(evidenceSupportsZero(null)).toBe(false);
  });
});

describe("parseExtractedSignal: zero counts", () => {
  it("stores a 0 the founder's words don't support as null (not reported)", () => {
    const raw = "Got some replies, mostly positive, a couple people were confused about pricing";
    const result = parse(raw, {
      replyCount: { value: 0, evidence: "Got some replies" },
      sentiment: { value: "MIXED", evidence: "mostly positive, a couple people were confused" },
    });
    expect(result.replyCount).toBeNull();
    expect(result.sentiment).toBe("MIXED");
  });

  it("keeps a stated zero as 0, never null", () => {
    const raw = "About 30 people opened it, 4 replied. Zero signups though.";
    const result = parse(raw, {
      views: { value: 30, evidence: "About 30 people opened it" },
      signupCount: { value: 0, evidence: "Zero signups" },
    });
    expect(result.views).toBe(30);
    expect(result.signupCount).toBe(0);
  });

  it("checks the zero rule only on counts", () => {
    const raw = "No link in it, just a screenshot.";
    const result = parse(raw, {
      hasExternalLink: { value: false, evidence: "No link in it" },
      hasMedia: { value: true, evidence: "just a screenshot" },
    });
    expect(result.hasExternalLink).toBe(false);
    expect(result.hasMedia).toBe(true);
  });

  it("reads X's engagement counts, each grounded, and rejects ones that aren't", () => {
    const raw = "1.4k views, 6 replies, 3 quote tweets, 12 bookmarks and 4 new followers. A few reposts.";
    const result = parse(raw, {
      views: { value: 1400, evidence: "1.4k views" },
      replyCount: { value: 6, evidence: "6 replies" },
      quoteCount: { value: 3, evidence: "3 quote tweets" },
      bookmarkCount: { value: 12, evidence: "12 bookmarks" },
      newFollowerCount: { value: 4, evidence: "4 new followers" },
      // Vague ("a few") must not become a number; and a quote that isn't in
      // the message is never trusted.
      repostCount: { value: 0, evidence: "A few reposts" },
      shareCount: { value: 9, evidence: "9 DMs" },
    });
    expect(result).toMatchObject({ views: 1400, replyCount: 6, quoteCount: 3, bookmarkCount: 12, newFollowerCount: 4 });
    expect(result.repostCount).toBeNull();
    expect(result.shareCount).toBeNull();
    expect(result.likeCount).toBeNull();
  });
});
