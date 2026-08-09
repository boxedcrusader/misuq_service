import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Scoped to the one origin that needs it (client/web's dev server) rather
  // than left fully permissive -- this is the seam being proven, not a
  // general-purpose public API yet. x-user-id is the current auth stand-in
  // (current-user.decorator.ts), so it must be in allowedHeaders alongside
  // content-type or the browser preflight rejects it before the request
  // ever reaches the handler.
  app.enableCors({
    origin: "http://localhost:3001",
    allowedHeaders: ["Content-Type", "x-user-id"],
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
