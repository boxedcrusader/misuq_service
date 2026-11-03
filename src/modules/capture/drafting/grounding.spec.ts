import { findUngroundedNumbers } from "./grounding";

describe("findUngroundedNumbers", () => {
  it("flags numbers the draft introduced (the live fabrication cases)", () => {
    const capture = "Quiet week. Mostly fixed bugs and answered support emails.";
    const draft = "I spent five days on a leak; fixing it took twenty minutes at 4:00 AM, and 3 people hit it.";
    expect(findUngroundedNumbers(draft, [capture])).toEqual(["4:00", "3", "five", "twenty"]);
  });

  it("grounds numbers the founder wrote, in either digits or words", () => {
    const capture = "Took 14 months to hit 100 customers. 2 of 40 trials churned.";
    const draft = "Fourteen months. Our 100th customer. Two of forty trials churned.";
    expect(findUngroundedNumbers(draft, [capture])).toEqual([]);
  });

  it("reads compound and hyphenated number words as one value", () => {
    expect(findUngroundedNumbers("Twelve hundred users hit it.", ["1,200 users hit it"])).toEqual([]);
    expect(findUngroundedNumbers("thirty-eight converted", ["38 converted"])).toEqual([]);
    expect(findUngroundedNumbers("two thousand signups", ["2000 signups"])).toEqual([]);
  });

  it("normalizes commas, k-suffixes, percents and ordinals", () => {
    expect(findUngroundedNumbers("~4k views, a 70% cut, 1200 users", ["4000 views, 70 percent, 1,200 users"])).toEqual([]);
    expect(findUngroundedNumbers("We finished #4 of the day", ["finished #4"])).toEqual([]);
  });

  it("catches wrong arithmetic: a derived number the founder never stated", () => {
    // Live case: "$19 to $29" drafted as "Twenty bucks isn't a massive jump".
    expect(findUngroundedNumbers("Twenty bucks isn't a massive jump", ["Raised prices from $19 to $29/mo"])).toEqual([
      "twenty",
    ]);
  });

  it("never checks 'one' (too common in plain English to signal anything)", () => {
    expect(findUngroundedNumbers("No one noticed; the one thing that mattered.", ["shipped it"])).toEqual([]);
  });

  it("grounds against every source given (title, founder name)", () => {
    expect(findUngroundedNumbers("v2 is out", ["Shipped it", "v2 launch"])).toEqual([]);
  });
});
