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
- **Database:** PostgreSQL via Supabase
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
- **Open questions:** Makebee product vs. separate venture (breakdown sent to team, awaiting reply); give-to-get on aggregate insights (does an opted-out founder still see the pool?); exact `Niche` list.
- **First test cases:** Studie AI (Makebee's product — caveat: 6-person team, warmer feedback) and `@seyedele` (closer to real target: solo, build-in-public, offered to beta test). Note one real signal already: a target founder runs on **$0 marketing budget** — validate whether the paying customer is "time-poor" rather than "money-poor."
- **Real signal extraction (2026-11-03)** — `GeminiExtractionProvider` (`src/modules/report-back/extraction/`) replaces `StubExtractionProvider` in `report-back.module.ts`. The stub ignored the founder's words and wrote `views 4000 / replies 2 / POSITIVE` for every report. It is now **test-only** and must never be bound in the app again. Load-bearing details:
  - **Every non-null value must quote the founder's exact words.** The response schema demands `{ value, evidence }` per field, and `isGrounded()` checks the quote really appears in `rawFeedback` (tolerating only case, quotes, dashes, whitespace, edge punctuation, never paraphrase). Ungrounded or invalid values (negative, fractional, unknown enum, wrong type) become `null` field by field: losing a true value is recoverable from the saved raw report, an invented one is immortal.
  - Prompt rules mirror §5: null = not said, a stated zero stays `0` ("crickets", "no replies"), vague amounts ("a few") are `null`, ranges use the midpoint rounded down, and sentiment is the *audience's* reaction, with silence → `null`, never `NEUTRAL` (matches the schema's own `Sentiment` comment). `temperature: 0`, 15s timeout, and the founder's message is framed as data, not instructions. `postedAt` is never extracted, since `Send.sentAt` is authoritative and relative dates ("yesterday") hallucinate. Logs carry field names only, never founder text.
  - **`reportBack` is now two commits** (the split the old "FUTURE SPLIT" comment called for): (1) `FeedbackReport` + `Story → REPORTED` commit together *before* any LLM call, so the raw words are never lost and a 15s Gemini call never sits inside a 5s-default Prisma transaction; (2) extraction (one automatic retry) + `SignalRecord`, best-effort. On failure, `POST /reports` still returns 201 with `signalRecord: null`, and **`POST /reports/:id/extract`** retries from the saved raw text (409 if the signal already exists, 502 if extraction fails again; the `feedbackReportId @unique` constraint backstops races). **Deliberate deviation from that old comment:** status flips in step 1, not step 2. `REPORTED` records the human event, and tying it to extraction would strand the story at STAGED after a Gemini failure, with the founder's resubmit 409ing as a duplicate. Retry-time caveat: dimensions are snapshotted at retry time; only `User.niche` could differ, and nothing can change it yet.
  - Verified live against real Gemini on 10 realistic messages (silence, vague amounts, a range, a prompt injection, mixed reactions, X-specific details): all correct, ~1s each. One judgment call to watch: "one guy said X, another said Y" → `replyCount: 2`, counting described responders (a floor, not a total). Also verified over HTTP end-to-end. 29 new tests, 120 total passing.
  - **No backfill job yet:** a report whose extraction failed stays `signalRecord: null` until something calls the retry endpoint. Fine at beta volume; query `FeedbackReport` rows with no `signalRecord` to find them.
- **Suggested next build step:** onboarding for a freshly registered founder (zero-audience founders skip the audience step into draft-only mode, and the skip rate is the measurement the product notes asked for) — auth made multiple users real, but a new account still can't finish the loop: there's no way to set `User.niche` (report-back fail-closes on null, correctly) and no `GET`/`POST /audiences` (send needs one; the web client still hardcodes the dev founder's two seeded audience ids, which 404 for anyone else and go stale on every truncate). A user-scoped audiences endpoint + a niche field at signup/onboarding closes both. After that: rate-limiting `/auth/login`, the `AggregatedInsight` rollup job — the schema exists but nothing computes it yet, mobile's flow screens (capture/send/report-back/graduate) to match web, the onboarding voice-sample paste screen on the frontend (backend `PUT /voice-profile` is ready and verified — see the voice-wiring bullet above — but no client calls it yet), and actually using the send-as-is signal the edit-capture slice above now makes capturable (still nothing reads it yet — this task only made the diff exist and be correct, not analytics on top of it).
- **Prisma migration history note:** `service/prisma/migrations/` didn't exist before 2026-08-15 (the dev DB had been managed via ad hoc `db push`/manual SQL). A baseline migration (`20260814235502_init`, generated via `prisma migrate diff --from-empty` and marked `--applied` without re-running, since the DB already matched it) was added first so `prisma migrate dev` has real history to build on going forward — use `prisma migrate dev` for schema changes from here on, not `db push`.

---

## 9. Quick reference for an agent working here

Before writing backend code, load the `nestjs-prisma` conventions. Before touching a schema, re-read §5. When in doubt on a data-shape decision, ask: *"does this preserve a historical fact, or mutate one?"* — mutating a historical outcome is almost always the bug.
