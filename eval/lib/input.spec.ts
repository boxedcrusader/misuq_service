import * as fs from "node:fs";
import * as path from "node:path";
import { validateInput } from "./input";

const example = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates.example.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(example));
const errorsOf = (data: unknown) => {
  const v = validateInput(data);
  return v.ok ? [] : v.errors;
};

describe("validateInput", () => {
  it("accepts the committed example file", () => {
    expect(validateInput(example).ok).toBe(true);
  });

  it("needs at least 5 updates", () => {
    const d = clone();
    d.updates = d.updates.slice(0, 4);
    expect(errorsOf(d).join()).toMatch(/at least 5 updates \(got 4\)/);
  });

  it("needs at least 3 distinct types", () => {
    const d = clone();
    for (const u of d.updates) u.type = "launch";
    expect(errorsOf(d).join()).toMatch(/at least 3 distinct types \(got 1: launch\)/);
  });

  it("needs every update's founderVersion", () => {
    const d = clone();
    delete d.updates[2].founderVersion;
    d.updates[3].founderVersion = "   ";
    const errs = errorsOf(d).join("\n");
    expect(errs).toMatch(/"u3".*founderVersion/);
    expect(errs).toMatch(/"u4".*founderVersion/);
  });

  it("only allows formats production can draft", () => {
    const d = clone();
    d.updates[0].format = "discord";
    d.updates[1].format = "X";
    const errs = errorsOf(d).join("\n");
    expect(errs).toMatch(/"u1".*"format" must be one of x, linkedin, email/);
    expect(errs).toMatch(/"u2".*"format"/);
  });

  it("rejects unknown types, duplicate ids, a missing judge or voice sample, all at once", () => {
    const d = clone();
    d.updates[0].type = "feature";
    d.updates[1].id = d.updates[0].id;
    delete d.judge;
    d.voiceSample = "";
    const errs = errorsOf(d);
    expect(errs.join("\n")).toMatch(/"type" must be one of launch, bugfix, lesson/);
    expect(errs.join("\n")).toMatch(/duplicate id/);
    expect(errs.join("\n")).toMatch(/"judge"/);
    expect(errs.join("\n")).toMatch(/"voiceSample"/);
    expect(errs.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects something that isn't the right shape at all", () => {
    expect(errorsOf([]).join()).toMatch(/JSON object/);
    expect(errorsOf({ judge: "j", voiceSample: "v", updates: "nope" }).join()).toMatch(/"updates" must be an array/);
  });
});
