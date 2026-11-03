import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateAudienceDto } from "./dto/create-audience.dto";
import { UpdateAudienceDto } from "./dto/update-audience.dto";

interface PaginationParams {
  page?: number;
  limit?: number;
}

// No delete, on purpose: Send.audience is onDelete: Restrict to protect
// frozen send history (schema.prisma), and the founder doesn't need one to
// finish the loop. Add it with a 409-on-has-sends rule if it's ever needed.
//
// No per-plan audience limit yet either (README §6: STARTER = 1 email list),
// because every account is DRAFT_ONLY until billing exists — enforcing it now
// would block everyone.
@Injectable()
export class AudiencesService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateAudienceDto) {
    return this.prisma.audience.create({ data: { userId, ...dto } });
  }

  async findAll(userId: string, { page = 1, limit = 50 }: PaginationParams) {
    const skip = (page - 1) * limit;
    const where = { userId };
    const [data, total] = await Promise.all([
      this.prisma.audience.findMany({ where, orderBy: { createdAt: "asc" }, skip, take: limit }),
      this.prisma.audience.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, userId: string) {
    const audience = await this.prisma.audience.findUnique({ where: { id } });
    // Another founder's audience 404s rather than 403s — same as every other
    // module here, so ids can't be probed for existence.
    if (!audience || audience.userId !== userId) {
      throw new NotFoundException(`Audience ${id} not found`);
    }
    return audience;
  }

  async update(id: string, userId: string, dto: UpdateAudienceDto) {
    await this.findOne(id, userId);
    return this.prisma.audience.update({ where: { id }, data: dto });
  }
}
