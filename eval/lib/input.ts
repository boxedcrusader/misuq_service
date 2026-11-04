import { DRAFT_CHANNELS } from "../../src/modules/capture/drafting/draft-core";
import { FORMAT_TO_CHANNEL, InputFormat } from "./arms";

// eval/updates.json. See eval/updates.example.json and eval/README.md.
export const UPDATE_TYPES = ["launch", "bugfix", "lesson"] as const;
export type UpdateType = (typeof UPDATE_TYPES)[number];

export const MIN_UPDATES = 5;
export const MIN_DISTINCT_TYPES = 3;

export interface EvalUpdate {
  id: string;
  type: UpdateType;
  format: InputFormat;
  raw: string;
  founderVersion: string;
}

export interface EvalInput {
  judge: string;
  voiceSample: string;
  // Optional: the name the "misuq" arm signs emails off with, as production
  // does with User.name. Absent = sign off without a name.
  founderName?: string;
  updates: EvalUpdate[];
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Every problem at once, so one fix-up pass is enough.
export function validateInput(data: unknown): { ok: true; input: EvalInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["the file must be a JSON object"] };
  const obj = data as Record<string, unknown>;

  if (!isNonEmptyString(obj.judge)) errors.push(`"judge" must be a non-empty string`);
  if (!isNonEmptyString(obj.voiceSample)) errors.push(`"voiceSample" must be a non-empty string (the founder's own posts)`);
  if (obj.founderName !== undefined && !isNonEmptyString(obj.founderName)) errors.push(`"founderName", if given, must be a non-empty string`);

  const supported = Object.entries(FORMAT_TO_CHANNEL)
    .filter(([, channel]) => (DRAFT_CHANNELS as readonly string[]).includes(channel))
    .map(([format]) => format);

  if (!Array.isArray(obj.updates)) {
    errors.push(`"updates" must be an array`);
    return { ok: false, errors };
  }
  if (obj.updates.length < MIN_UPDATES) errors.push(`need at least ${MIN_UPDATES} updates (got ${obj.updates.length})`);

  const seenIds = new Set<string>();
  const types = new Set<string>();
  obj.updates.forEach((u, i) => {
    const at = `updates[${i}]`;
    if (!u || typeof u !== "object" || Array.isArray(u)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const upd = u as Record<string, unknown>;
    const label = isNonEmptyString(upd.id) ? `${at} ("${upd.id}")` : at;
    if (!isNonEmptyString(upd.id) || !ID_PATTERN.test(upd.id)) {
      errors.push(`${label}: "id" must be 1-40 letters, digits, - or _`);
    } else if (seenIds.has(upd.id)) {
      errors.push(`${label}: duplicate id`);
    } else {
      seenIds.add(upd.id);
    }
    if (typeof upd.type !== "string" || !(UPDATE_TYPES as readonly string[]).includes(upd.type)) {
      errors.push(`${label}: "type" must be one of ${UPDATE_TYPES.join(", ")}`);
    } else {
      types.add(upd.type);
    }
    if (typeof upd.format !== "string" || !supported.includes(upd.format)) {
      errors.push(`${label}: "format" must be one of ${supported.join(", ")}`);
    }
    if (!isNonEmptyString(upd.raw)) errors.push(`${label}: "raw" must be a non-empty string`);
    if (!isNonEmptyString(upd.founderVersion)) errors.push(`${label}: "founderVersion" is required (the founder's own handwritten version)`);
  });
  if (types.size < MIN_DISTINCT_TYPES) {
    errors.push(`need at least ${MIN_DISTINCT_TYPES} distinct types (got ${types.size}: ${[...types].join(", ") || "none"})`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, input: obj as unknown as EvalInput };
}
