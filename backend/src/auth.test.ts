import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { isAuthorized } from "./auth";

const request = (authorization?: string) => ({ headers: { authorization } }) as IncomingMessage;

describe("isAuthorized", () => {
  it("lets everything through when no app token is configured", () => {
    expect(isAuthorized(request(), undefined)).toBe(true);
  });

  it("accepts only the exact bearer token", () => {
    expect(isAuthorized(request("Bearer s3cret"), "s3cret")).toBe(true);
    expect(isAuthorized(request("Bearer wrong!"), "s3cret")).toBe(false);
    expect(isAuthorized(request("Bearer s3cre"), "s3cret")).toBe(false);
    expect(isAuthorized(request(), "s3cret")).toBe(false);
  });
});
