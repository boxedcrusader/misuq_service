import { ConfigService } from "@nestjs/config";
import { loadAuthConfig } from "./auth.config";

const A = "a".repeat(32);
const B = "b".repeat(32);

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("loadAuthConfig (boot-time validation)", () => {
  it("loads both secrets and defaults the TTLs", () => {
    expect(loadAuthConfig(config({ JWT_ACCESS_SECRET: A, JWT_REFRESH_SECRET: B }))).toEqual({
      accessSecret: A,
      refreshSecret: B,
      accessTtlSeconds: 900,
      refreshTtlSeconds: 2592000,
    });
  });

  it("refuses to start with a missing secret -- no fallback value", () => {
    expect(() => loadAuthConfig(config({ JWT_REFRESH_SECRET: B }))).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadAuthConfig(config({ JWT_ACCESS_SECRET: A }))).toThrow(/JWT_REFRESH_SECRET/);
  });

  it("refuses a short secret", () => {
    expect(() => loadAuthConfig(config({ JWT_ACCESS_SECRET: "short", JWT_REFRESH_SECRET: B }))).toThrow(
      /at least 32/,
    );
  });

  it("refuses identical access and refresh secrets", () => {
    expect(() => loadAuthConfig(config({ JWT_ACCESS_SECRET: A, JWT_REFRESH_SECRET: A }))).toThrow(/different/);
  });

  it("reads TTL overrides and rejects junk ones", () => {
    const ok = loadAuthConfig(
      config({ JWT_ACCESS_SECRET: A, JWT_REFRESH_SECRET: B, JWT_ACCESS_TTL_SECONDS: "60", JWT_REFRESH_TTL_SECONDS: "120" }),
    );
    expect(ok.accessTtlSeconds).toBe(60);
    expect(ok.refreshTtlSeconds).toBe(120);
    expect(() =>
      loadAuthConfig(config({ JWT_ACCESS_SECRET: A, JWT_REFRESH_SECRET: B, JWT_ACCESS_TTL_SECONDS: "-5" })),
    ).toThrow(/positive integer/);
  });
});
