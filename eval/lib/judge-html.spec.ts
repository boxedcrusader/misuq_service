import { ARMS } from "./arms";
import { escapeHtml, findLeaks, JudgeSheet, renderJudgeHtml } from "./judge-html";
import { buildAnswerKey } from "./shuffle";

// Drafts that themselves say "founder", "plain" and "Misuq": blinding must
// strip the judged text before scanning, not fail on it, and still catch a
// real leak in the template.
const SHEET: JudgeSheet = {
  sheetId: "abc123def456",
  judge: "seyedele",
  updates: [
    {
      id: "u1",
      formatLabel: "X post",
      isX: true,
      raw: "As a founder I shipped <CSV> export & a plain-text mode.",
      drafts: {
        A: "Misuq-style draft: as a founder, I shipped CSV export.",
        B: "Plain and simple: CSV export is live.",
        C: "Shipped CSV export. \"Two\" users asked.",
      },
    },
    {
      id: "u2",
      formatLabel: "Email",
      isX: false,
      raw: "Fixed the logout bug.",
      drafts: { A: "Hi all,\n\nFixed it.\n\nAda", B: "Subject: fixed\n\nFixed.", C: "Fixed the logout bug, sorry!" },
    },
  ],
};

const FORBIDDEN = [...ARMS, "claude-sonnet-5-5", "claude", "sonnet", "anthropic", "temperature", "max_tokens", "effort", "prompt", "seed", "424242", "plain-v1"];
const content = (s: JudgeSheet) => [s.judge, ...s.updates.flatMap((u) => [u.id, u.raw, u.drafts.A, u.drafts.B, u.drafts.C])];

describe("judge.html", () => {
  const html = renderJudgeHtml(SHEET);

  it("has no arm name, model, setting, seed or prompt anywhere outside the judged text", () => {
    expect(findLeaks(html, { content: content(SHEET), forbidden: FORBIDDEN })).toEqual([]);
  });

  it("never contains an answer-key mapping", () => {
    const key = buildAnswerKey(424242, SHEET.updates.map((u) => u.id));
    for (const [id, mapping] of Object.entries(key)) {
      for (const [letter, arm] of Object.entries(mapping)) {
        expect(html).not.toContain(`"${letter}":"${arm}"`);
        expect(html).not.toContain(`${id}-${arm}`);
      }
    }
    expect(html).not.toMatch(/data-arm/i);
  });

  it("catches a leak if one ever gets into the template", () => {
    const leaked = html.replace("<h1>Draft taste test</h1>", "<h1>Draft taste test (misuq vs plain, seed 424242)</h1>");
    expect(findLeaks(leaked, { content: content(SHEET), forbidden: FORBIDDEN })).toEqual(expect.arrayContaining(["misuq", "plain", "seed", "424242"]));
  });

  it("is self-contained: no external scripts, styles, fonts or requests", () => {
    expect(findLeaks(html, { content: content(SHEET), forbidden: [] })).toEqual([]);
    const withCdn = html.replace("</head>", '<script src="https://cdn.example.com/x.js"></script></head>');
    expect(findLeaks(withCdn, { content: content(SHEET), forbidden: [] }).join(" ")).toMatch(/external reference/);
  });

  it("escapes the judged text and keeps it exactly", () => {
    expect(html).toContain(escapeHtml(SHEET.updates[0].raw));
    expect(html).not.toContain("<CSV>");
    for (const u of SHEET.updates) for (const l of ["A", "B", "C"] as const) expect(html).toContain(escapeHtml(u.drafts[l]));
  });

  it("asks the three questions for every update and draft", () => {
    for (const u of SHEET.updates) {
      expect(html).toContain(`name="fav-${u.id}"`);
      for (const l of ["A", "B", "C"]) expect(html).toContain(`name="asis-${u.id}-${l}"`);
      expect(html).toContain(`name="comment-${u.id}"`);
    }
    expect(html).toContain('id="copy"');
    expect(html).toContain('<meta name="viewport"');
  });
});
