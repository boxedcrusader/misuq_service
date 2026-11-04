import { Channel } from "@prisma/client";
import { toDraftInput } from "./draft-input";

describe("toDraftInput", () => {
  it("passes the story, voice and name through, with a missing title as undefined", () => {
    expect(
      toDraftInput({
        rawCapture: "Shipped CSV export.",
        title: null,
        channel: Channel.X,
        voiceProfile: { styleSample: "short and dry" },
        founderName: "Ada",
      }),
    ).toEqual({
      rawCapture: "Shipped CSV export.",
      title: undefined,
      channel: Channel.X,
      voice: { styleSample: "short and dry" },
      founderName: "Ada",
    });
  });

  it("keeps a founder with no voice profile or name on the prompt's no-voice / no-name branches", () => {
    const input = toDraftInput({ rawCapture: "x", title: "T", channel: Channel.EMAIL, voiceProfile: null, founderName: null });
    expect(input.voice).toBeNull();
    expect(input.founderName).toBeNull();
    expect(input.title).toBe("T");
  });
});
