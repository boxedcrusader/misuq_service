import { PartialType } from "@nestjs/mapped-types";
import { CreateAudienceDto } from "./create-audience.dto";

// Lists grow: updating size is the common case. Safe for history, since every
// Send froze its own audienceSizeSnapshot at send time.
export class UpdateAudienceDto extends PartialType(CreateAudienceDto) {}
