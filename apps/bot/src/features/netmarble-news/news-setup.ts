export const NEWS_FORUM_NAME = "Solo Leveling: Arise - News";
export const NEWS_TAGS = [
  { menuSeq: 32, name: "Notices" },
  { menuSeq: 13, name: "Developer Notes" },
  { menuSeq: 14, name: "Updates" },
  { menuSeq: 1, name: "Official News" },
  { menuSeq: 46, name: "Hunter: Origin" },
] as const;

export type NewsMapping = { menuSeq: number; tagId: string; notificationRoleId: string };
export type NewsSetup = {
  guildId: string;
  forumChannelId: string;
  enabled: boolean;
  mappings: NewsMapping[];
};

export type NewsSetupStore = {
  get(guildId: string): Promise<NewsSetup | null>;
  save(setup: NewsSetup): Promise<void>;
  setEnabled(guildId: string, enabled: boolean): Promise<boolean>;
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
): Promise<NewsSetup> {
  const current = await store.get(guild.guildId);
  if (current?.enabled) throw new Error("News is already configured for this server.");
  await guild.preflight();
  if (current) {
    if (!(await guild.resourcesExist(current))) {
      throw new Error(
        "Saved news channel or roles are missing; repair the configuration before enabling it.",
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
    const setup = { guildId: guild.guildId, forumChannelId: forum.id, enabled: true, mappings };
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
    throw new Error("News is not configured for this server.");
}
