import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { isAllowedEmail } from "../lib/auth";

const ORIGINAL = process.env.ALLOWED_EMAILS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ALLOWED_EMAILS;
  else process.env.ALLOWED_EMAILS = ORIGINAL;
});

describe("isAllowedEmail", () => {
  it("admits every address on the list", () => {
    process.env.ALLOWED_EMAILS = "allowed@example.com,also-allowed@example.com";
    expect(isAllowedEmail("allowed@example.com")).toBe(true);
    expect(isAllowedEmail("also-allowed@example.com")).toBe(true);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    // Spaces after the comma are what a hand-edit in the Vercel UI leaves behind.
    process.env.ALLOWED_EMAILS = "  ALLOWED@Example.com , also-allowed@EXAMPLE.com  ";
    expect(isAllowedEmail("allowed@example.com")).toBe(true);
    expect(isAllowedEmail(" Also-Allowed@Example.COM ")).toBe(true);
  });

  it("refuses an address that is not on the list", () => {
    process.env.ALLOWED_EMAILS = "allowed@example.com,also-allowed@example.com";
    expect(isAllowedEmail("delivered@resend.dev")).toBe(false);
    expect(isAllowedEmail("attacker@example.com")).toBe(false);
    // Substring and suffix lookalikes must not slip through.
    expect(isAllowedEmail("allowed@example.com.evil.com")).toBe(false);
    expect(isAllowedEmail("evil+allowed@example.com")).toBe(false);
  });

  it("fails closed when the list is unset, empty, or only separators", () => {
    delete process.env.ALLOWED_EMAILS;
    expect(isAllowedEmail("allowed@example.com")).toBe(false);
    expect(isAllowedEmail("also-allowed@example.com")).toBe(false);

    for (const empty of ["", "   ", ",", " , , "]) {
      process.env.ALLOWED_EMAILS = empty;
      expect(isAllowedEmail("allowed@example.com")).toBe(false);
      expect(isAllowedEmail("also-allowed@example.com")).toBe(false);
    }
  });

  it("refuses a missing or blank address even with a populated list", () => {
    process.env.ALLOWED_EMAILS = "allowed@example.com,also-allowed@example.com";
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail("   ")).toBe(false);
  });
});
