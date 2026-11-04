import { Channel } from "@prisma/client";
import { IsIn, IsOptional } from "class-validator";
import { DRAFT_CHANNELS } from "../drafting/draft-core";

// POST /stories/:id/draft. Optional so existing clients (no body) keep
// getting an email draft.
export class DraftStoryDto {
  @IsOptional()
  @IsIn(DRAFT_CHANNELS)
  channel?: Channel;
}
