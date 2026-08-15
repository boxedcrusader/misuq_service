import { Module } from "@nestjs/common";
import { ContentPiecesController } from "./content-pieces.controller";
import { ContentPiecesService } from "./content-pieces.service";

@Module({
  controllers: [ContentPiecesController],
  providers: [ContentPiecesService],
})
export class ContentPiecesModule {}
