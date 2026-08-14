import { ConfigService } from "@nestjs/config";
import { Channel, Tone } from "@prisma/client";
import { DraftGenerationFailedException } from "./draft-generation-failed.exception";

// @google/genai's GoogleGenAI is mocked entirely -- this suite proves
// GeminiDraftingProvider's FAILURE handling and response parsing, never
// makes a real network call (no cost, no flakiness, no key needed in CI).
// mockGenerateContent is declared with `var` (not const/let) because
// jest.mock's factory is hoisted above imports -- a const/let here would be
// a temporal-dead-zone reference error at hoist time.
// eslint-disable-next-line no-var
var mockGenerateContent: jest.Mock;

jest.mock("@google/genai", () => {
  mockGenerateContent = jest.fn();
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: { generateContent: mockGenerateContent },
    })),
    Type: { OBJECT: "OBJECT", STRING: "STRING" },
  };
});

import { GeminiDraftingProvider } from "./gemini-drafting.provider";

function fakeConfigService(): ConfigService {
  return { getOrThrow: jest.fn().mockReturnValue("test-fake-api-key") } as unknown as ConfigService;
}

describe("GeminiDraftingProvider", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  describe("failure handling (mocked API, never real)", () => {
    it("wraps a thrown API error (network/4xx/5xx/auth) in the clean domain exception", async () => {
      mockGenerateContent.mockRejectedValue(new Error("ECONNREFUSED: could not reach Gemini"));
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await expect(
        provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL }),
      ).rejects.toBeInstanceOf(DraftGenerationFailedException);
    });

    it("does not leak the underlying error message to the thrown exception", async () => {
      mockGenerateContent.mockRejectedValue(new Error("secret upstream detail, api key XYZ"));
      const provider = new GeminiDraftingProvider(fakeConfigService());

      try {
        await provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL });
        fail("expected generateDraft to reject");
      } catch (err) {
        expect(err).toBeInstanceOf(DraftGenerationFailedException);
        expect((err as Error).message).not.toContain("secret upstream detail");
        expect((err as Error).message).not.toContain("XYZ");
      }
    });

    it("fails cleanly on an empty response (no usable text)", async () => {
      mockGenerateContent.mockResolvedValue({ text: "" });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await expect(
        provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL }),
      ).rejects.toBeInstanceOf(DraftGenerationFailedException);
    });

    it("fails cleanly on malformed (non-JSON) response text", async () => {
      mockGenerateContent.mockResolvedValue({ text: "not json at all {{{" });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await expect(
        provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL }),
      ).rejects.toBeInstanceOf(DraftGenerationFailedException);
    });

    it("fails cleanly when the response JSON is missing a usable body", async () => {
      mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ tone: "confident" }) });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await expect(
        provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL }),
      ).rejects.toBeInstanceOf(DraftGenerationFailedException);
    });

    it("fails cleanly when body is present but empty", async () => {
      mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ body: "   ", tone: "confident" }) });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await expect(
        provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL }),
      ).rejects.toBeInstanceOf(DraftGenerationFailedException);
    });
  });

  describe("well-formed response parsing + tone mapping", () => {
    it("returns the trimmed body and maps a confident free-text tone to its enum", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ body: "  Hey folks, shipped dark mode today!  ", tone: "excited and proud" }),
      });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      const result = await provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL });

      expect(result.body).toBe("Hey folks, shipped dark mode today!");
      expect(result.tone).toBe(Tone.CELEBRATORY);
    });

    it("falls back tone to OTHER when Gemini's free text doesn't confidently match an enum", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ body: "Hey folks, shipped dark mode today!", tone: "upbeat and snappy" }),
      });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      const result = await provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL });

      expect(result.tone).toBe(Tone.OTHER);
    });
  });
});
