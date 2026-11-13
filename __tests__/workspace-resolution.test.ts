import { beforeEach, describe, expect, it, vi } from "vitest";

// A small in-memory stand-in for the three tables workspace resolution reads.
const db = vi.hoisted(() => {
  type Workspace = { id: string; name: string; ownerId: string };
  type Member = { id: string; workspaceId: string; userId: string; role: "OWNER" | "ADMIN" | "MEMBER"; createdAt: Date };
  const state = {
    workspaces: [] as Workspace[],
    members: [] as Member[],
    invitations: [] as { id: string; workspaceId: string; email: string; role: "ADMIN" | "MEMBER"; status: string; expiresAt: Date }[],
  };
  const withWorkspace = (m: Member) => ({ ...m, workspace: state.workspaces.find((w) => w.id === m.workspaceId)! });
  const byUser = (userId: string) =>
    state.members.filter((m) => m.userId === userId).sort((a, b) => +a.createdAt - +b.createdAt);
  const prisma = {
    user: { findUnique: async ({ where }: { where: { id: string } }) => ({ email: `${where.id}@example.test` }) },
    workspaceInvitation: {
      findMany: async ({ where }: { where: { email: string } }) =>
        state.invitations.filter((i) => i.email === where.email && i.status === "PENDING"),
      update: ({ where }: { where: { id: string } }) => ({ op: "accept", id: where.id }),
    },
    workspaceMember: {
      findFirst: async ({ where }: { where: { userId: string } }) => {
        const m = byUser(where.userId)[0];
        return m ? withWorkspace(m) : null;
      },
      findMany: async ({ where }: { where: { userId: string } }) => byUser(where.userId).map(withWorkspace),
      findUnique: async ({ where }: { where: { workspaceId_userId: { workspaceId: string; userId: string } } }) =>
        state.members.find(
          (m) => m.workspaceId === where.workspaceId_userId.workspaceId && m.userId === where.workspaceId_userId.userId
        ) ?? null,
      upsert: ({ create }: { create: Omit<Member, "id" | "createdAt"> }) => ({ op: "member", create }),
    },
    workspace: {
      create: async ({ data }: { data: { name: string; ownerId: string } }) => {
        const workspace = { id: `own_${data.ownerId}`, name: data.name, ownerId: data.ownerId };
        state.workspaces.push(workspace);
        state.members.push({ id: `m_${workspace.id}`, workspaceId: workspace.id, userId: data.ownerId, role: "OWNER", createdAt: new Date() });
        return workspace;
      },
    },
    $transaction: async (ops: { op: string; id?: string; create?: Omit<Member, "id" | "createdAt"> }[]) => {
      for (const op of ops) {
        if (op.op === "member" && op.create) state.members.push({ ...op.create, id: `m_${state.members.length}`, createdAt: new Date() });
        if (op.op === "accept") state.invitations.find((i) => i.id === op.id)!.status = "ACCEPTED";
      }
    },
  };
  return { state, prisma };
});

const session = vi.hoisted(() => ({ userId: null as string | null }));
const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined, get: vi.fn(), set: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: db.prisma }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: async () => session.userId }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import { getCurrentWorkspaceContext } from "../lib/workspace-access";
import { selectWorkspace } from "../lib/workspace-actions";

const day = (n: number) => new Date(Date.UTC(2026, 6, n));

function seed() {
  db.state.workspaces = [
    { id: "ws_owner", name: "Owner's workspace", ownerId: "u_owner" },
    { id: "ws_teammate", name: "Teammate's workspace", ownerId: "u_teammate" },
  ];
  db.state.members = [
    { id: "m1", workspaceId: "ws_owner", userId: "u_owner", role: "OWNER", createdAt: day(1) },
    { id: "m2", workspaceId: "ws_teammate", userId: "u_teammate", role: "OWNER", createdAt: day(2) },
    { id: "m3", workspaceId: "ws_owner", userId: "u_teammate", role: "ADMIN", createdAt: day(3) },
  ];
  db.state.invitations = [];
}

