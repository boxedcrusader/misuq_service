import { Logger } from "@nestjs/common";
import { Channel, Tone } from "@prisma/client";
import { DraftGenerationFailedException } from "./draft-generation-failed.exception";
import { buildDraftPrompt, generateGroundedDraft, X_MAX_CHARS } from "./draft-core";

const logger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;

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

describe("buildDraftPrompt: formats (2026-11-04)", () => {
  const base = { rawCapture: "Added CSV export. Two beta users asked for it.", founderName: "Ada" };

  it("X keeps one idea per post and invites replies only where natural, never bait", () => {
    const x = buildDraftPrompt({ ...base, channel: Channel.X });
    expect(x).toContain("ONE idea per post");
    expect(x).toContain("Where it fits naturally");
    expect(x).toContain("engagement bait");
    expect(buildDraftPrompt({ ...base, channel: Channel.LINKEDIN })).not.toContain("ONE idea per post");
  });

  it("email keeps its greeting and the founder's sign-off", () => {
    const prompt = buildDraftPrompt({ ...base, channel: Channel.EMAIL });
    expect(prompt).toContain("FORMAT: a short email");
    expect(prompt).toContain('SIGN-OFF: end with a sign-off as "Ada"');
  });

  it("an X post has a hard 280-character limit, no greeting and no sign-off even when the name is known", () => {
    const prompt = buildDraftPrompt({ ...base, channel: Channel.X });
    expect(prompt).toContain(`at most ${X_MAX_CHARS} characters`);
    expect(prompt).toContain("No greeting");
    expect(prompt).toContain("SIGN-OFF: none");
    expect(prompt).not.toContain('sign-off as "Ada"');
    expect(prompt).not.toContain("as an email");
  });

  it("a LinkedIn post gets short paragraphs and a first line that survives 'see more'", () => {
    const prompt = buildDraftPrompt({ ...base, channel: Channel.LINKEDIN });
    expect(prompt).toContain("LinkedIn hides the rest");
    expect(prompt).toContain("SIGN-OFF: none");
  });
});

describe("generateGroundedDraft: X length", () => {
  const input = { rawCapture: "Added CSV export.", channel: Channel.X };
  const draft = (body: string) => ({ body, tone: Tone.CASUAL });
  const long = "Added CSV export. ".repeat(20);

  it("retries an over-long X post once, naming the length", async () => {
    const attempt = jest.fn().mockResolvedValueOnce(draft(long)).mockResolvedValueOnce(draft("Added CSV export."));
    const result = await generateGroundedDraft(input, attempt, logger);
    expect(result.body).toBe("Added CSV export.");
    expect(attempt.mock.calls[1][0]).toContain(`must be at most ${X_MAX_CHARS}`);
  });

  it("returns a still-long but grounded post for the founder to trim, never fails on length alone", async () => {
    const attempt = jest.fn().mockResolvedValue(draft(long));
    await expect(generateGroundedDraft(input, attempt, logger)).resolves.toEqual(draft(long));
  });

  it("prefers the grounded first draft when the retry invents a number", async () => {
    const attempt = jest.fn().mockResolvedValueOnce(draft(long)).mockResolvedValueOnce(draft("Added CSV export for 40 users."));
    await expect(generateGroundedDraft(input, attempt, logger)).resolves.toEqual(draft(long));
  });

  it("still fails when neither draft is grounded", async () => {
    const attempt = jest.fn().mockResolvedValue(draft("Added CSV export for 40 users."));
    await expect(generateGroundedDraft(input, attempt, logger)).rejects.toBeInstanceOf(DraftGenerationFailedException);
  });

  it("never applies the X limit to LinkedIn or email", async () => {
    const attempt = jest.fn().mockResolvedValue(draft(long));
    await generateGroundedDraft({ ...input, channel: Channel.LINKEDIN }, attempt, logger);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
