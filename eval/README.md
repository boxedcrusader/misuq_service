# M1 eval: a blind taste test of draft quality

Does Misuq's drafting layer (voice sample, structure rules, format rules, the invented-number check) beat **the same model with a bare prompt**? And is it at least as good as what the founder writes themselves?

For each founder update, the harness puts three drafts in front of a judge, in a random order, labelled only A, B and C:

| Arm | What it is |
|---|---|
| `misuq` | Production drafting, called directly: `toDraftInput` → `ClaudeDraftingProvider.generateDraft` (voice sample, format rules, invented-number check, one corrective retry). Nothing copied. |
| `plain` | The same model, through the same provider's client, with the **exact generation settings** of the `misuq` request (copied from it). Only the prompt differs: the fixed `"Write a {format} about this update:\n\n{raw}"` (`lib/plain-prompt.ts`, version `plain-v1`). Never tune it; a new prompt is a new experiment, so bump the version. |
| `founder` | The founder's own handwritten version, from the input file. |

## Pass bar (pre-registered, `lib/scoring.ts`)

**PASS** = misuq beats plain on **≥80%** of updates (4 of 5) **and** misuq is at least as good as the founder on **≥50%**.

- *misuq beats plain* on an update: misuq was the favorite (win) or plain was (loss). If the founder's version was the favorite, it's decided by "post as-is": misuq yes and plain no = win, the reverse = loss. Anything else is a **tie, and a tie is not a win**.
- *misuq at least as good as the founder*: misuq was the favorite, or its "post as-is" is at least the founder's (yes whenever the founder's was yes).

Don't change these after seeing results.

## 1. Fill in `eval/updates.json`

Copy `eval/updates.example.json` to `eval/updates.json` (gitignored: it's a founder's own words).

```json
{
  "judge": "seyedele",
  "founderName": "Ada",
  "voiceSample": "3-5 of the founder's own posts…",
  "updates": [
    { "id": "u1", "type": "launch", "format": "x", "raw": "what they shipped, rough", "founderVersion": "their own post about it" }
  ]
}
```

- At least **5 updates** and at least **3 distinct types** (`launch`, `bugfix`, `lesson`).
- `format`: `x`, `linkedin` or `email` (the formats production drafts).
- Every update needs a `founderVersion`: written by the founder **before** they see any generated draft.
- `founderName` is optional. Production signs emails off with it; leave it out and the `misuq` drafts sign off without a name.
- At most **13 updates per run** (the 40-call cap; see below). Split bigger sets into several runs.

## 2. Generate

```sh
npm run eval:generate                    # dry run: validates, prints the call estimate, sends nothing
npm run eval:generate -- --yes           # makes the calls
npm run eval:generate -- --self-test --yes   # same, plus self-check.md
```

Options: `--input <path>` (default `eval/updates.json`), `--seed <n>` (reproduce an A/B/C order), `--self-test`. The `--` is needed so npm doesn't swallow the flags.

It writes `eval/runs/<timestamp>/` (gitignored):

| File | |
|---|---|
| `judge.html` | **Send this one.** The blind sheet. |
| `answer-key.json` | Which letter is which arm. **Private.** |
| `drafts.json` | Everything, un-blinded: drafts, prompts, settings, every request. **Private.** |
| `self-check.md` | `--self-test` only. Breakage, not quality: empty or cut-off drafts, numbers not in the update, X posts over 280 characters, format problems (preambles, several options, placeholders, markdown, threads). Un-blinded: **private.** |

Guarantees:
- **No database:** no Prisma client and no Nest app. The run fails if a database module gets loaded.
- **No HTTP API,** so no daily AI caps are used and no rows are written.
- **Refuses to run** if `DATABASE_URL` looks like production (the same guard as the Jest suite).
- **Shows the worst-case number of calls first** and needs `--yes` before calling anything.
- **Hard cap of 40 model calls per run.** The SDK may re-send a failed request once on its own; those aren't counted.
- **Arms 1 and 2 use identical generation settings.** The settings, both prompts and each request's prompt hash are recorded in `drafts.json`, and the run fails if any setting differed.
- **No leaks:** judge.html is scanned before it's written. Once the judged text is removed, no arm name, model, setting, seed or prompt may remain, and nothing may be loaded from the network.

## 3. Send `judge.html`

Send just that one file, by email, chat or AirDrop. It's self-contained and works offline.
- **Phones:** open it in a real browser. Some file previews, like iPhone's Files preview, show the page but don't run its buttons.
- **Saving:** answers are saved on that device as the judge goes.
- **Returning results:** when every update is answered, the judge taps **Copy results** and pastes the JSON back to you. If copying is blocked, the page shows the text to copy by hand.

## 4. Score

Save the pasted JSON into the run directory, then:

```sh
npm run eval:score -- eval/runs/<timestamp> eval/runs/<timestamp>/results.json
```

It checks the results belong to this run's sheet and answer every update, and that the answer key matches its seed. It then prints the following, and writes them to `score.md` in the run directory:
- misuq vs plain (wins, losses, ties)
- misuq vs the founder
- the send-as-is rate per arm
- PASS or FAIL

## Caveats

- **The plain arm's output is kept verbatim.** A bare prompt often returns a preamble ("Here's…"), several options, markdown or a `[Name]` placeholder. That's what a founder would get from a bare prompt, so it's what's judged. `self-check.md` flags it.
- **A judge who is the founder may recognise their own version.**
