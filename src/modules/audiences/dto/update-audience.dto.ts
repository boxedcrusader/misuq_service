import { OmitType, PartialType } from "@nestjs/mapped-types";
import { CreateAudienceDto } from "./create-audience.dto";

// Lists grow: updating size is the common case. Safe for history, since every
// Send froze its own audienceSizeSnapshot at send time.
//
// `type` is NOT updatable (2026-11-04): report-back snapshots Audience.type
// into SignalRecord.audienceTypeSnapshot, which is only honest if a room's
// kind never changes after something was sent to it. An email list doesn't
// become X followers — that's a new room.
export class UpdateAudienceDto extends PartialType(OmitType(CreateAudienceDto, ["type"] as const)) {}
