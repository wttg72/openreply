import NextAuth, { type NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import {
  ensureWorkspaceForUser,
  readActiveWorkspaceId,
  resolveWorkspaceForUser,
} from "@/lib/workspace";

type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

/**
 * Sign-in allowlist. `ALLOWED_EMAILS` is a comma-separated list; each entry is
 * trimmed and compared case-insensitively. An unset or empty list denies
 * everyone -- an absent allowlist is a closed door, never an open one.
 */
export function isAllowedEmail(email?: string | null): boolean {
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const candidate = (email ?? "").trim().toLowerCase();
  return candidate !== "" && allowed.includes(candidate);
}

export const authConfig = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "missing-resend-api-key",
      from: process.env.EMAIL_FROM ?? "OpenReply <login@example.com>",
    }),
  ],
  callbacks: {
    // Runs before the magic link is generated, so a rejected address never
    // gets an email, a VerificationToken row, or a User row.
    async signIn({ user }) {
      return isAllowedEmail(user?.email);
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await ensureWorkspaceForUser(user.id, user.email);
      }
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  session: {
    strategy: "database",
  },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const resolution = await resolveWorkspaceForUser(
    userId,
    await readActiveWorkspaceId(userId)
  );
  return resolution.status === "resolved" ? resolution.workspace.id : null;
}
