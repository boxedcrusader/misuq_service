// LLM call budget for one eval run.
//
// Worst case per update: the "misuq" arm makes up to 2 model calls (a draft,
// plus ONE corrective retry from draft-core.ts#generateGroundedDraft when
// the draft invents a number or an X post runs long); "plain" makes 1;
// "founder" makes none. Counted per logical request: the Anthropic SDK may
// additionally re-send a request once on a 429/5xx/timeout (maxRetries 1 in
// claude-drafting.provider.ts), which isn't counted here.
export const MAX_LLM_CALLS_PER_RUN = 40;
export const MAX_CALLS_PER_UPDATE = { misuq: 2, plain: 1, founder: 0 } as const;

export function estimateCalls(updateCount: number): number {
  const perUpdate = MAX_CALLS_PER_UPDATE.misuq + MAX_CALLS_PER_UPDATE.plain + MAX_CALLS_PER_UPDATE.founder;
  return updateCount * perUpdate;
}

export function maxUpdatesPerRun(): number {
  return Math.floor(MAX_LLM_CALLS_PER_RUN / estimateCalls(1));
}

// Enforced at the call site too, so a code path the estimate missed still
// can't overspend.
export class CallBudget {
  private made = 0;
  constructor(private readonly cap: number = MAX_LLM_CALLS_PER_RUN) {}

  take(): void {
    if (this.made >= this.cap) {
      throw new Error(`LLM call cap reached (${this.cap} per run); stopping before call ${this.made + 1}`);
    }
    this.made += 1;
  }

  get used(): number {
    return this.made;
  }
}
