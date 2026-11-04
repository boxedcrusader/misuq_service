# Misuq

> AI marketing copilot for indie SaaS founders.
> This README doubles as the Claude Code project brief. **Rename to `CLAUDE.md` if you want Claude Code to auto-load it as project context.**

If you're an AI agent working in this repo: read the whole file before writing code. Several decisions here look arbitrary and are not — the "why" notes exist so you don't undo load-bearing choices. When a decision conflicts with your default instinct, the decision wins unless you flag the conflict explicitly.

---

## 1. What Misuq is (the non-technical core)

Building a product has become cheap and fast — AI coding tools, no-code, templates. The bottleneck moved downstream: getting anyone to **notice or care** about what you built. Misuq sells the scarce resource in a world of abundant supply — **attention and distribution, not code.**

- **Target customer:** indie / solo SaaS founders. Deliberately narrow. Niche first, widen later. Do not build "for everyone."
- **Core offering:** an AI agent that markets *on the founder's behalf* — it drafts and plans content, but **a human approves before anything posts.** Not fully autonomous.
- **Why human-in-the-loop:** fully autonomous posting risks platform bans (bot-like behavior gets throttled/banned) and audience distrust (people can smell AI marketing and punish it). This is a product principle, not a temporary limitation — do not architect toward auto-posting in V1.

---

## 2. The core mechanism — staged / validate-before-broadcast

This is the wedge. It was chosen over a "fan out one input to every channel" alternative on purpose: generating content is now commoditized; judging **when content is ready** is the hard, defensible part.

Analogy: theater previews in a smaller city before opening night. The small audience's reaction tells you what to keep before the story hits the big stage.

### The V1 loop
1. **Capture** — founder drops in a raw update (shipped feature, milestone, lesson learned). Freeform, unscheduled — matches how build-in-public founders actually work.
2. **Draft** — agent turns it into a first "preview" version (usually email/newsletter format).
3. **Send** — founder sends it to their *own* small audience (their list, Discord, beta users, a few peers) — not a public community. Sidesteps the cold-start problem: every founder has *some* small room.
4. **Report back** — founder tells the agent, in **plain freeform chat** (not a form), how it landed: replies, signups, silence, specific reactions, and roughly how many people saw it.
5. **Graduate** — founder decides when to promote the validated story. **Validation is human-gated** — the agent never auto-decides a story is "ready."
6. **Reformat & remember** — agent reshapes the validated story for wider channels (X, LinkedIn, blog), each with real per-platform voice rules (not just character-count trimming), and remembers what tone/angle worked for this founder over time.

### Locked-in design decisions (do not silently change)
- **Human-gated graduation**, not signal-based or automatic.
- **Founder's own audience** as the first test room, not a public feed.
- **Freeform chat feedback**, not a structured form — consistent with the conversational premise, at the cost of messier data (we structure it *after* capture, see §5).

---

## 3. The moat — why the data model matters more than the features

Anyone can copy the prompts, UI, and marketing frameworks overnight. The one thing they can't copy is **accumulated real-outcome data**, which only exists because founders used the product first. So the strategy is a floor-and-edge split:

- **Floor (ship on this): curated positioning frameworks.** Bake proven theory (Jobs-to-be-Done, StoryBrand) in as a reasoning lens so day-one output isn't naive. This is public knowledge — every AI tool "knows" it — so it's the floor, not the edge.
- **Edge (build toward this): aggregate cross-founder learning.** Pool *anonymized structural outcomes* across many founders in the same niche. One founder's feedback is noise; hundreds of founders' pooled outcomes reveal real patterns (e.g. "vulnerability-toned posts beat feature announcements 3:1 for dev tools"). The catch: it needs volume, so it's worthless at low n — **but the data model must be built for it from day one**, because early usage on the wrong schema is outcome data you can never recover.

