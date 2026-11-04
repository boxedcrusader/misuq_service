import { AudienceType, Channel, Sentiment, StoryStatus } from "@prisma/client";

// The founder's own numbers for the profile page (2026-11-04). Pure, so the
// rules are unit-tested without a database. Two rules shape everything here:
//
// 1. Self-relative only. Each post is compared with the founder's OWN usual
//    (the median of their past posts), never with other founders. The pooled
//    layer isn't built and nobody has consented to it yet (CLAUDE.md §7).
// 2. Small numbers are hints. A comparison (a format, a kind of room, "above
//    your usual") is only made once it rests on MIN_POSTS_TO_COMPARE posts;
//    below that the answer is null, shown as "too early to tell".
//
// The rate is replies per 1,000 views: raw reply counts mostly measure how
// many people the platform showed the post to (the reach confound), so they
// are normalized by views. A post with no views or no reply count reported
// has no rate.
export const MIN_POSTS_TO_COMPARE = 3;
export const MAX_POSTS_LISTED = 50;

export type RoomKind = "FOLLOWERS" | "SMALL_ROOM";
const FOLLOWER_ROOMS: ReadonlyArray<AudienceType> = [AudienceType.X_FOLLOWERS, AudienceType.LINKEDIN_NETWORK];

export const COUNT_FIELDS = [
  "views",
  "replies",
  "signups",
  "likes",
  "reposts",
  "quotes",
  "bookmarks",
  "shares",
  "newFollowers",
] as const;
export type CountField = (typeof COUNT_FIELDS)[number];
export type Counts = Record<CountField, number | null>;

export interface OutcomeInput extends Counts {
  storyId: string;
  title: string | null;
  rawCapture: string;
  channel: Channel;
  // null on records made before room types were snapshotted. Every room
  // then was a small room: follower rooms only arrived with the snapshot.
  audienceType: AudienceType | null;
  roomSize: number;
  sentiment: Sentiment | null;
  reportedAt: Date;
}

export interface PostOutcome extends Counts {
  storyId: string;
  label: string;
  channel: Channel;
  roomKind: RoomKind;
  roomSize: number;
  sentiment: Sentiment | null;
  reportedAt: string;
  repliesPer1kViews: number | null;
  // null until there are enough rated posts to have a "usual".
  aboveYourUsual: boolean | null;
}

export interface Comparison<K> {
  key: K;
  posts: number;
  rated: number;
  repliesPer1kViews: number | null; // median, only when enoughData
  enoughData: boolean;
}

export interface UsageLine {
  used: number;
  limit: number;
}

export interface FounderStats {
  pipeline: Record<StoryStatus, number>;
  totals: Counts & { reports: number };
  yourUsual: { repliesPer1kViews: number | null; basedOn: number; enoughData: boolean };
  best: PostOutcome | null;
  byFormat: Comparison<Channel>[];
  byRoom: Comparison<RoomKind>[];
  posts: PostOutcome[];
  aiUsage: { drafts: UsageLine; reportBacks: UsageLine };
  minPostsToCompare: number;
}

export function repliesPer1kViews(views: number | null, replies: number | null): number | null {
  if (views === null || replies === null || views <= 0) return null;
  return Math.round((replies / views) * 10_000) / 10;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
}

export function roomKindOf(audienceType: AudienceType | null): RoomKind {
  return audienceType !== null && FOLLOWER_ROOMS.includes(audienceType) ? "FOLLOWERS" : "SMALL_ROOM";
}

function labelOf(title: string | null, rawCapture: string): string {
  if (title && title.trim()) return title.trim();
  const text = rawCapture.trim().replace(/\s+/g, " ");
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

// Sum of what was reported; null when no post reported that count at all,
// so "0" is never shown for something nobody said.
function sumReported(values: Array<number | null>): number | null {
  const reported = values.filter((v): v is number => v !== null);
  return reported.length === 0 ? null : reported.reduce((a, b) => a + b, 0);
}

function compare<K>(posts: PostOutcome[], keyOf: (p: PostOutcome) => K, order: K[]): Comparison<K>[] {
  return order
    .map((key) => {
      const group = posts.filter((p) => keyOf(p) === key);
      const rates = group.map((p) => p.repliesPer1kViews).filter((r): r is number => r !== null);
      const enoughData = rates.length >= MIN_POSTS_TO_COMPARE;
      return { key, posts: group.length, rated: rates.length, repliesPer1kViews: enoughData ? median(rates) : null, enoughData };
    })
    .filter((c) => c.posts > 0);
}

export function computeFounderStats(input: {
  statusCounts: Partial<Record<StoryStatus, number>>;
  outcomes: OutcomeInput[]; // newest first
  aiUsage: { drafts: UsageLine; reportBacks: UsageLine };
}): FounderStats {
  const pipeline = Object.fromEntries(
    Object.values(StoryStatus).map((status) => [status, input.statusCounts[status] ?? 0]),
  ) as Record<StoryStatus, number>;

  const rated = input.outcomes.map((o) => repliesPer1kViews(o.views, o.replies));
  const rates = rated.filter((r): r is number => r !== null);
  const enoughData = rates.length >= MIN_POSTS_TO_COMPARE;
  const usual = enoughData ? median(rates) : null;

  const posts: PostOutcome[] = input.outcomes.map((o, i) => ({
    storyId: o.storyId,
    label: labelOf(o.title, o.rawCapture),
    channel: o.channel,
    roomKind: roomKindOf(o.audienceType),
    roomSize: o.roomSize,
    sentiment: o.sentiment,
    reportedAt: o.reportedAt.toISOString(),
    ...Object.fromEntries(COUNT_FIELDS.map((f) => [f, o[f]])),
    repliesPer1kViews: rated[i],
    aboveYourUsual: usual !== null && rated[i] !== null ? (rated[i] as number) > usual : null,
  })) as PostOutcome[];

  // "Best" needs something to beat: at least two rated posts.
  const ratedPosts = posts.filter((p) => p.repliesPer1kViews !== null);
  const best =
    ratedPosts.length >= 2
      ? ratedPosts.reduce((a, b) => ((b.repliesPer1kViews as number) > (a.repliesPer1kViews as number) ? b : a))
      : null;

  const channelOrder = [Channel.X, Channel.LINKEDIN, Channel.EMAIL, Channel.DISCORD, Channel.BLOG];
  return {
    pipeline,
    totals: {
      reports: input.outcomes.length,
      ...(Object.fromEntries(COUNT_FIELDS.map((f) => [f, sumReported(input.outcomes.map((o) => o[f]))])) as Counts),
    },
    yourUsual: { repliesPer1kViews: usual, basedOn: rates.length, enoughData },
    best,
    byFormat: compare(posts, (p) => p.channel, channelOrder),
    byRoom: compare<RoomKind>(posts, (p) => p.roomKind, ["FOLLOWERS", "SMALL_ROOM"]),
    posts: posts.slice(0, MAX_POSTS_LISTED),
    aiUsage: input.aiUsage,
    minPostsToCompare: MIN_POSTS_TO_COMPARE,
  };
}
