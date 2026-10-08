import { ChannelType, PermissionFlagsBits, type Client, type Guild } from "discord.js";
import {
  createTicketClosureRepository,
  type TicketClosure,
  type TicketClosureRepository,
  type TicketClosureRequest,
} from "./ticket-closure-repository.ts";
import { UserFacingError } from "@/core/errors.ts";
import { ticketOwnerId } from "./ticket-service.ts";
import { authorizeTicket, requireTicketDeletionPermission } from "./ticket-access.ts";

let repository: TicketClosureRepository | undefined;
function store() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for scheduled ticket closures.");
  return (repository ??= createTicketClosureRepository(process.env.DATABASE_URL));
}
export async function scheduleTicketClosure(
  request: TicketClosureRequest,
  guild: Guild,
  repository: TicketClosureRepository = store(),
) {
  let closure: TicketClosure | undefined;
  const acquired = await repository.withLock(request.channelId, async () => {
    const { channel, ownerId } = await authorizeTicket(
      guild,
      request.channelId,
      request.requestedBy,
    );
    if (ownerId !== request.ownerId)
      throw new UserFacingError("This ticket changed. Run /close-ticket again.");
    await requireTicketDeletionPermission(guild, channel);
    closure = await repository.schedule(request);
  });
  if (!acquired || !closure)
    throw new UserFacingError("This ticket is being updated. Try again shortly.");
  return closure;
}

export async function changeTicketClosure(
  guild: Guild,
  channelId: string,
  actorId: string,
  closureId: string,
  action: "close" | "reopen",
  repository: TicketClosureRepository = store(),
) {
  const acquired = await repository.withLock(channelId, async () => {
    const { channel, ownerId } = await authorizeTicket(guild, channelId, actorId);
    const closure = await repository.get(channelId);
    if (
      !closure ||
      closure.closureId !== closureId ||
      closure.guildId !== guild.id ||
      closure.ownerId !== ownerId
    ) {
      throw new UserFacingError(
        "This closure is no longer active. Use /close-ticket to create a new closure.",
      );
    }
    if (action === "close") {
      await requireTicketDeletionPermission(guild, channel);
      await channel.delete(`Ticket closed immediately by ${actorId}`);
    }
    await repository.complete(channelId);
  });
  if (!acquired) throw new UserFacingError("This ticket is being updated. Try again shortly.");
}
function isUnknownChannel(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 10003;
}

export function buildTicketRuntime(client: Client, repository: TicketClosureRepository) {
  let running: Promise<void> | undefined;
  async function execute() {
    if (!client.isReady()) throw new Error("Discord is unavailable for ticket deletion.");
    const failures: unknown[] = [];
    await (
      await repository.due()
    ).reduce(async (previous, candidate) => {
      await previous;
      try {
        await repository.withLock(candidate.channelId, async () => {
          const closure = await repository.getDue(candidate.channelId);
          if (!closure) return;
          const guild = await client.guilds.fetch(closure.guildId);
          const channel = await guild.channels
            .fetch(closure.channelId, { force: true })
            .catch((error: unknown) => {
              if (isUnknownChannel(error)) return null;
              throw error;
            });
          if (!channel) {
            await repository.complete(closure.channelId);
            return;
          }
          if (
            channel.type !== ChannelType.GuildText ||
            channel.guild.id !== closure.guildId ||
            ticketOwnerId(channel) !== closure.ownerId
          ) {
            throw new Error(
              `Ticket ${closure.channelId} no longer matches its scheduled closure; deletion refused.`,
            );
          }
          const bot = await guild.members.fetchMe({ force: true });
          if (!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error(`The bot needs Manage Channels to delete ticket ${closure.channelId}.`);
          }
          try {
            await channel.delete(`Scheduled ticket closure requested by ${closure.requestedBy}`);
          } catch (error) {
            if (!isUnknownChannel(error)) throw error;
          }
          await repository.complete(closure.channelId);
        });
      } catch (error) {
        failures.push(error);
      }
    }, Promise.resolve());
    if (failures.length)
      throw new AggregateError(
        failures,
        "Some scheduled ticket deletions failed; pending records are retained for retry.",
      );
  }
  return {
    cleanup() {
      // Share overlapping HTTP cleanup runs.
      return (running ??= execute().finally(() => {
        running = undefined;
      }));
    },
  };
}
const runtimes = new WeakMap<Client, ReturnType<typeof buildTicketRuntime>>();
export function deleteDueTickets(client: Client) {
  let runtime = runtimes.get(client);
  if (!runtime) {
    runtime = buildTicketRuntime(client, store());
    runtimes.set(client, runtime);
  }
  return runtime.cleanup();
}
