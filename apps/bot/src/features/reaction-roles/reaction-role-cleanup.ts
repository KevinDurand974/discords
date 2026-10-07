import { Events, type Client } from "discord.js";
import { getReactionRoleStore, type ReactionRoleStore } from "./reaction-role-repository.ts";

function isConfirmedDeletion(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === 10008 || error.code === 10003)
  ); // Unknown Message / Unknown Channel
}

export function buildReactionRoleCleanup(client: Client, store: ReactionRoleStore) {
  let running: Promise<void> | undefined;
  async function execute() {
    if (!client.isReady()) throw new Error("Discord is unavailable for reaction role cleanup.");
    const failures: unknown[] = [];
    let cursor: string | undefined;
    while (true) {
      const records = await store.list(cursor);
      if (!records.length) break;
      for (const record of records) {
        let deleted = false;
        try {
          const channel = await client.channels.fetch(record.channelId, { force: true });
          if (
            !channel ||
            !channel.isTextBased() ||
            channel.isDMBased() ||
            channel.guildId !== record.guildId
          ) {
            throw new Error("Reaction role channel unavailable or mismatched.");
          }
          await channel.messages.fetch({ message: record.messageId, force: true });
        } catch (error) {
          if (isConfirmedDeletion(error)) deleted = true;
          else
            failures.push(
              new Error(`Could not verify reaction role message ${record.messageId}.`, {
                cause: error,
              }),
            );
        }
        if (deleted) {
          try {
            await store.remove(record.messageId);
          } catch (error) {
            failures.push(
              new Error(`Could not clean reaction role message ${record.messageId}.`, {
                cause: error,
              }),
            );
          }
        }
      }
      cursor = records.at(-1)!.messageId;
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Reaction role cleanup incomplete; unverified records were retained.",
      );
  }
  return {
    cleanup() {
      return (running ??= execute().finally(() => {
        running = undefined;
      }));
    },
  };
}

const runtimes = new WeakMap<Client, ReturnType<typeof buildReactionRoleCleanup>>();
function runtime(client: Client, store: ReactionRoleStore) {
  let existing = runtimes.get(client);
  if (!existing) {
    existing = buildReactionRoleCleanup(client, store);
    runtimes.set(client, existing);
  }
  return existing;
}

export function cleanupReactionRoles(
  client: Client,
  store: ReactionRoleStore = getReactionRoleStore(),
) {
  return runtime(client, store).cleanup();
}

export function registerReactionRoleCleanup(client: Client, store: ReactionRoleStore) {
  const cleanup = runtime(client, store);
  client.on(Events.MessageDelete, async (message) => {
    try {
      await store.remove(message.id);
    } catch (error) {
      console.error("Reaction role deletion cleanup failed", error);
    }
  });
  client.on(Events.MessageBulkDelete, async (messages) => {
    try {
      await Promise.all([...messages.keys()].map((id) => store.remove(id)));
    } catch (error) {
      console.error("Reaction role bulk deletion cleanup failed", error);
    }
  });
  client.once(Events.ClientReady, async () => {
    try {
      await cleanup.cleanup();
    } catch (error) {
      console.error("Reaction role startup cleanup failed", error);
    }
  });
}
