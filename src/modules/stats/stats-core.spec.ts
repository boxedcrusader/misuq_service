import { AudienceType, Channel } from "@prisma/client";
import { computeFounderStats, median, OutcomeInput, repliesPer1kViews, roomKindOf } from "./stats-core";

const USAGE = { drafts: { used: 4, limit: 30 }, reportBacks: { used: 1, limit: 30 } };
let n = 0;
function outcome(partial: Partial<OutcomeInput>): OutcomeInput {
  n += 1;
  return {
    storyId: `s${n}`,
    title: null,
    rawCapture: `Update ${n}`,
    channel: Channel.X,
    audienceType: AudienceType.X_FOLLOWERS,
    roomSize: 1000,
    sentiment: null,
    reportedAt: new Date("2026-11-04T12:00:00Z"),
    views: null,
    replies: null,
    signups: null,
    likes: null,
    reposts: null,
    quotes: null,
    bookmarks: null,
    shares: null,
    newFollowers: null,
    ...partial,
  };
}

describe("stats-core", () => {
  it("rates replies per 1,000 views, and has no rate without both", () => {
    expect(repliesPer1kViews(2000, 9)).toBe(4.5);
    expect(repliesPer1kViews(null, 9)).toBeNull();
    expect(repliesPer1kViews(2000, null)).toBeNull();
    expect(repliesPer1kViews(0, 3)).toBeNull();
  });

  it("takes the median, odd and even", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("counts records from before room types were snapshotted as small rooms", () => {
    expect(roomKindOf(null)).toBe("SMALL_ROOM");
    expect(roomKindOf(AudienceType.LINKEDIN_NETWORK)).toBe("FOLLOWERS");
    expect(roomKindOf(AudienceType.EMAIL_LIST)).toBe("SMALL_ROOM");
  });

  it("says 'too early' below 3 rated posts: no usual, no above/below, no comparisons", () => {
    const stats = computeFounderStats({
      statusCounts: { REPORTED: 2 },
      outcomes: [outcome({ views: 1000, replies: 5 }), outcome({ views: 2000, replies: 2 })],
      aiUsage: USAGE,
    });
    expect(stats.yourUsual).toEqual({ repliesPer1kViews: null, basedOn: 2, enoughData: false });
    expect(stats.posts.every((p) => p.aboveYourUsual === null)).toBe(true);
    expect(stats.byFormat).toEqual([{ key: "X", posts: 2, rated: 2, repliesPer1kViews: null, enoughData: false }]);
    // Two rated posts are enough to name a best one.
    expect(stats.best?.repliesPer1kViews).toBe(5);
  });

  it("compares each post with the founder's own usual once there are 3", () => {
    const stats = computeFounderStats({
      statusCounts: {},
      outcomes: [
        outcome({ views: 1000, replies: 9 }), // 9
        outcome({ views: 1000, replies: 3 }), // 3
        outcome({ views: 1000, replies: 5 }), // 5 = the usual
        outcome({ views: null, replies: 4 }), // no rate
      ],
      aiUsage: USAGE,
    });
    expect(stats.yourUsual).toEqual({ repliesPer1kViews: 5, basedOn: 3, enoughData: true });
    expect(stats.posts.map((p) => p.aboveYourUsual)).toEqual([true, false, false, null]);
    expect(stats.best?.repliesPer1kViews).toBe(9);
  });

  it("splits by format and by kind of room, each with its own 3-post minimum", () => {
    const stats = computeFounderStats({
      statusCounts: {},
      outcomes: [
        outcome({ views: 1000, replies: 2 }),
        outcome({ views: 1000, replies: 4 }),
        outcome({ views: 1000, replies: 6 }),
        outcome({ channel: Channel.EMAIL, audienceType: AudienceType.EMAIL_LIST, views: 100, replies: 5 }),
      ],
      aiUsage: USAGE,
    });
    expect(stats.byFormat).toEqual([
      { key: "X", posts: 3, rated: 3, repliesPer1kViews: 4, enoughData: true },
      { key: "EMAIL", posts: 1, rated: 1, repliesPer1kViews: null, enoughData: false },
    ]);
    expect(stats.byRoom.map((r) => [r.key, r.enoughData])).toEqual([
      ["FOLLOWERS", true],
      ["SMALL_ROOM", false],
    ]);
  });

  it("totals only what was reported: never shows 0 for something nobody said", () => {
    const stats = computeFounderStats({
      statusCounts: { CAPTURED: 1, GRADUATED: 1 },
      outcomes: [outcome({ views: 1400, quotes: 3, bookmarks: 0 }), outcome({ views: 600, quotes: 1 })],
      aiUsage: USAGE,
    });
    expect(stats.totals).toMatchObject({ reports: 2, views: 2000, quotes: 4, bookmarks: 0, likes: null, newFollowers: null });
    expect(stats.pipeline).toMatchObject({ CAPTURED: 1, DRAFTED: 0, GRADUATED: 1, ARCHIVED: 0 });
    expect(stats.aiUsage).toEqual(USAGE);
  });

  it("labels a post by its title, else a trimmed excerpt of the update", () => {
    const long = "word ".repeat(40);
    const stats = computeFounderStats({
      statusCounts: {},
      outcomes: [outcome({ title: "Passkeys" }), outcome({ rawCapture: long })],
      aiUsage: USAGE,
    });
    expect(stats.posts[0].label).toBe("Passkeys");
    expect(stats.posts[1].label.length).toBeLessThanOrEqual(78);
    expect(stats.posts[1].label.endsWith("…")).toBe(true);
  });
});
