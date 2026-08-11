import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETED_MESSAGE,
  loginPathWithAccountDeleted,
  readAccountDeletedMessage,
} from "./account-deleted";

describe("loginPathWithAccountDeleted", () => {
  it("builds a /login path carrying the account-deleted flag", () => {
    expect(loginPathWithAccountDeleted()).toBe("/login?account_deleted=1");
  });
});

describe("readAccountDeletedMessage", () => {
  it("returns the message when the account_deleted param is set", () => {
    const params = new URLSearchParams("account_deleted=1");
    expect(readAccountDeletedMessage(params)).toBe(ACCOUNT_DELETED_MESSAGE);
  });

  it("returns null when the param is absent", () => {
    expect(readAccountDeletedMessage(new URLSearchParams())).toBeNull();
  });

  it("returns null when the param has an unexpected value", () => {
    const params = new URLSearchParams("account_deleted=maybe");
    expect(readAccountDeletedMessage(params)).toBeNull();
  });
});
