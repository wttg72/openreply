import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  acceptPendingInvitationsForUser,
  readActiveWorkspaceId,
  resolveWorkspaceForUser,
} from "@/lib/workspace";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  await acceptPendingInvitationsForUser(session.user.id, session.user.email);
  const resolution = await resolveWorkspaceForUser(
    session.user.id,
    await readActiveWorkspaceId(session.user.id)
  );
  if (resolution.status !== "resolved") {
    redirect("/workspace");
  }
  const { workspace } = resolution;
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { connectedAt: "desc" },
    select: { username: true },
  });

  return (
    <DashboardShell
      workspaceName={workspace.name}
      instagramUsername={accounts[0]?.username ?? null}
      instagramAccountCount={accounts.length}
    >
      {children}
    </DashboardShell>
  );
}
