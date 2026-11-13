"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { ACTIVE_WORKSPACE_COOKIE, encodeActiveWorkspace } from "@/lib/workspace";

export async function selectWorkspace(formData: FormData) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const workspaceId = formData.get("workspaceId");
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new Error("Missing workspace");
  }

  // Only a workspace the user belongs to can be chosen.
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  });
  if (!membership) throw new Error("Not a member of this workspace");

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, encodeActiveWorkspace(userId, workspaceId), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/dashboard");
}
