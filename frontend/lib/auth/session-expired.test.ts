import { describe, expect, it } from "vitest";
import {
  SESSION_EXPIRED_MESSAGE,
  loginPathWithSessionExpired,
  readSessionExpiredMessage,
} from "./session-expired";

describe("loginPathWithSessionExpired", () => {
  it("builds a /login path carrying the session-expired flag", () => {
    expect(loginPathWithSessionExpired()).toBe("/login?session_expired=1");
  });
});

describe("readSessionExpiredMessage", () => {
  it("returns the message when the session_expired param is set", () => {
    const params = new URLSearchParams("session_expired=1");
    expect(readSessionExpiredMessage(params)).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("returns null when the param is absent", () => {
    expect(readSessionExpiredMessage(new URLSearchParams())).toBeNull();
  });

  it("returns null when the param has an unexpected value", () => {
    const params = new URLSearchParams("session_expired=maybe");
    expect(readSessionExpiredMessage(params)).toBeNull();
  });
});
