import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function isAuthorized(request: IncomingMessage, appToken: string | undefined): boolean {
  if (!appToken) return true;
  const header = request.headers.authorization ?? "";
  const presented = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(appToken);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
