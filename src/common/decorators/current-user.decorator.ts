import { BadRequestException, ExecutionContext, createParamDecorator } from "@nestjs/common";

// TODO: replace with real auth. No JwtAuthGuard exists yet in this repo, so
// this reads userId from a plain header instead of a verified token/session.
// Once JwtAuthGuard + a real @CurrentUser exist, swap this decorator's
// implementation to pull userId from the authenticated request (e.g.
// req.user.id) and guard consuming controllers with @UseGuards(JwtAuthGuard).
// Nothing about the call sites (`@CurrentUser() userId: string`) should need
// to change when that happens.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const userId = request.headers["x-user-id"];
  if (!userId || typeof userId !== "string") {
    throw new BadRequestException(
      "Missing x-user-id header (temporary stand-in for auth — see TODO in current-user.decorator.ts)",
    );
  }
  return userId;
});
