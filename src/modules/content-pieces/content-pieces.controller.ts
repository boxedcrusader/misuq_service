import { Body, Controller, Delete, HttpCode, Param, Patch } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ContentPiecesService } from "./content-pieces.service";
import { UpdateContentPieceDto } from "./dto/update-content-piece.dto";

@Controller("content-pieces")
export class ContentPiecesController {
  constructor(private readonly contentPiecesService: ContentPiecesService) {}

  @Patch(":id")
  updateBody(@Param("id") id: string, @Body() dto: UpdateContentPieceDto, @CurrentUser() userId: string) {
    return this.contentPiecesService.updateBody(id, dto, userId);
  }

  @Delete(":id")
  @HttpCode(204)
  deletePiece(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.contentPiecesService.deletePiece(id, userId);
  }
}
