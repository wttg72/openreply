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
    process.env.ALLOWED_EMAILS = "wttg72@gmail.com,admin@haio.sg";
    expect(isAllowedEmail("wttg72@gmail.com")).toBe(true);
    expect(isAllowedEmail("admin@haio.sg")).toBe(true);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    // Spaces after the comma are what a hand-edit in the Vercel UI leaves behind.
    process.env.ALLOWED_EMAILS = "  WTTG72@Gmail.com , admin@HAIO.sg  ";
    expect(isAllowedEmail("wttg72@gmail.com")).toBe(true);
    expect(isAllowedEmail(" Admin@Haio.SG ")).toBe(true);
  });

  it("refuses an address that is not on the list", () => {
    process.env.ALLOWED_EMAILS = "wttg72@gmail.com,admin@haio.sg";
    expect(isAllowedEmail("delivered@resend.dev")).toBe(false);
    expect(isAllowedEmail("attacker@example.com")).toBe(false);
    // Substring and suffix lookalikes must not slip through.
    expect(isAllowedEmail("wttg72@gmail.com.evil.com")).toBe(false);
    expect(isAllowedEmail("evil+wttg72@gmail.com")).toBe(false);
  });

  it("fails closed when the list is unset, empty, or only separators", () => {
    delete process.env.ALLOWED_EMAILS;
    expect(isAllowedEmail("wttg72@gmail.com")).toBe(false);
    expect(isAllowedEmail("admin@haio.sg")).toBe(false);

    for (const empty of ["", "   ", ",", " , , "]) {
      process.env.ALLOWED_EMAILS = empty;
      expect(isAllowedEmail("wttg72@gmail.com")).toBe(false);
      expect(isAllowedEmail("admin@haio.sg")).toBe(false);
    }
  });

  it("refuses a missing or blank address even with a populated list", () => {
    process.env.ALLOWED_EMAILS = "wttg72@gmail.com,admin@haio.sg";
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail("   ")).toBe(false);
  });
});
