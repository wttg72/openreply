import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { selectWorkspace } from "@/lib/workspace-actions";

export const metadata: Metadata = {
  title: "Choose a workspace - OpenReply",
  robots: { index: false, follow: false },
};

export default async function ChooseWorkspacePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, workspace: { select: { id: true, name: true } } },
  });
  // No membership: the dashboard creates the user's own workspace.
  if (memberships.length === 0) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-12">
        <section className="border border-white/10 bg-white/[0.035] p-8">
          <h1 className="text-3xl font-black leading-tight text-white">
            Choose a workspace
          </h1>
          <p className="mt-4 text-sm leading-6 text-zinc-400">
            Everyone in a workspace can read and reply to the Instagram messages of every account connected to it.
          </p>
          <ul className="mt-8 space-y-3">
            {memberships.map(({ role, workspace }) => (
              <li key={workspace.id}>
                <form action={selectWorkspace}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between border border-white/10 px-4 py-3 text-left text-sm text-white hover:bg-white/[0.06]"
                  >
                    <span>Open {workspace.name}</span>
                    <span className="text-xs text-zinc-400">{role.toLowerCase()}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
