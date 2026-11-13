import { cookies } from "next/headers";
import { prisma } from "@/lib/db/client";
import type { Workspace, WorkspaceRole } from "@/app/generated/prisma/client";

function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function acceptPendingInvitationsForUser(
  userId: string,
  email?: string | null
): Promise<void> {
  if (!email) return;

  const normalizedEmail = normalizeInviteEmail(email);
  const now = new Date();
  const invitations = await prisma.workspaceInvitation.findMany({
    where: {
      email: normalizedEmail,
      status: "PENDING",
      expiresAt: { gt: now },
    },
  });

  for (const invitation of invitations) {
    await prisma.$transaction([
      prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: invitation.workspaceId,
            userId,
          },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
        update: {
          role: invitation.role,
        },
      }),
      prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: now,
        },
      }),
    ]);
  }
}

export type WorkspaceResolution =
  | { status: "resolved"; workspace: Workspace; role: WorkspaceRole }
  // Every membership is in a workspace someone else owns, and no valid
  // choice is saved: the user has to pick one.
  | { status: "choose" };

// The choice lives in a cookie so it needs no schema change. The user id is
// part of the value, so a second person signing in on the same browser does
// not inherit the first person's workspace.
export const ACTIVE_WORKSPACE_COOKIE = "openreply-workspace";

export function encodeActiveWorkspace(userId: string, workspaceId: string) {
  return `${userId}:${workspaceId}`;
}

export function decodeActiveWorkspace(
  value: string | undefined,
  userId: string
): string | null {
  const [cookieUserId, workspaceId] = value?.split(":") ?? [];
  return cookieUserId === userId && workspaceId ? workspaceId : null;
}

export async function readActiveWorkspaceId(userId: string): Promise<string | null> {
  const store = await cookies();
  return decodeActiveWorkspace(store.get(ACTIVE_WORKSPACE_COOKIE)?.value, userId);
}

function listMemberships(userId: string) {
  return prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
}

function createOwnWorkspace(userId: string, email?: string | null) {
  const workspaceName = email ? `${email.split("@")[0]}'s workspace` : "My workspace";

  return prisma.workspace.create({
    data: {
      name: workspaceName,
      ownerId: userId,
      members: {
        create: {
          userId,
          role: "OWNER",
        },
      },
    },
  });
}

/**
 * Which workspace a request acts in. The order is: the workspace the user
 * chose, if they are still a member; otherwise their own oldest workspace.
 * A workspace someone else owns is never picked by fallback. It holds that
 * owner's Instagram accounts and messages, so opening it has to be the
 * user's explicit choice. With no membership at all, pending invitations are
 * accepted and, if none exist, the user gets a workspace of their own.
 */
export async function resolveWorkspaceForUser(
  userId: string,
  chosenWorkspaceId: string | null
): Promise<WorkspaceResolution> {
  let memberships = await listMemberships(userId);

  if (memberships.length === 0) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    await acceptPendingInvitationsForUser(userId, user?.email);
    memberships = await listMemberships(userId);

    if (memberships.length === 0) {
      const workspace = await createOwnWorkspace(userId, user?.email);
      return { status: "resolved", workspace, role: "OWNER" };
    }
  }

  const membership =
    memberships.find((m) => m.workspaceId === chosenWorkspaceId) ??
    memberships.find((m) => m.workspace.ownerId === userId);

  if (!membership) return { status: "choose" };

  return {
    status: "resolved",
    workspace: membership.workspace,
    role: membership.role,
  };
}

/** Runs once, when the account is created. */
export async function ensureWorkspaceForUser(
  userId: string,
  email?: string | null
): Promise<void> {
  await acceptPendingInvitationsForUser(userId, email);

  const existing = await prisma.workspaceMember.findFirst({ where: { userId } });
  if (!existing) {
    await createOwnWorkspace(userId, email);
  }
}
