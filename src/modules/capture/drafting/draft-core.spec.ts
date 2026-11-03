import { Channel } from "@prisma/client";
import { buildDraftPrompt } from "./draft-core";

describe("buildDraftPrompt", () => {
  // Measured live on Claude Sonnet 5.5 (2026-11-03): numbers stayed clean,
  // but drafts added feelings the founder never wrote ("it still stings") and
  // claims about the readers. The FACTS block forbids both, for every model.
  it("forbids invented feelings and claims about readers in the FACTS block", () => {
    const prompt = buildDraftPrompt({ rawCapture: "We lost our biggest customer today.", channel: Channel.EMAIL });
    const facts = prompt.slice(prompt.indexOf("FACTS"), prompt.indexOf("CRAFT"));
    expect(facts).toContain("add no emotion the founder didn't express");
    expect(facts).toContain("assume nothing about the readers");
  });
});
