import { ConfigService } from "@nestjs/config";
import { selectLlm } from "./llm-selection";

const config = (values: Record<string, string | undefined>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

describe("selectLlm", () => {
  it("defaults to gemini (local dev needs no Anthropic key)", () => {
    expect(selectLlm(config({}), "DRAFTING_LLM")).toBe("gemini");
  });

  it("reads each step independently, case- and whitespace-tolerant", () => {
    const c = config({ DRAFTING_LLM: " Claude ", EXTRACTION_LLM: "gemini" });
    expect(selectLlm(c, "DRAFTING_LLM")).toBe("claude");
    expect(selectLlm(c, "EXTRACTION_LLM")).toBe("gemini");
  });

  it("fails at boot on an unknown provider instead of silently picking one", () => {
    expect(() => selectLlm(config({ EXTRACTION_LLM: "openai" }), "EXTRACTION_LLM")).toThrow(/claude.*gemini/);
  });
});
