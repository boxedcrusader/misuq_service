import { CallBudget, estimateCalls, MAX_LLM_CALLS_PER_RUN, maxUpdatesPerRun } from "./budget";
import { checkDraft } from "./self-check";

describe("call budget", () => {
  it("estimates the worst case: misuq up to 2 calls, plain 1, founder 0", () => {
    expect(estimateCalls(5)).toBe(15);
    expect(maxUpdatesPerRun()).toBe(13);
    expect(estimateCalls(maxUpdatesPerRun())).toBeLessThanOrEqual(MAX_LLM_CALLS_PER_RUN);
  });

  it("refuses the call past the cap", () => {
    const budget = new CallBudget(2);
    budget.take();
    budget.take();
    expect(() => budget.take()).toThrow(/cap reached/);
    expect(budget.used).toBe(2);
  });
});

describe("self-check (breakage only)", () => {
  const base = { updateId: "u1", arm: "plain" as const, letter: "A" as const, sources: ["Shipped CSV export. Two beta users asked."] };

  it("passes a clean draft", () => {
    expect(checkDraft({ ...base, format: "x", body: "CSV export is live. Two beta users asked, so here it is." })).toEqual([]);
  });

  it("flags empty, cut-off and over-length drafts", () => {
    expect(checkDraft({ ...base, format: "x", body: "  " }).map((i) => i.problem)).toEqual(["empty"]);
    expect(checkDraft({ ...base, format: "linkedin", body: "CSV export is live and two beta users asked for it", stopReason: "max_tokens" })[0].problem).toMatch(/truncated/);
    expect(checkDraft({ ...base, format: "x", body: "CSV export. ".repeat(30) }).map((i) => i.problem).join()).toMatch(/characters \(limit 280\)/);
  });

  it("flags numbers that aren't in the update, using production's check", () => {
    const problems = checkDraft({ ...base, format: "x", body: "CSV export is live. 300 teams already use it." }).map((i) => i.problem);
    expect(problems.join()).toMatch(/numbers not in the update: "300"/);
  });

  it("doesn't count numbered-list markers as invented numbers, but does count real ones", () => {
    const body = "Two beta users asked.\n\n1. CSV export\n**2.** Column picker\n3) Instant download\n\nIt took six weeks.";
    const problems = checkDraft({ ...base, format: "linkedin", body }).map((i) => i.problem).join();
    expect(problems).toContain('numbers not in the update: "six"');
    expect(problems).not.toMatch(/"1"|"2"|"3"/);
    const options = checkDraft({ ...base, format: "x", body: "**Option 1 (short):** CSV export is live.\n**Option 3:** Two asked, it shipped.\nI'd go with Option 1 or 3." });
    expect(options.map((i) => i.problem).join()).not.toMatch(/numbers not in the update/);
  });

  it("flags format violations: preambles, options, placeholders, markdown, threads", () => {
    const problems = (body: string) => checkDraft({ ...base, format: "x", body }).map((i) => i.problem).join(" | ");
    expect(problems("Here's an X post about your update:\n\nCSV export is live.")).toMatch(/preamble/);
    expect(problems("Option 1: CSV export is live.\nOption 2: CSV is here.")).toMatch(/several options/);
    expect(problems("CSV export is live. Try it: [link]")).toMatch(/placeholder/);
    expect(problems("**CSV export** is live for everyone now.")).toMatch(/markdown/);
    expect(problems("CSV export is live 🧵 a thread on why")).toMatch(/thread/);
  });
});
