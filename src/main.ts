import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { rejectNulBytes } from "./common/http/reject-nul-bytes.middleware";

// Comma-separated allowed browser origins. Defaults to client/web's dev
// server; production sets CORS_ORIGIN to the deployed web URL(s).
function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? "http://localhost:3001";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

// How many reverse-proxy hops to trust for the client IP (req.ip), which the
// rate limiter keys on. Unset locally (no proxy). Too low = every user shares
// the proxy's IP (limits trip early, but safely); too high = clients can spoof
// X-Forwarded-For to dodge limits — so it's an explicit hop count, never `true`.
function trustProxyHops(): number | false {
  const hops = Number.parseInt(process.env.TRUST_PROXY ?? "", 10);
  return Number.isSafeInteger(hops) && hops > 0 ? hops : false;
}

async function bootstrap() {
  // Nest's default body parsers are replaced below (bodyParser: false) so the
  // JSON parser can be configured — see the pentest notes on body-parser.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.set("trust proxy", trustProxyHops());
  // Express's default "extended" query parser is `qs`, which has open DoS
  // advisories (2026-11-03 audit). This API only reads flat ?page=/?limit=,
  // so Node's built-in querystring is enough and keeps qs off request data.
  app.set("query parser", "simple");

  // Standard security headers; also removes X-Powered-By.
  app.use(helmet());

  // JSON only (no urlencoded parser — nothing here accepts form posts, and it
  // would pull qs back in). inflate: false rejects compressed request bodies,
  // closing body-parser's compressed-body DoS (GHSA-27r3-jxmh-p828) until the
  // NestJS major upgrade brings a patched body-parser. Explicit limit, since an
  // invalid limit value silently disables size enforcement (GHSA-v422-hmwv-36x6).
  app.useBodyParser("json", { limit: "100kb", inflate: false });
  app.use(rejectNulBytes);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // Authorization carries the bearer access token (JwtAuthGuard), so it must
  // be in allowedHeaders alongside content-type or the browser preflight
  // rejects it. No `credentials: true`: tokens travel in the header/body, not
  // cookies.
  app.enableCors({
    origin: corsOrigins(),
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
