import { ExecutionContext, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import { AuthRequest } from "../auth/auth.types";

// Returns the authenticated user's id, as set by the global JwtAuthGuard
// from a verified access token. Kept returning a plain id string (not the
// whole user object) so every existing `@CurrentUser() userId: string` call
// site stayed unchanged when this replaced the old x-user-id header
// stand-in.
//
// If request.user is missing, the route is @Public() but still asked for a
// user -- a programming error, but it fails closed as a 401 rather than
// handing a service an undefined id.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<AuthRequest>();
  if (!request.user) {
    throw new UnauthorizedException("Not authenticated");
  }
  return request.user.id;
});