beforeEach(() => {
  seed();
  session.userId = null;
  cookieStore.value = undefined;
  cookieStore.get.mockReset().mockImplementation(() => (cookieStore.value ? { value: cookieStore.value } : undefined));
  cookieStore.set.mockReset();
});

describe("workspace resolution", () => {
  it("does not drop a teammate into someone else's workspace when their own is removed", async () => {
    db.state.workspaces = db.state.workspaces.filter((w) => w.id !== "ws_teammate");
    db.state.members = db.state.members.filter((m) => m.workspaceId !== "ws_teammate");
    session.userId = "u_teammate";

    await expect(getCurrentWorkspaceContext()).resolves.toBeNull();
  });

  it("ignores a saved choice for a workspace the user no longer belongs to", async () => {
    db.state.workspaces = db.state.workspaces.filter((w) => w.id !== "ws_teammate");
    db.state.members = db.state.members.filter((m) => m.workspaceId !== "ws_teammate");
    session.userId = "u_teammate";
    cookieStore.value = "u_teammate:ws_teammate";

    await expect(getCurrentWorkspaceContext()).resolves.toBeNull();
  });

  it("prefers the user's own workspace over an older membership elsewhere", async () => {
    db.state.members.find((m) => m.id === "m3")!.createdAt = day(0);
    session.userId = "u_teammate";

    await expect(getCurrentWorkspaceContext()).resolves.toMatchObject({ workspaceId: "ws_teammate", role: "OWNER" });
  });

  it("opens another workspace only after the user picks it", async () => {
    session.userId = "u_teammate";
    await expect(getCurrentWorkspaceContext()).resolves.toMatchObject({ workspaceId: "ws_teammate" });

    cookieStore.value = "u_teammate:ws_owner";
    await expect(getCurrentWorkspaceContext()).resolves.toMatchObject({ workspaceId: "ws_owner", role: "ADMIN" });
  });

  it("leaves a single-membership owner unaffected", async () => {
    session.userId = "u_owner";
    await expect(getCurrentWorkspaceContext()).resolves.toMatchObject({ workspaceId: "ws_owner", role: "OWNER" });
  });

  it("ignores a choice saved by a different user on the same browser", async () => {
    session.userId = "u_teammate";
    cookieStore.value = "u_other:ws_owner";
    await expect(getCurrentWorkspaceContext()).resolves.toMatchObject({ workspaceId: "ws_teammate" });
  });

  it("asks a user with no workspace and a pending invitation to choose, instead of opening it", async () => {
    db.state.invitations = [
      { id: "inv", workspaceId: "ws_owner", email: "u_new@example.test", role: "MEMBER", status: "PENDING", expiresAt: day(400) },
    ];
    session.userId = "u_new";

    await expect(getCurrentWorkspaceContext()).resolves.toBeNull();
    expect(db.state.members.some((m) => m.userId === "u_new" && m.workspaceId === "ws_owner")).toBe(true);
  });

  it("creates an own workspace for a user with no membership and no invitation", async () => {
    session.userId = "u_new";
    await expect(getCurrentWorkspaceContext()).resolves.toMatchObject({ workspaceId: "own_u_new", role: "OWNER" });
  });
});

describe("choosing a workspace", () => {
  const form = (workspaceId: string) => {
    const data = new FormData();
    data.set("workspaceId", workspaceId);
    return data;
  };

  it("refuses a workspace the user is not a member of", async () => {
    session.userId = "u_outsider";
    await expect(selectWorkspace(form("ws_owner"))).rejects.toThrow("Not a member");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("does not let a forged cookie open a workspace the user is not in", async () => {
    session.userId = "u_owner";
    cookieStore.value = "u_owner:ws_teammate";
    await expect(getCurrentWorkspaceContext()).resolves.toMatchObject({ workspaceId: "ws_owner" });
  });

  it("saves the choice of a member and opens the dashboard", async () => {
    session.userId = "u_teammate";
    await expect(selectWorkspace(form("ws_owner"))).rejects.toThrow("redirect:/dashboard");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "openreply-workspace",
      "u_teammate:ws_owner",
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    );
  });
});
