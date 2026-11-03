import { ConfigService } from "@nestjs/config";
import { Channel, Tone } from "@prisma/client";
import { DraftGenerationFailedException } from "./draft-generation-failed.exception";

// @anthropic-ai/sdk is mocked entirely (same approach as the Gemini specs):
// this proves the request shape, response handling and failure mapping
// deterministically — no network, no key, no spend. Draft QUALITY on the real
// model is measured live, not here.
// eslint-disable-next-line no-var
var mockBetaCreate: jest.Mock;
// eslint-disable-next-line no-var
var mockCtor: jest.Mock;

jest.mock("@anthropic-ai/sdk", () => {
  mockBetaCreate = jest.fn();
  mockCtor = jest.fn().mockImplementation(() => ({ beta: { messages: { create: mockBetaCreate } } }));
  return { __esModule: true, default: mockCtor };
});

import { ClaudeDraftingProvider } from "./claude-drafting.provider";

function provider() {
  const config = { getOrThrow: jest.fn().mockReturnValue("test-fake-anthropic-key") } as unknown as ConfigService;
  return new ClaudeDraftingProvider(config);
}

function message(body: string, tone = "CASUAL", stop_reason = "end_turn", extra: Record<string, unknown> = {}) {
  return {
    stop_reason,
    stop_details: null,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: JSON.stringify({ body, tone }) },
    ],
    ...extra,
  };
}

const INPUT = { rawCapture: "Shipped dark mode.", channel: Channel.EMAIL };

describe("ClaudeDraftingProvider", () => {
  beforeEach(() => {
    mockBetaCreate.mockReset();
    mockCtor.mockClear();
  });

  it("builds the client from ANTHROPIC_API_KEY with a timeout and bounded retries", () => {
    provider();
    expect(mockCtor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-fake-anthropic-key", timeout: expect.any(Number), maxRetries: 2 }),
    );
  });

  it("sends the shared prompt to Sonnet 5.5 with structured output, low effort, and the default refusal fallback", async () => {
    mockBetaCreate.mockResolvedValue(message("Hey all — dark mode is in."));
    await provider().generateDraft(INPUT);

    const req = mockBetaCreate.mock.calls[0][0];
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.fallbacks).toBe("default");
    expect(req.output_config.effort).toBe("low");
    expect(req.output_config.format.type).toBe("json_schema");
    const schema = req.output_config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["body", "tone"]);
    expect(schema.properties.tone.enum).not.toContain("OTHER");
    expect(schema.properties.tone.enum).toHaveLength(Object.values(Tone).length - 1);
    // Sonnet 5.5 rejects sampling params; thinking is left to its adaptive default.
    expect(req).not.toHaveProperty("temperature");
    expect(req).not.toHaveProperty("thinking");
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].content).toContain("FACTS — the most important rule");
    expect(req.messages[0].content).toContain("Shipped dark mode.");
  });

  it("reads the JSON from the text block, skipping thinking blocks", async () => {
    mockBetaCreate.mockResolvedValue(message("  Hey all — dark mode is in.  ", "CELEBRATORY"));
    await expect(provider().generateDraft(INPUT)).resolves.toEqual({
      body: "Hey all — dark mode is in.",
      tone: Tone.CELEBRATORY,
    });
  });

  it("shares the invented-number backstop: one corrective retry, then the clean redraft", async () => {
    mockBetaCreate
      .mockResolvedValueOnce(message("Spent five days on it, three people asked."))
      .mockResolvedValueOnce(message("Hey all — dark mode is in."));
    const result = await provider().generateDraft(INPUT);

    expect(mockBetaCreate).toHaveBeenCalledTimes(2);
    expect(mockBetaCreate.mock.calls[1][0].messages[0].content).toContain("YOUR PREVIOUS DRAFT BROKE THE FACTS RULE");
    expect(result.body).toBe("Hey all — dark mode is in.");
  });

  it.each([
    ["a refusal", () => mockBetaCreate.mockResolvedValue(message("", "CASUAL", "refusal", { stop_details: { category: "general_harms", explanation: "secret detail XYZ" } }))],
    ["a max_tokens cut-off", () => mockBetaCreate.mockResolvedValue(message("Hey all", "CASUAL", "max_tokens"))],
    ["an API error", () => mockBetaCreate.mockRejectedValue(Object.assign(new Error("upstream detail XYZ"), { status: 529 }))],
    ["a non-JSON text block", () => mockBetaCreate.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] })],
    ["no text block at all", () => mockBetaCreate.mockResolvedValue({ stop_reason: "end_turn", content: [] })],
  ])("fails cleanly on %s, leaking nothing", async (_label, arrange) => {
    arrange();
    try {
      await provider().generateDraft(INPUT);
      fail("expected generateDraft to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(DraftGenerationFailedException);
      expect((err as Error).message).not.toContain("XYZ");
    }
  });
});
