import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

// JwtAuthGuard is registered globally (APP_GUARD in AuthModule), so every
// route is authenticated by default and a route must opt OUT explicitly.
// Secure-by-default: a new controller that forgets a decorator is locked,
// not open.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
