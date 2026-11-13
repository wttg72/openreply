import type { Workspace, WorkspaceRole } from "@/app/generated/prisma/client";
import { getCurrentUserId } from "@/lib/auth";
import { readActiveWorkspaceId, resolveWorkspaceForUser } from "@/lib/workspace";

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  workspace: Workspace;
  role: WorkspaceRole;
};

const ROLE_ORDER: Record<WorkspaceRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasWorkspaceRole(
  role: WorkspaceRole,
  minimumRole: WorkspaceRole
) {
  return ROLE_ORDER[role] >= ROLE_ORDER[minimumRole];
}

export function canManageWorkspace(role: WorkspaceRole) {
  return hasWorkspaceRole(role, "ADMIN");
}

export function canManageBilling(role: WorkspaceRole) {
  return role === "OWNER";
}

export async function getCurrentWorkspaceContext(): Promise<WorkspaceContext | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const resolution = await resolveWorkspaceForUser(
    userId,
    await readActiveWorkspaceId(userId)
  );
  if (resolution.status !== "resolved") return null;

  return {
    userId,
    workspaceId: resolution.workspace.id,
    workspace: resolution.workspace,
    role: resolution.role,
  };
}
