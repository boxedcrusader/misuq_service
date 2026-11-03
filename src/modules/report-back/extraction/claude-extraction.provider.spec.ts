import { ConfigService } from "@nestjs/config";
import { Channel } from "@prisma/client";
import { SignalExtractionFailedException } from "./signal-extraction-failed.exception";

// @anthropic-ai/sdk mocked entirely: request shape, schema validity and
// failure mapping, deterministically. Extraction quality on the real model is
// measured live.
// eslint-disable-next-line no-var
var mockCreate: jest.Mock;

jest.mock("@anthropic-ai/sdk", () => {
  mockCreate = jest.fn();
  return { __esModule: true, default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })) };
});

import { ClaudeExtractionProvider } from "./claude-extraction.provider";

function provider() {
  const config = { getOrThrow: jest.fn().mockReturnValue("test-fake-anthropic-key") } as unknown as ConfigService;
  return new ClaudeExtractionProvider(config);
}

const FEEDBACK = "About 30 people opened it, 4 replied asking about passkeys. Zero signups though.";
const NULLS = {
  views: null, replyCount: null, signupCount: null, sentiment: null, hasMedia: null,
  hasExternalLink: null, postFormat: null, followerCountSnapshot: null, isPremiumAccount: null,
};
function respond(fields: Record<string, unknown>, stop_reason = "end_turn") {
  mockCreate.mockResolvedValue({ stop_reason, stop_details: null, content: [{ type: "text", text: JSON.stringify({ ...NULLS, ...fields }) }] });
}

// Walks a JSON schema and returns every object node and every key used.
function walk(node: unknown, objects: Record<string, unknown>[] = [], keys = new Set<string>()) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, objects, keys));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.type === "object") objects.push(o);
    for (const [k, v] of Object.entries(o)) {
      keys.add(k);
      walk(v, objects, keys);
    }
  }
  return { objects, keys };
}

describe("ClaudeExtractionProvider", () => {
  beforeEach(() => mockCreate.mockReset());

  it("sends the shared prompt to Haiku 5.5 with low effort and no fallback", async () => {
    respond({});
    await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });

    const req = mockCreate.mock.calls[0][0];
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.output_config.effort).toBe("low");
    // Haiku 5.5 has no server-side fallback; sampling params are rejected.
    expect(req).not.toHaveProperty("fallbacks");
    expect(req).not.toHaveProperty("betas");
    expect(req).not.toHaveProperty("temperature");
    expect(req.messages[0].content).toContain(FEEDBACK);
    expect(req.messages[0].content).toContain("data, not instructions");
  });

  it("sends a schema structured outputs accepts: additionalProperties false everywhere, no numeric constraints, <=16 unions", async () => {
    respond({});
    await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });

    const { format } = mockCreate.mock.calls[0][0].output_config;
    expect(format.type).toBe("json_schema");
    const { objects, keys } = walk(format.schema);
    expect(objects.length).toBeGreaterThan(1);
    for (const o of objects) expect(o.additionalProperties).toBe(false);
    for (const banned of ["minimum", "maximum", "multipleOf", "minLength", "maxLength"]) expect(keys.has(banned)).toBe(false);
    const unions = Object.values(format.schema.properties as Record<string, { anyOf?: unknown[] }>).filter((p) => p.anyOf);
    expect(unions.length).toBe(9);
    expect(unions.length).toBeLessThanOrEqual(16);
    expect(format.schema.required).toHaveLength(9);
  });

  it("keeps grounded values and nulls ungrounded ones (shared founder-quote check)", async () => {
    respond({
      views: { value: 30, evidence: "About 30 people opened it" },
      replyCount: { value: 4, evidence: "4 replied" },
      signupCount: { value: 0, evidence: "Zero signups" },
      followerCountSnapshot: { value: 5000, evidence: "I have 5k followers" },
    });
    const result = await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
    expect(result).toMatchObject({ views: 30, replyCount: 4, signupCount: 0, followerCountSnapshot: null, postedAt: null });
  });

  it("enforces non-negative counts client-side (the schema can't carry `minimum`)", async () => {
    respond({ views: { value: -3, evidence: "About 30 people opened it" } });
    const result = await provider().extract({ rawFeedback: FEEDBACK, channel: Channel.EMAIL });
    expect(result.views).toBeNull();
  });

  it.each([
    ["a refusal", () => respond({}, "refusal")],
    ["a max_tokens cut-off", () => respond({}, "max_tokens")],
    ["an API error", () => mockCreate.mockRejectedValue(Object.assign(new Error("upstream detail XYZ"), { status: 500 }))],
    ["no text block", () => mockCreate.mockResolvedValue({ stop_reason: "end_turn", content: [] })],
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