Rejected/deferred outside-knowledge options: live competitor scraping (shallow, stale, trivially copyable), human expert review (doesn't scale). Not foundations.

---

## 4. Tech stack & conventions

- **Runtime:** Node.js + TypeScript
- **Framework:** NestJS (modular, decorator-based)
- **ORM:** Prisma (schema-first, type-safe)
- **Database:** PostgreSQL on **Neon** (decision 2026-11-03; this brief originally said Supabase). Use the *direct* (non-pooled) connection string, since Prisma migrations need it.
- **Hosting (decision 2026-11-03):** API on **Render** (`render.yaml` Blueprint, Frankfurt; put Neon in AWS eu-central-1 to match). Web on **Cloudflare Pages** (static export).
- **Dependencies:** pick the most *stable* version that has the needed fix (roughly 2+ weeks old, latest patch of a settled line), never just the newest; no blanket `npm audit fix`.
- **Auth:** JWT (access + refresh token pattern)
- **Validation:** class-validator + class-transformer
- **LLM (drafting):** start with **Gemini Flash-Lite** (cheap, reuses existing setup). Upgrade the drafting step *specifically* to **Claude Haiku 4.5** if output sounds generic and doesn't hold the founder's voice. DeepSeek is the cost-floor fallback. The LLM layer must be swappable per-step — don't hardcode one provider across the whole app.

### Project structure
```
src/
├── main.ts
├── app.module.ts
├── common/          # decorators, guards, interceptors, filters, pipes
├── prisma/          # global PrismaModule + PrismaService
└── modules/
    └── [feature]/
        ├── [feature].module.ts
        ├── [feature].controller.ts
        ├── [feature].service.ts
        └── dto/
```

### Code conventions (hard rules)
- IDs: `cuid()` everywhere.
- Every model has `createdAt` + `updatedAt`.
- All status/type fields are **enums**, never free strings — see §5 for why this is non-negotiable.
- Relations: camelCase, explicit `@relation`, `onDelete` set intentionally.
- DTOs: `Create*Dto` with class-validator; `Update*Dto extends PartialType(Create*Dto)`.
- Services validate existence before update/delete (throw `NotFoundException`).
- Global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`.
- Run `npx prisma generate` after any schema change.

---

## 5. The data model — the one thing to understand deeply

**Governing idea: two layers, kept strictly apart.**

Like a doctor's office. There's the messy conversation in the room (the patient rambling about how they feel) and the clean line on the chart (`BP 120/80`). Both matter, but they serve different masters: the conversation is private and belongs to the patient; the chart entry is structured so it can eventually roll up into population-level knowledge. Misuq's moat is the population-level knowledge, so **every messy human input gets a structured twin built to pool.**

### Private / messy layer (one founder's raw material)
- **`Story`** — the narrative spine that graduates. Holds `rawCapture`. Graduation is one human decision (`graduatedAt` set only by the founder). `contentType` lives here (a feature announcement is a feature announcement wherever it goes).
- **`ContentPiece`** — one rendered draft of a story, per channel + stage. `tone` lives here, because tone *flexes* per channel — that's the whole point of the reformat step. One story spine → many channel leaves.
- **`Send`** — a staging event (piece → audience). Freezes `audienceSizeSnapshot` at send time.
- **`FeedbackReport`** — the raw freeform chat feedback, in the founder's own words.
- **`Audience`** — deliberately broad: email list, Discord, beta users, peers. "Audience" is redefined *down* so founders with no big list still have a small room.
- **`VoiceProfile`** — per-founder voice memory. Loose `Json` bag. Read only by *this* founder's agent. **Never pooled.**

### Structured / poolable layer (the moat)
- **`SignalRecord`** — the chart entry. A denormalized, structured, historical outcome fact. This is the moat's atom.
- **`AggregatedInsight`** — option C output. `GROUP BY` rollup over `SignalRecord`. Architected now, meaningful only at volume.

### Four load-bearing rules — do not "optimize" these away
1. **`SignalRecord` snapshots its dimensions** (`niche`, `channel`, `contentType`, `tone`) instead of only joining back. It records a *historical fact* — like a school transcript, once the grade is written it's permanent even if the student later changes major or the rubric is edited. If a founder switches niche or edits an old draft, historical signal must not silently rewrite itself. This also makes aggregation a flat `GROUP BY` and lets us anonymize/export the pool without dragging identifiable FKs along.
2. **Consent is checked live, not snapshotted.** Pooling filters on `User.aggregateLearningConsent` at query time, so a founder toggling it off genuinely removes their data from the *next* aggregation. Default is affirmative opt-in (`false`), reversible.
3. **Pool structural patterns, never raw content.** "Vulnerable dev-tools email → 3× reply rate" pools; the literal post text never does. This protects unreleased-feature leaks between founders and is the consent promise.
4. **`confidenceLow` defaults to `true`; `audienceSizeSnapshot` is frozen on `Send`.** Every signal is guilty-until-proven noise. And "3 replies" means something completely different at 5 peers vs. 5,000 subscribers, so audience size is stamped at send time, never read live.

### NEVER synthesize a value for a poolable-layer dimension
If a required field on SignalRecord (or any poolable/moat table) has no
honest source value at write time, STOP — do not default, coerce, or
fall back to OTHER to proceed. A moat dimension (niche, channel,
contentType, tone) is a GROUPING KEY: a synthesized value doesn't create a
slightly-worse data point, it creates one that pools incorrectly forever
(§5 snapshots freeze it — a guess written now is immortalized, never
rewritten when the real value arrives later).
- OTHER is valid ONLY as a genuinely-chosen answer, NEVER as a stand-in for
  "not asked yet" / "source was null." Those two meanings must never
  collapse into the same value — that's the null-vs-zero confusion one level
  up.
- The fix is always to make the missing value IMPOSSIBLE upstream (gate the
  write, or require the field earlier), not to invent one downstream.
- This is distinct from ContentType.OTHER / Tone.OTHER on CONTENT, where
  "uncategorized" is an honest description. On a MOAT DIMENSION it is not.

### Known future migrations (flagged so they're not surprises)
- `SignalRecord.tone` went **nullable** on 2026-11-03 (see §8 tone fix): null = angle never classified, never OTHER.
- `SignalRecord.feedbackReportId` is **required** in V1 (every signal comes from a report-back). It must go **nullable** the moment platform-derived signal (scraped views) is added.
- `Niche` enum is a best-guess starting list — edit it *before* the first migration; painful once pooled data is keyed on it.
- Full multi-turn `Conversation`/`Message` memory is deliberately omitted; `FeedbackReport.rawFeedback` holds the one conversation that matters for now.
- `FounderBaseline` (self-relative performance comparison) is a query over the founder's own `SignalRecord` history for now — don't pre-compute a table until the query is actually slow.

---

## 6. Monetization

- **Currency: USD, billed globally.** Naira rejected as default (FX volatility, processor friction, perception for a global SaaS audience). NGN may return later as a Nigeria-only discounted option via Paystack/Flutterwave.
- **Model: flat tiers, NOT credits.** The loop is intentionally slow and human-gated; per-draft metering would push founders to generate more and validate less — the opposite of the point.
- **Tiers (subject to revision):**
  - `DRAFT_ONLY` — free/cheap: frameworks-based drafting only, no send/validate loop (honest fallback for zero-audience founders).
  - `STARTER` — $19/mo: 1 email list + 1 wide channel, unlimited drafts/staging.
  - `GROWTH` — $49/mo: 3 channels, voice/tone memory across stories.
  - `SCALE` — $99/mo: unlimited channels, priority access to aggregate insights (once the pool has volume).
- Guard API routes by `user.plan`.

---

## 7. Privacy & consent (affects code, not just policy)

- **V1 stays hands-off founder accounts.** No OAuth read/write to email or social. Founder pastes updates, sends manually, reports back manually. This sidesteps the highest-liability surface — do not add account integrations in V1.
- Founder owns raw content; Misuq processes but doesn't own it. Needs a clear retention/deletion policy for cancelled accounts.
- Aggregate consent is asked **after the founder's first report-back** (first moment real data exists to make the ask concrete), shown with a concrete example, as a reversible settings toggle.
- **Deferred (decision 2026-11-03): the consent prompt isn't built until the pool has volume.** Nothing is lost by waiting. SignalRecords are written for every founder regardless of consent (they also feed the founder's own results), and consent is checked live at aggregation time, so a founder who opts in later brings their earlier records into the pool. With a handful of beta founders the pool can't produce a meaningful pattern, so an ask now would request sharing for a benefit that doesn't exist. **Build it together with the `AggregatedInsight` rollup, as one piece of work**: the rollup already filters on consent, so without the prompt it would just return nothing. Meanwhile, tell beta founders in person that their reports are stored and might be pooled later, only if they say yes.

---

## 8. Current status & what to build next

- **Done:**
  - Data model in repo (schema matches §5's two-layer split, including the four load-bearing rules).
  - Backend (`service/`): full V1 loop implemented as NestJS modules — **Capture** (`stories`, with swappable `GeminiDraftingProvider`/`StubDraftingProvider`), **Send** (staging + frozen `audienceSizeSnapshot`), **Report-back** (freeform feedback + swappable extraction provider that structures it into `SignalRecord`), **Graduate** (human-gated `graduatedAt`/`StoryStatus.GRADUATED`), **Content-pieces** (`PATCH /content-pieces/:id`, the edit-capture slice — see below). 8 spec files, plus a `moat-e2e.spec.ts` and `moat-aggregation-proof.js` validating the pooling story.
  - **Edit-capture (2026-08-15):** `ContentPiece` now carries both `generatedBody` (immutable snapshot of the drafting provider's raw output, set once at draft generation, never written again) and `body` (the mutable current/shipped text — was already the only field pre-existing rows had; migration `20260815000000_add_content_piece_generated_body` backfills `generatedBody = body` for them, additive/non-destructive). `ContentPieceStatus.EDITED` (previously unused, flagged in the schema as waiting on exactly this) is now written by the new `ContentPiecesModule` (`src/modules/content-pieces/`): `PATCH /content-pieces/:id` updates `body` and flips status to `EDITED`, guarded to `DRAFTED`/`EDITED` pieces only — a `SENT` piece 409s with a specific "already sent, can no longer be edited" message (send freezes it, same spirit as `Send.audienceSizeSnapshot`). Send-as-is is deliberately **not** a stored flag — it's derivable as `body === generatedBody`, kept that way per the "don't store what's derivable" principle; note this means a since-reverted edit reads as send-as-is even though `status` still says `EDITED` (status records "an edit happened," the boolean-equivalent is a value comparison — two different questions, not a bug). Backend + full loop verified live end-to-end (capture → draft → edit → save → stage → send, and the post-send 409) against the running dev server.
  - **Voice-in-prompt / M1 wiring (audited + completed 2026-08-15):** the M1 blind-test hinges on the founder's voice actually reaching the drafting prompt (otherwise Misuq's draft ≈ a plain-LLM control's draft). Audited against two earlier tasks of unclear status — found it was already fully built, not missing: `VoiceProfile.styleSample` (`String? @db.Text`, already baked into the `20260814235502_init` migration, no new migration needed), `PUT /voice-profile` + `GET /voice-profile` (`VoiceModule`, upsert by founder, `MinLength(40)`/`MaxLength(4000)`), `capture.service.ts#draftStory` loading the founder's `VoiceProfile` and passing it into `GenerateDraftInput.voice`, and `GeminiDraftingProvider.buildPrompt` injecting a "VOICE REFERENCE" block (register only — rhythm/vocabulary/personality, explicitly NOT topics or structure) with a natural-understated-builder fallback when no sample exists, plus explicit hook/one-idea/reactable-ending structure rules that stay constant regardless of voice branch. The one real gap: no test exercised the voice-present/voice-absent branches of `buildPrompt` (it's private, so tests inspect the `contents` string passed to the mocked Gemini call) — added 4 cases to `gemini-drafting.provider.spec.ts` (voice injected, no-voice fallback, whitespace-only sample treated as no-voice, structure rules present regardless of voice branch). Verified live end-to-end against the running dev server: same raw capture drafted for a founder with a casual/lowercase styleSample vs. one with none produced visibly different registers, no crash either way. Full suite (59 tests, 9 suites) passes.
  - Frontend: two clients exist. `client/web` (Next.js) has working flow pages (`/capture`, `/send`, `/report-back`, `/graduate`) wired to the API, plus a marketing landing page — `/capture`'s draft-review step is now editable (see `client/CLAUDE.md`). `client/mobile` (Expo/React Native) has the landing screen and shared components but no flow screens yet. `client/design_handoff_misuq_landing/` holds the design-tool handoff for landing + design system.
- **Real auth (2026-11-03)** — replaces the `x-user-id` header stand-in. `AuthModule` (`src/modules/auth/`): `POST /auth/register` (201), `POST /auth/login` (200), `POST /auth/refresh` (200, rotating), `POST /auth/logout` (204, revokes server-side), `GET /auth/me`. `JwtAuthGuard` (`src/common/guards/jwt-auth.guard.ts`) is a **global `APP_GUARD`** — every route is authenticated unless marked `@Public()` (secure by default; a new controller that forgets a decorator is locked, not open). `@CurrentUser()` still returns a plain id string, so no existing call site changed. Load-bearing details, don't "simplify" them away:
  - Separate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (≥32 chars, must differ) **plus** a `typ` claim — a refresh token can never authenticate a request. No default secrets: the server refuses to boot without them (`auth.config.ts`). Access TTL 15 min, refresh 30 days (env-overridable).
  - Passwords: `node:crypto` scrypt (`password.ts`), cost params stored inside each hash so they can be raised later without breaking old rows. No native bcrypt dep. Malformed stored hashes (e.g. old `"not-a-real-hash"` rows) read as wrong-password, never a 500.
  - Refresh tokens stored as **SHA-256** in `User.hashedRefreshToken`, never bcrypt — bcrypt only compares the first 72 bytes, which for a JWT is header + start of payload, identical across a user's tokens. Each refresh token carries a random `jti` so two minted in the same second differ.
  - Rotation is a single conditional `updateMany` (compare-and-swap on the stored hash): of two concurrent refreshes with one token, exactly one wins.
  - Login: same 401 message for unknown email and wrong password, and a full scrypt verify against a dummy hash for unknown emails, so neither text nor timing reveals which emails have accounts.
  - The guard does one PK lookup per request so a deleted user's unexpired token gets a clean 401 instead of an FK-violation 500 (the dev DB is truncated by every test run).
  - **V1 limitation: one session per user** (single `hashedRefreshToken` column). Logging in elsewhere stops the older session refreshing. Multi-device needs a `Session` table + migration — deferred until mobile has screens worth staying logged into.
  - Tokens travel in the JSON body/`Authorization` header, not cookies, so one contract serves web and React Native. CORS `allowedHeaders` is now `Content-Type, Authorization`.
  - Tests: `auth.service.spec.ts` (service + guard, real DB), `password.spec.ts`, `auth.config.spec.ts` — 32 new, 91 total passing. Verified live over HTTP too. `seed-dev-user.js` now gives the dev founder a real login (`dev-founder@misuq.local` / `misuq-dev-password`, or `DEV_USER_PASSWORD`), hashing via the app's own `password.ts` through ts-node so the format can't drift.
- **Open questions:** Makebee product vs. separate venture (breakdown sent to team, awaiting reply); exact `Niche` list. **Give-to-get (leaning, 2026-11-03; finalize when building the rollup):** an opted-out founder doesn't see pooled insights, but never loses the core product or their *own* results, so declining costs nothing they already had and consent stays freely given. Allow at most one honest preview line where the insight would appear ("founders in your niche found an angle that gets more replies; share your patterns to see which"); no blurred/locked teasers, no delayed access, no repeated nags. Get a GDPR check before an EU launch. If it ships alongside pricing, state both rules plainly (§6: SCALE gets "priority access" to insights, which is a second gate on top of consent).
- **First test cases:** Studie AI (Makebee's product — caveat: 6-person team, warmer feedback) and `@seyedele` (closer to real target: solo, build-in-public, offered to beta test). Note one real signal already: a target founder runs on **$0 marketing budget** — validate whether the paying customer is "time-poor" rather than "money-poor."
- **Real signal extraction (2026-11-03)** — `GeminiExtractionProvider` (`src/modules/report-back/extraction/`) replaces `StubExtractionProvider` in `report-back.module.ts`. The stub ignored the founder's words and wrote `views 4000 / replies 2 / POSITIVE` for every report. It is now **test-only** and must never be bound in the app again. Load-bearing details:
  - **Every non-null value must quote the founder's exact words.** The response schema demands `{ value, evidence }` per field, and `isGrounded()` checks the quote really appears in `rawFeedback` (tolerating only case, quotes, dashes, whitespace, edge punctuation, never paraphrase). Ungrounded or invalid values (negative, fractional, unknown enum, wrong type) become `null` field by field: losing a true value is recoverable from the saved raw report, an invented one is immortal.
  - Prompt rules mirror §5: null = not said, a stated zero stays `0` ("crickets", "no replies"), vague amounts ("a few") are `null`, ranges use the midpoint rounded down, and sentiment is the *audience's* reaction, with silence → `null`, never `NEUTRAL` (matches the schema's own `Sentiment` comment). `temperature: 0`, 15s timeout, and the founder's message is framed as data, not instructions. `postedAt` is never extracted, since `Send.sentAt` is authoritative and relative dates ("yesterday") hallucinate. Logs carry field names only, never founder text.
  - **`reportBack` is now two commits** (the split the old "FUTURE SPLIT" comment called for): (1) `FeedbackReport` + `Story → REPORTED` commit together *before* any LLM call, so the raw words are never lost and a 15s Gemini call never sits inside a 5s-default Prisma transaction; (2) extraction (one automatic retry) + `SignalRecord`, best-effort. On failure, `POST /reports` still returns 201 with `signalRecord: null`, and **`POST /reports/:id/extract`** retries from the saved raw text (409 if the signal already exists, 502 if extraction fails again; the `feedbackReportId @unique` constraint backstops races). **Deliberate deviation from that old comment:** status flips in step 1, not step 2. `REPORTED` records the human event, and tying it to extraction would strand the story at STAGED after a Gemini failure, with the founder's resubmit 409ing as a duplicate. Retry-time caveat: dimensions are snapshotted at retry time; only `User.niche` could differ, and nothing can change it yet.
  - Verified live against real Gemini on 10 realistic messages (silence, vague amounts, a range, a prompt injection, mixed reactions, X-specific details): all correct, ~1s each. One judgment call to watch: "one guy said X, another said Y" → `replyCount: 2`, counting described responders (a floor, not a total). Also verified over HTTP end-to-end. 29 new tests, 120 total passing.
  - **No backfill job yet:** a report whose extraction failed stays `signalRecord: null` until something calls the retry endpoint. Fine at beta volume; query `FeedbackReport` rows with no `signalRecord` to find them.
- **Tone fix (2026-11-03): an unclassified tone no longer reaches the moat.** Measured live, 6/8 real drafts had `ContentPiece.tone = OTHER`, which report-back then snapshotted into `SignalRecord.tone`, a moat grouping key. That was exactly the OTHER-as-stand-in §5 forbids. The 2 that did map were wrong (a 100-customer milestone → VULNERABLE via the keyword "honest"). Root cause: the drafting prompt asked for "the voice you wrote in", and since the prompt itself demands an understated voice, the answer was nearly always "understated" or "plain". Tone in the enum means the post's **angle**; voice is a different axis. Fixed in two layers:
  - **Upstream:** the drafting response schema constrains `tone` to the 8 real angles (never OTHER), each defined once in `tone-mapping.ts` (`TONE_DEFINITIONS`, used by both the prompt and the schema). The keyword mapper (`mapToneToEnum`) is gone; `parseDraftTone` accepts only an exact angle name, else OTHER (honest "uncategorized" on content, logged). Same 8 live drafts afterwards: 0/8 OTHER; clear cases correct (EDUCATIONAL / CELEBRATORY / CASUAL).
  - **Downstream:** `SignalRecord.tone` is now **nullable** (migration `20261103201514_signal_record_tone_nullable`, which also backfills existing OTHER rows → NULL), and report-back writes `null` for an OTHER piece (`poolableTone()`). Unlike niche, this can't fail closed, because a founder can't fix an LLM's classification and the rest of the signal is real. **Any tone-grouped aggregation must filter `tone IS NOT NULL`**: `moat-aggregation-proof.js` does, and the future `AggregatedInsight` rollup must too (`AggregatedInsight.tone` stays required).
  - Also fixed: `moat-aggregation-proof.js` had been crashing since `Audience.size` became required (it never passed one).
  - Open caveat: tone is classified on the *generated* draft. If the founder rewrites it before sending, the stored angle may not match what was sent. Re-classifying on edit is deferred.
- **Drafting no longer invents facts (2026-11-03).** Measured live on 10 varied captures with the old prompt: 7/10 drafts had made-up numbers and 4/10 signed off as an invented "Alex". "Quiet week, fixed bugs" became a Safari memory leak "five days" long, with a listener forgotten "in October"; a $19→$29 price change became "twenty bucks". Causes: no facts rule at all, structure rules that demanded "a real number / a surprising specific / what was hard", a 100-word floor, and a required sign-off with no name supplied. Fixed in `gemini-drafting.provider.ts`:
  - A **FACTS** block comes first and overrides everything: every number, name, date, event, and feeling must come from the raw capture or title; no arithmetic or conclusions the founder didn't state; voice samples lend register only, NEVER facts. STRUCTURE now applies to the facts that exist ("never add a fact to satisfy it"). LENGTH is "usually 40-100 words, never pad". A **CRAFT** block separates what the drafter may add (shaping, hook choice, stating what the capture implies, a closer specific to this update) from what it may not (facts). FACTS alone overcorrected into near-transcripts.
  - Sign-off: `founderName` (from `User.name`, newly passed by `capture.service.ts`) or **no sign-off line at all**, never an invented name.
  - **Code-level backstop** (`grounding.ts#findUngroundedNumbers`): a draft containing a number not present in the capture/title/name gets one corrective retry naming the offending numbers; a second ungrounded draft throws `DraftGenerationFailedException`. Needed despite the prompt fix because `MODEL` is a moving alias (`gemini-flash-lite-latest`), so a future model could regress silently. The checker understands digits, number words, compounds ("twelve hundred"), k/%/commas/ordinals, and never checks "one". Numbers only; invented names and events rely on the prompt.
  - After the fix: 0/10 drafts with invented numbers across three consecutive live runs, and real sign-offs. **Open quality issue:** drafts from thin captures are now honest but thin (often close to restating the capture, sometimes with a generic closer despite the rule). That's the trade-off at this model and input size. The levers, all product decisions: voice samples (onboarding), the §4 Haiku upgrade path for drafting (its stated trigger, "output sounds generic", now applies), and asking the founder for one more detail when a capture is thin instead of guessing.
- **Onboarding (2026-11-03): a brand-new account can now finish the loop.** Verified in a real browser as two fresh founders: signup → onboarding → capture → draft → send to an audience created during onboarding → report-back with a real niche/tone in the outcome record; and the draft-only path (skip audience → `/send` shows an inline "add a small room" form instead of a dead end). Backend pieces:
  - `User.onboardedAt DateTime?` (migration `20261103202941_user_onboarded_at`, **not backfilled**, since inventing completion times would synthesize an event). It's an event, stored: it's what separates "onboarded with zero audiences" (said they have no room → draft-only) from "never finished". That's the zero-audience share the product notes asked to measure: `COUNT(onboarded) FILTER (WHERE no Audience rows)` over `onboardedAt IS NOT NULL`.
  - `PATCH /auth/me` (`UpdateMeDto`: `name` with `""` → null, `niche` as an enum with no way to unset it, because report-back fail-closes on null). `POST /auth/me/onboarding` (200) requires a niche (400 otherwise), does **not** require an audience, and is first-write-wins: re-completing never moves `onboardedAt`, and a conditional `updateMany` keeps concurrent completions to one stamp. `PUBLIC_USER_SELECT` now includes `onboardedAt`.
  - `AudiencesModule` (`src/modules/audiences/`): `GET /audiences` (own only, oldest first, paginated), `GET /audiences/:id`, `POST /audiences` (`name` 1-80, `type` enum, `size` 1-10M; size 0 is rejected because a zero-person room isn't an audience, and draft-only is expressed by having none), `PATCH /audiences/:id` (lists grow; past Sends keep their frozen snapshot). Another founder's id 404s. **No delete** (`Send.audience` is `onDelete: Restrict` to protect send history) and **no per-plan limit** (everyone is DRAFT_ONLY until billing exists).
  - The dev seed now stamps `onboardedAt` for the dev founder (first-write-wins), so logging in as it skips onboarding.
  - Tests: profile/onboarding cases in `auth.service.spec.ts` and a new `audiences.service.spec.ts`; 152 total passing.
  - **Review before the beta:** the `Niche` list (10 values, shown as-is in onboarding). §5 says to edit it before real data is keyed on it, and that moment is now.
- **Pentest + hardening (2026-11-03).** Live attacks against the local API with two throwaway founders. Before: 39 defended, 11 findings. After: **0 findings, 56 defended**. The script lives in the session scratchpad; its checks are summarized here, so re-run equivalents before a major release.
  - **Held up from the start:** auth (`alg:none`, payload tampering, refresh-as-access, the retired `x-user-id`, spent-refresh replay); all 12 cross-founder (IDOR) attacks 404; 10 mass-assignment attempts (`plan`, consent, `userId`, `status`, `generatedBody`...) rejected by `forbidNonWhitelisted`; prototype pollution inert; CORS refuses other origins; no raw SQL in app code; no secrets ever committed.
  - **Fixed:**
    - Rate limiting via `@nestjs/throttler` (global `APP_GUARD`, per IP *per route*): default 120/min; login 10/min; register 20/hour (open signup by decision, loose enough for a team behind one NAT); refresh 30/min; the Gemini-backed routes (draft, report, re-extract) 10/min. In-memory store, so it needs Redis before running more than one instance.
    - Per-account daily caps on drafts and report-backs (`src/common/usage-limits.ts`, rolling 24h, counted from existing rows; `DAILY_DRAFT_LIMIT`/`DAILY_REPORT_LIMIT`, default 30), checked before any Gemini call, 429 with a clear message.
    - Length caps: `rawCapture` 4000, `title` 200, `rawFeedback` 4000, ids 64. A 90 KB capture used to be accepted into a paid prompt.
    - Strict pagination (`src/common/http/pagination.ts`): non-integer/zero/negative → 400, `limit` ≤ 100. These used to 500, or honored 1,000,000.
    - NUL bytes rejected app-wide (`reject-nul-bytes.middleware.ts`), in bodies and in `%00` in paths. These used to 500 in Postgres.
    - `helmet` security headers; `x-powered-by` gone.
  - **Dependencies:** `proxy-addr` 2.0.7→2.0.8 (critical: IP spoofing, which would have defeated the rate limiter behind Render's proxy). Two reachable advisories have no non-major fix, so their code paths are **switched off** in `main.ts`: `body-parser` (JSON-only parser with `inflate: false`, compressed bodies → 415, explicit 100kb limit) and `qs` (Express `query parser` = `simple`, no urlencoded parser). The rest (`@nestjs/core` SSE, `multer`, `file-type`, `deepmerge-ts`/`@prisma/config`) are unreachable here (no SSE, uploads, or file validation; Prisma CLI-only). **The real fix for all of them is the NestJS 10 → 11/12 major upgrade; schedule it.**
  - **Accepted by design:** tokens in localStorage (XSS-exposed; CSP on the web limits exfiltration); an access token lives up to 15 min after logout; signup reveals existing emails; no email verification; one session per account.
- **Deploy prep (2026-11-03):**
  - **Latent bug fixed:** `npm run build` emitted `dist/src/main.js` (because `tsconfig.json` includes `test/`) while `npm start` runs `dist/main.js`, so production start would have crashed. Now `build` uses `tsconfig.build.json` (`rootDir: src`, no specs); verified `node dist/main.js` serves `/health`.
  - `GET /health` (public, unthrottled, pings the DB).
  - CORS origins from `CORS_ORIGIN` (comma-separated; default `http://localhost:3001`), and proxy trust from `TRUST_PROXY` (a hop count, never `true`).
  - `render.yaml`: build `npm ci --include=dev && npx prisma generate && npm run build`; start `npx prisma migrate deploy && node dist/main.js`; JWT secrets generated by Render; `DATABASE_URL`/`GEMINI_API_KEY`/`CORS_ORIGIN` entered in the dashboard.
- **Claude providers, built and live-tested (2026-11-03).** Decision: Claude Sonnet 5.5 (`claude-sonnet-5-5`) for drafting, Claude Haiku 5.5 (`claude-haiku-5-5`) for extraction, chosen on a ~$5 budget, versus a $30 minimum to pay for Gemini. Credits are bought; the code default is still `gemini`, so production uses Claude only once Render has the two env vars below. While on Gemini, watch its free-tier rate limits, and its terms on using prompts to improve Google's products, since founders' updates can include unreleased features.
  - **Live results (measured cost: ~0.5¢ per draft, ~0.03¢ per extraction).** Drafting, 12 captures (the 10 Gemini ones + 2 with a voice sample): 0/12 invented numbers in two runs, real sign-offs, sensible angles, and it adopts the voice sample (Flash-Lite barely did), so the §4 "output sounds generic" trigger is answered. Extraction, the 10-message set: 10/10 after the zero guard below.
  - **Two fixes the live runs forced, now shared by both models:** (1) **zero guard** in `extraction-core.ts`: Haiku turned "Got some replies" into `replyCount: 0` with a genuine quote, which `isGrounded` can't catch. A count of 0 is a claim that nothing happened, so it's kept only when its evidence has zero-language (`evidenceSupportsZero`: no/zero/none/nobody/crickets/didn't…, matched on normalized text); otherwise null. The prompt also says vague amounts are null, never 0. (2) **No invented feelings or reader claims** in the drafting FACTS block: Sonnet's numbers were clean but it added "it still stings" and "you've been around for most of it". Gone after the fix.
  - **Still slips through (founder review catches it, no code check):** an occasional invented time word ("finished #4 on Product Hunt *yesterday*"; the capture gave no date) and mild framing ("I'm fine with that", "I wanted you to hear it from me first"). The number backstop doesn't cover relative dates; a similar check for "yesterday/today/last week" is the next lever if it shows up in real drafts.
  - **Selection** per step via `DRAFTING_LLM` / `EXTRACTION_LLM` (`src/common/llm-selection.ts`): `gemini` (default) | `claude`; unknown values fail at boot. Only the selected provider is constructed, so only its key is required. Selecting `claude` without `ANTHROPIC_API_KEY` stops boot (`Configuration key "ANTHROPIC_API_KEY" does not exist`, verified). **To switch:** in Render add `ANTHROPIC_API_KEY`, set both vars to `claude`, then re-run the live 10-capture fabrication/tone harness and the 10-message extraction set before trusting it.
  - **Shared cores, so the rules can't drift between models:** `drafting/draft-core.ts` (prompt, JSON parsing, the invented-number backstop) and `extraction/extraction-core.ts` (field list, prompt, founder-quote grounding and validation). Moved verbatim out of the Gemini providers; all their existing tests pass unchanged.
  - **`ClaudeDraftingProvider`:** `client.beta.messages.create` with structured output (`output_config.format` JSON schema, tone enum without OTHER), `effort: "low"`, and adaptive thinking left at its default. Server-side refusal fallback `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) is on by default per Claude API guidance; for Sonnet 5.5 it only re-runs `cyber`/`frontier_llm` declines, so it's insurance. No `temperature`, since Sonnet 5.5 and Haiku 5.5 reject sampling parameters. `stop_reason` `refusal` / `max_tokens` → clean `DraftGenerationFailedException`.
  - **`ClaudeExtractionProvider`:** plain `messages.create`, no fallback (Haiku 5.5 has none). The schema uses `anyOf [{value, evidence}, null]` per field (9 unions, the API limit is 16), with `additionalProperties: false` on every object and no `minimum`, because raw structured-output schemas reject numeric constraints. Non-negativity is enforced by `extraction-core.ts`.
  - **SDK** `@anthropic-ai/sdk` pinned to **0.135.0**, the newest release at least two weeks old; the 1.x line was under two weeks old. `zod` is only an optional peer, so it isn't installed. Tests: 13 mocked provider tests, plus `extraction-core.spec.ts` (zero guard) and `draft-core.spec.ts` (FACTS rule); 216 total passing.
- **Incident (2026-11-04): the test suite wiped production, then production was restored.** `service/.env`'s `DATABASE_URL` had been changed (2026-11-04 00:34 local) to the **production** Neon branch. An AI session then seeded data there, ran a pentest against it, applied a migration, and ran the Jest suite, which TRUNCATEs every table (10:18–10:24 UTC). Restored with Neon's point-in-time restore of `main` to 2026-11-04T10:00:00Z, just before the first write (`neonctl branches restore main ^self@…`; free plan keeps 6 h of history). The wiped state is kept as branch `main_wiped_2026-11-04` (`br-red-snow-bavpvrky`); delete it once nobody needs it. Verified after the restore: the founder's 1 account / 3 stories / 2 drafts were back, no test rows, `AiRequest` migration undone. Fixes:
  - **Local dev and tests use the Neon `dev` branch** (`br-quiet-voice-bansszmc`, endpoint `ep-square-mode-…`, created schema-only so no production data was copied), never `main`. It's remote (~300 ms/query), so Jest's `testTimeout` is 60 s and the full suite takes several minutes; a local Postgres URL in `.env` is faster if you have one.
  - **`test/guard-database.js` (Jest `globalSetup`) refuses to run the suite** if `DATABASE_URL` is the production endpoint (`ep-winter-sun-banl5i50`, a list in that file: add any new production endpoint), or on Render, or with `NODE_ENV=production`. It resolves the URL the way Prisma does (env, then `.env`).
  - Prisma's own guard blocks `migrate reset` when an AI agent runs it, until the user explicitly consents. On a schema-only branch, use `migrate resolve --applied` per existing migration, then `migrate deploy`.
- **AI spend caps rebuilt after a pentest (2026-11-04).** Live attacks on a second API instance with a deliberately invalid AI key (every AI call fails, so attacks cost nothing). Before: 13 defended, **4 findings**, all AI spend: (1) failed drafts didn't count toward the daily cap (5 model calls under a cap of 3); (2) `POST /reports/:id/extract` had no cap (7 calls under 3); (3) count-then-insert let 10 parallel drafts all through a cap of 3; (4) no cap across accounts (open signup: 20 accounts/hour/IP × 30 drafts/day each). Plus, from the code: 16,000-token output ceilings, SDK `maxRetries: 2` on top of the app's own retry (up to 6 calls per failure), a 60 s draft timeout.
  - **`AiRequest` table** (migration `20261104101729_ai_request_usage`, additive): one row per AI-backed action, written **before** the model is called. `reserveAiRequest()` in `src/common/usage-limits.ts` counts the founder's rows for the task (per-account caps, unchanged: `DAILY_DRAFT_LIMIT` / `DAILY_REPORT_LIMIT`, 30), counts everyone's (**new global cap `GLOBAL_DAILY_AI_LIMIT`, default 300/day** ≈ $1.50/day at measured Claude prices), and inserts, all in one **SERIALIZABLE** transaction, retried up to 5× on serialization failure (P2034) so parallel requests can't overshoot. Called after the request's own 404/409/400 checks, so a rejected request costs no allowance. Drafts reserve `DRAFT`; report-backs and re-extractions reserve `EXTRACTION` (re-extraction is no longer free). Global-cap message: "Misuq has reached today's AI capacity for all accounts…" (the web client shows it as "Misuq is at capacity today").
  - Provider ceilings: `max_tokens` / `maxOutputTokens` **2,048** on all four providers (measured ~130 tokens per call, so a prompt-injected essay stops at ~15× normal and fails cleanly); Claude SDK `maxRetries: 1` (a failure now costs ≤4 calls); Claude draft timeout 30 s.
  - **Prompt caching: deliberately not added.** Both models cache prefixes from 512 tokens, but at beta volume most requests arrive more than 5 min apart, so cache writes (1.25×) would cost more than reads save. Break-even is roughly 70 drafts a day; revisit then.
  - Tests: `src/common/usage-limits.spec.ts` pins each finding (failed drafts counted, 404 free, global cap, 10-way race, separate allowances, re-extraction capped).
  - **Still true:** the throttler is in-memory (needs Redis before a second instance); Render's proxy-hop count (`TRUST_PROXY=1`) wasn't verifiable locally; **set a monthly spend limit in the Anthropic Console**, the only hard ceiling outside the app.
- **Suggested next build step:** finish the deploy (Neon → Render → Cloudflare Pages), then onboard the beta founders (Studie AI, `@seyedele`). The consent prompt is deliberately deferred (§7). Then: switch production to Claude (add `ANTHROPIC_API_KEY`, `DRAFTING_LLM=claude`, `EXTRACTION_LLM=claude` in Render; the live tests above already passed, and it fixes the thin-draft / ignored-voice problem Flash-Lite had), the reformat-for-wider-channels step (§2 step 6, unbuilt), the NestJS major upgrade (clears the unreachable advisories above), the `AggregatedInsight` rollup job (must filter `tone IS NOT NULL`), mobile's flow screens, and actually using the send-as-is signal the edit-capture slice made capturable.
- **Prisma migration history note:** `service/prisma/migrations/` didn't exist before 2026-08-15 (the dev DB had been managed via ad hoc `db push`/manual SQL). A baseline migration (`20260814235502_init`, generated via `prisma migrate diff --from-empty` and marked `--applied` without re-running, since the DB already matched it) was added first so `prisma migrate dev` has real history to build on going forward — use `prisma migrate dev` for schema changes from here on, not `db push`.

---

## 9. Quick reference for an agent working here

Before writing backend code, load the `nestjs-prisma` conventions. Before touching a schema, re-read §5. When in doubt on a data-shape decision, ask: *"does this preserve a historical fact, or mutate one?"* — mutating a historical outcome is almost always the bug.
