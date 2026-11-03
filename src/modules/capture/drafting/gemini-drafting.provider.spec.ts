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

  describe("well-formed response parsing + tone (the post's angle)", () => {
    it("returns the trimmed body and the schema-constrained angle", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ body: "  Hey folks, shipped dark mode today!  ", tone: "CELEBRATORY" }),
      });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      const result = await provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL });

      expect(result.body).toBe("Hey folks, shipped dark mode today!");
      expect(result.tone).toBe(Tone.CELEBRATORY);
    });

    it("falls back to OTHER (uncategorized) if Gemini goes off-schema with free text", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ body: "Hey folks, shipped dark mode today!", tone: "understated and practical" }),
      });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      const result = await provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL });

      expect(result.tone).toBe(Tone.OTHER);
    });

    it("constrains tone to the real angles via the schema, and defines each one in the prompt", async () => {
      mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ body: "Hey folks.", tone: "REFLECTIVE" }) });
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await provider.generateDraft({ rawCapture: "Shipped dark mode.", channel: Channel.EMAIL });

      const call = mockGenerateContent.mock.calls[0][0];
      const schemaEnum: string[] = call.config.responseSchema.properties.tone.enum;
      expect(schemaEnum).not.toContain("OTHER");
      expect(schemaEnum).toHaveLength(Object.values(Tone).length - 1);
      for (const angle of schemaEnum) expect(call.contents).toContain(`- ${angle}: `);
      // The old failure mode: asking about VOICE, which the prompt already fixes.
      expect(call.contents).toContain("not how it sounds");
      expect(call.contents).not.toContain("label for the voice you wrote in");
    });
  });

  // Proves buildPrompt's voice/structure split (the M1-critical wiring):
  // a founder WITH a styleSample gets it injected as a register reference,
  // a founder with none still gets a clean, no-crash fallback prompt.
  // buildPrompt is private, so these inspect the `contents` string actually
  // sent to the (mocked) Gemini call rather than calling it directly.
  describe("voice wiring in buildPrompt", () => {
    beforeEach(() => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ body: "Hey folks, shipped dark mode today!", tone: "CONFIDENT" }),
      });
    });

    it("injects the founder's styleSample as a VOICE REFERENCE block when present", async () => {
      const provider = new GeminiDraftingProvider(fakeConfigService());
      const styleSample = "I ship fast and talk plainly about it, no fluff, just what happened.";

      await provider.generateDraft({
        rawCapture: "Shipped dark mode.",
        channel: Channel.EMAIL,
        voice: { styleSample },
      });

      const prompt = mockGenerateContent.mock.calls[0][0].contents as string;
      expect(prompt).toContain("VOICE REFERENCE");
      expect(prompt).toContain(styleSample);
      expect(prompt).not.toContain("No voice samples for this founder yet");
    });

    it("falls back to a natural, AI-tell-free voice instruction when no styleSample exists", async () => {
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await provider.generateDraft({
        rawCapture: "Shipped dark mode.",
        channel: Channel.EMAIL,
        voice: null,
      });

      const prompt = mockGenerateContent.mock.calls[0][0].contents as string;
      expect(prompt).toContain("No voice samples for this founder yet");
      expect(prompt).not.toContain("VOICE REFERENCE");
    });

    it("treats a VoiceProfile with an empty/whitespace styleSample the same as no voice at all", async () => {
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await provider.generateDraft({
        rawCapture: "Shipped dark mode.",
        channel: Channel.EMAIL,
        voice: { styleSample: "   " },
      });

      const prompt = mockGenerateContent.mock.calls[0][0].contents as string;
      expect(prompt).toContain("No voice samples for this founder yet");
      expect(prompt).not.toContain("VOICE REFERENCE");
    });

    it("keeps structure rules present regardless of voice branch (voice and structure stay separate)", async () => {
      const provider = new GeminiDraftingProvider(fakeConfigService());

      await provider.generateDraft({
        rawCapture: "Shipped dark mode.",
        channel: Channel.EMAIL,
        voice: { styleSample: "Some real founder voice sample text here." },
      });

      const prompt = mockGenerateContent.mock.calls[0][0].contents as string;
      expect(prompt).toContain("STRUCTURE — this comes from you, NOT from the voice samples");
      expect(prompt).toContain("Open with a hook that earns the first line");
    });
  });
  // The FACTS rule + invented-number backstop (2026-11-03). Live baseline
  // before the fix: 7/10 drafts contained made-up numbers, 4/10 signed off
  // as an invented "Alex".
  describe("never inventing facts", () => {
    const draft = (body: string) => ({ text: JSON.stringify({ body, tone: "CASUAL" }) });

    it("puts a FACTS rule first that overrides structure, and stops voice samples leaking facts", async () => {
      mockGenerateContent.mockResolvedValue(draft("Hey all, shipped dark mode."));
      await new GeminiDraftingProvider(fakeConfigService()).generateDraft({
        rawCapture: "Shipped dark mode.",
        channel: Channel.EMAIL,
        voice: { styleSample: "We hit 10k users last month and I wrote about it." },
      });
      const prompt = mockGenerateContent.mock.calls[0][0].contents as string;
      expect(prompt).toContain("FACTS — the most important rule; it overrides every rule below");
      expect(prompt.indexOf("FACTS —")).toBeLessThan(prompt.indexOf("STRUCTURE —"));
      expect(prompt).toContain("never");
      expect(prompt).toContain("NEVER their");
      // The old padding pressure is gone.
      expect(prompt).not.toContain("100-200 words");
      expect(prompt).toContain("Never pad");
    });

    it("signs off as the founder when their name is known", async () => {
      mockGenerateContent.mockResolvedValue(draft("Hey all, shipped dark mode."));
      await new GeminiDraftingProvider(fakeConfigService()).generateDraft({
        rawCapture: "Shipped dark mode.",
        channel: Channel.EMAIL,
        founderName: 'Ada "the dev"\nLovelace',
      });
      const prompt = mockGenerateContent.mock.calls[0][0].contents as string;
      // Quotes/newlines stripped so the name can't break out of its quotes.
      expect(prompt).toContain('sign-off as "Ada  the dev  Lovelace"');
    });

    it("forbids inventing a name when none is known", async () => {
      mockGenerateContent.mockResolvedValue(draft("Hey all, shipped dark mode."));
      await new GeminiDraftingProvider(fakeConfigService()).generateDraft({
        rawCapture: "Shipped dark mode.",
        channel: Channel.EMAIL,
        founderName: null,
      });
      const prompt = mockGenerateContent.mock.calls[0][0].contents as string;
      expect(prompt).toContain("no sign-off line at all");
      expect(prompt).toContain("must never invent one");
    });

    it("accepts a draft whose numbers all come from the founder's words — one call", async () => {
      mockGenerateContent.mockResolvedValue(draft("Hey all — 300 signups in 24 hours after finishing #4."));
      const result = await new GeminiDraftingProvider(fakeConfigService()).generateDraft({
        rawCapture: "Launched on Product Hunt, finished #4 of the day. 300 signups in 24 hours.",
        channel: Channel.EMAIL,
      });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(result.body).toContain("300 signups");
    });

    it("grounds numbers from the title too", async () => {
      mockGenerateContent.mockResolvedValue(draft("Hey all — v2 is out."));
      await new GeminiDraftingProvider(fakeConfigService()).generateDraft({
        rawCapture: "Shipped it.",
        title: "v2 launch",
        channel: Channel.EMAIL,
      });
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("retries once with a correction naming the invented numbers, and returns the clean redraft", async () => {
      mockGenerateContent
        .mockResolvedValueOnce(draft("Hey all — spent five days on a leak, three people hit it."))
        .mockResolvedValueOnce(draft("Hey all — quiet week, mostly bugs and support."));
      const result = await new GeminiDraftingProvider(fakeConfigService()).generateDraft({
        rawCapture: "Quiet week. Mostly fixed bugs and answered support emails.",
        channel: Channel.EMAIL,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      const retryPrompt = mockGenerateContent.mock.calls[1][0].contents as string;
      expect(retryPrompt).toContain("YOUR PREVIOUS DRAFT BROKE THE FACTS RULE");
      expect(retryPrompt).toContain('"five"');
      expect(retryPrompt).toContain('"three"');
      expect(result.body).toBe("Hey all — quiet week, mostly bugs and support.");
    });

    it("fails cleanly (no draft) if the redraft still invents numbers", async () => {
      mockGenerateContent
        .mockResolvedValueOnce(draft("Spent five days on it."))
        .mockResolvedValueOnce(draft("Spent six days on it."));
      await expect(
        new GeminiDraftingProvider(fakeConfigService()).generateDraft({
          rawCapture: "Quiet week. Mostly fixed bugs.",
          channel: Channel.EMAIL,
        }),
      ).rejects.toBeInstanceOf(DraftGenerationFailedException);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });
});
