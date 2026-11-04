import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateAudienceDto } from "./update-audience.dto";

// Same options as main.ts's global ValidationPipe.
const check = (body: object) =>
  validate(plainToInstance(UpdateAudienceDto, body), { whitelist: true, forbidNonWhitelisted: true });

describe("UpdateAudienceDto", () => {
  it("lets a room grow or be renamed", async () => {
    expect(await check({ size: 50, name: "Beta list" })).toHaveLength(0);
  });

  it("refuses to change a room's type: signals snapshot it, so it's fixed once created", async () => {
    const errors = await check({ type: "X_FOLLOWERS" });
    expect(errors.map((e) => e.property)).toContain("type");
  });
});
