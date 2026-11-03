import { rejectNulBytes } from "./reject-nul-bytes.middleware";

function run(req: { originalUrl: string; body?: unknown }) {
  let status: number | undefined;
  let nexted = false;
  rejectNulBytes(req, { status: (c: number) => ((status = c), { json: () => undefined }) }, () => (nexted = true));
  return { status, nexted };
}

describe("rejectNulBytes", () => {
  it("passes ordinary requests through", () => {
    expect(run({ originalUrl: "/stories?page=1", body: { rawCapture: "Shipped dark mode ✨", nested: [{ a: "ok" }] } })).toEqual({
      status: undefined,
      nexted: true,
    });
  });

  it.each([
    ["a NUL in a body string", { originalUrl: "/stories", body: { rawCapture: "a\u0000b" } }],
    ["a NUL deep in nested arrays/objects", { originalUrl: "/x", body: { a: [{ b: ["ok", "x\u0000"] }] } }],
    ["a NUL in a body key", { originalUrl: "/x", body: { "ke\u0000y": "v" } }],
    ["%00 in the path (ids reach Prisma)", { originalUrl: "/stories/abc%00def" }],
    ["%00 in the query string", { originalUrl: "/stories?page=1%00" }],
  ])("400s on %s (pentest: used to 500)", (_label, req) => {
    expect(run(req)).toEqual({ status: 400, nexted: false });
  });
});
