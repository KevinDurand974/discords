import { UserFacingError } from "@/core/errors.ts";

export const NEWS_FORUM_NAME = "Solo Leveling: Arise - News";
export const NOTICES_MENU_SEQ = 32;
export const NEWS_TAGS = [
  { menuSeq: NOTICES_MENU_SEQ, name: "Notices" },
  { menuSeq: 13, name: "Developer Notes" },
  { menuSeq: 14, name: "Updates" },
  { menuSeq: 1, name: "Official News" },
  { menuSeq: 46, name: "Hunter: Origin" },
] as const;

export type NewsImportMode = "backfill" | "future_only";
export type NewsMapping = { menuSeq: number; tagId: string; notificationRoleId: string };
export type NewsSetup = {
  guildId: string;
  forumChannelId: string;
  enabled: boolean;
  initialImportMode: NewsImportMode;
  initialBackfillCount: number;
  initialImportCompleted: boolean;
  initialSourceCutoff?: { id: number; createdAt: string } | null;
  mappings: NewsMapping[];
};

export type NewsSetupStore = {
  get(guildId: string): Promise<NewsSetup | null>;
  save(setup: NewsSetup): Promise<void>;
  setEnabled(guildId: string, enabled: boolean): Promise<boolean>;
  publicationCount(guildId: string): Promise<number>;
  delete(guildId: string, forumChannelId: string): Promise<boolean>;
};

export type NewsGuildGateway = {
  guildId: string;
  preflight(): Promise<void>;
  resourcesExist(setup: NewsSetup): Promise<boolean>;
  createRole(name: string): Promise<string>;
  deleteRole(id: string): Promise<void>;
  createForum(tagNames: string[]): Promise<{ id: string; tags: { id: string; name: string }[] }>;
  deleteForum(id: string): Promise<void>;
};

export async function createNewsSetup(
  guild: NewsGuildGateway,
  store: NewsSetupStore,
  initialBackfillCount = 10,
): Promise<NewsSetup> {
  if (
    !Number.isInteger(initialBackfillCount) ||
    initialBackfillCount < 0 ||
    initialBackfillCount > 10
  )
    throw new UserFacingError("Backfill count must be between 0 and 10.");
  const current = await store.get(guild.guildId);
  if (current?.enabled) throw new UserFacingError("News is already configured for this server.");
  await guild.preflight();
  if (current) {
    if (!(await guild.resourcesExist(current))) {
      throw new UserFacingError(
        "The news Forum or roles are missing. Ask an administrator to check /sla news status.",
      );
    }
    if (!(await store.setEnabled(guild.guildId, true))) {
      throw new Error("News configuration was removed while enabling it.");
    }
    return { ...current, enabled: true };
  }

  const createdRoleIds: string[] = [];
  let forumId: string | undefined;
  try {
    const roles: { menuSeq: number; roleId: string }[] = [];
    for (const { menuSeq, name } of NEWS_TAGS) {
      const roleId = await guild.createRole(`SLA: ${name}`);
      createdRoleIds.push(roleId);
      roles.push({ menuSeq, roleId });
    }
    const forum = await guild.createForum(NEWS_TAGS.map(({ name }) => name));
    forumId = forum.id;
    const mappings = NEWS_TAGS.map(({ menuSeq, name }) => {
      const tagId = forum.tags.find((tag) => tag.name === name)?.id;
      const notificationRoleId = roles.find((role) => role.menuSeq === menuSeq)?.roleId;
      if (!tagId || !notificationRoleId) throw new Error(`Forum tag ${name} was not created.`);
      return { menuSeq, tagId, notificationRoleId };
    });
    if (new Set(mappings.map(({ tagId }) => tagId)).size !== NEWS_TAGS.length) {
      throw new Error("Forum tags are not unique.");
    }
    const setup: NewsSetup = {
      guildId: guild.guildId,
      forumChannelId: forum.id,
      enabled: true,
      initialImportMode: initialBackfillCount === 0 ? "future_only" : "backfill",
      initialBackfillCount,
      initialImportCompleted: false,
      mappings,
    };
    await store.save(setup);
    return setup;
  } catch (error) {
    const cleanup = [
      ...(forumId ? [guild.deleteForum(forumId)] : []),
      ...createdRoleIds.map((roleId) => guild.deleteRole(roleId)),
    ];
    const results = await Promise.allSettled(cleanup);
    if (results.some((result) => result.status === "rejected")) {
      console.error(
        "News setup cleanup failed",
        results.filter((result) => result.status === "rejected"),
      );
    }
    throw error;
  }
}

export async function disableNewsSetup(guildId: string, store: NewsSetupStore) {
  if (!(await store.setEnabled(guildId, false)))
    throw new UserFacingError("News is not configured. Run /sla news create.");
}

export async function cleanNewsSetup(
  guild: NewsGuildGateway,
  store: NewsSetupStore,
  synchronizer: {
    withGuildCleanup(guildId: string, cleanup: () => Promise<boolean>): Promise<boolean>;
  },
  expectedForumId: string,
  expectedRoleIds: string[],
): Promise<boolean> {
  return synchronizer.withGuildCleanup(guild.guildId, async () => {
    const setup = await store.get(guild.guildId);
    if (!setup) return false;
    const roleIds = [
      ...new Set(setup.mappings.map(({ notificationRoleId }) => notificationRoleId)),
    ].sort();
    if (
      setup.forumChannelId !== expectedForumId ||
      roleIds.length !== expectedRoleIds.length ||
      roleIds.some((id, index) => id !== expectedRoleIds[index])
    ) {
      throw new Error("News resources changed since confirmation; run /setup news clean again.");
    }
    if (!(await store.setEnabled(guild.guildId, false)))
      throw new Error("News configuration changed during cleanup; retry after checking status.");
    try {
      await guild.deleteForum(setup.forumChannelId);
    } catch (error) {
      throw new Error(
        `Could not delete Forum ${setup.forumChannelId}; configuration and roles remain for retry.`,
        { cause: error },
      );
    }
    const removals = await Promise.allSettled(
      [...new Set(roleIds)].map((id) => guild.deleteRole(id)),
    );
    const failed = [...new Set(roleIds)].filter(
      (_, index) => removals[index]?.status === "rejected",
    );
    if (failed.length)
      throw new Error(
        `Could not delete roles ${failed.join(", ")}; saved Forum and role IDs remain for retry.`,
      );
    if (!(await store.delete(guild.guildId, setup.forumChannelId)))
      throw new Error(
        "News resources were removed but settings could not be deleted; check the saved IDs before retrying.",
      );
    return true;
  });
}
