import { describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type Client,
  type Guild,
} from "discord.js";
import {
  buildTicketRuntime,
  changeTicketClosure,
  scheduleTicketClosure,
} from "./ticket-runtime.ts";
import type { TicketClosure, TicketClosureRequest } from "./ticket-closure-repository.ts";

const closure: TicketClosure = {
  closureId: "12345678-1234-4234-8234-123456789012",
  guildId: "guild",
  channelId: "channel",
  ownerId: "123456789012345678",
  requestedBy: "234567890123456789",
  createdAt: new Date("2030-01-01T00:00:00Z"),
  deleteAt: new Date("2030-01-01T00:05:00Z"),
};
function fixture() {
  const store = {
    schedule: vi.fn(async (_request: TicketClosureRequest) => closure),
    due: vi.fn(async () => [closure]),
    get: vi.fn(async (_channelId: string): Promise<TicketClosure | null> => closure),
    getDue: vi.fn(async (_channelId: string): Promise<TicketClosure | null> => closure),
    complete: vi.fn(async (_channelId: string) => {}),
    withLock: vi.fn(async (_channelId: string, work: () => Promise<void>) => {
      await work();
      return true;
    }),
    close: vi.fn(async () => {}),
  };
  const channel = {
    type: ChannelType.GuildText as ChannelType,
    guild: { id: "guild" },
    name: "ticket-a3f9c",
    topic: `Support ticket opened by ${closure.ownerId}`,
    delete: vi.fn(async (_reason: string) => {}),
    permissionsFor: vi.fn(() => new PermissionsBitField([P.ManageChannels, P.ManageRoles])),
    permissionOverwrites: { cache: new Collection(), set: vi.fn(async () => {}) },
  };
  const member = {
    permissions: new PermissionsBitField(),
    roles: {
      cache: new Collection<
        string,
        { id: string; managed: boolean; permissions: PermissionsBitField }
      >(),
    },
  };
  const guild = {
    id: "guild",
    ownerId: "345678901234567890",
    roles: { fetch: vi.fn(async () => {}) },
    channels: { fetch: vi.fn(async (): Promise<typeof channel | null> => channel) },
    members: { fetchMe: vi.fn(async () => ({ id: "bot" })), fetch: vi.fn(async () => member) },
  };
  const client = { isReady: vi.fn(() => true), guilds: { fetch: vi.fn(async () => guild) } };
  return {
    store,
    channel,
    guild,
    client,
    member,
    change: (
      action: "close" | "reopen",
      actorId = closure.ownerId,
      closureId = closure.closureId,
    ) =>
      changeTicketClosure(
        guild as unknown as Guild,
        closure.channelId,
        actorId,
        closureId,
        action,
        store,
      ),
    schedule: () =>
      scheduleTicketClosure(
        {
          guildId: closure.guildId,
          channelId: closure.channelId,
          ownerId: closure.ownerId,
          requestedBy: closure.ownerId,
        },
        guild as unknown as Guild,
        store,
      ),
    runtime: buildTicketRuntime(client as unknown as Client, store),
  };
}

describe("ticket closure actions", () => {
  it("schedules without changing channel permissions or requiring Manage Roles", async () => {
    const f = fixture();
    f.channel.permissionsFor.mockReturnValue(new PermissionsBitField([P.ManageChannels]));
    await f.schedule();
    expect(f.store.schedule).toHaveBeenCalled();
    expect(f.channel.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it("does not change permissions when scheduling fails", async () => {
    const f = fixture();
    f.store.schedule.mockRejectedValueOnce(new Error("Database failed"));
    await expect(f.schedule()).rejects.toThrow("Database failed");
    expect(f.channel.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it("reports a failed cancellation without changing permissions", async () => {
    const f = fixture();
    f.store.complete.mockRejectedValueOnce(new Error("Database failed"));
    await expect(f.change("reopen")).rejects.toThrow("Database failed");
    expect(f.channel.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it("immediately deletes an authorized pending ticket before removing its record", async () => {
    const f = fixture();
    await f.change("close");
    expect(f.channel.delete).toHaveBeenCalledExactlyOnceWith(
      `Ticket closed immediately by ${closure.ownerId}`,
    );
    expect(f.store.complete).toHaveBeenCalledExactlyOnceWith("channel");
    expect(f.store.complete.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.channel.delete.mock.invocationCallOrder[0]!,
    );
  });
  it("reopens without deleting the channel, even if bot deletion permissions were lost", async () => {
    const f = fixture();
    f.channel.permissionsFor.mockReturnValue(new PermissionsBitField());
    await f.change("reopen");
    expect(f.channel.permissionOverwrites.set).not.toHaveBeenCalled();
    expect(f.store.complete).toHaveBeenCalledExactlyOnceWith("channel");
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.guild.members.fetchMe).not.toHaveBeenCalled();
  });
  it.each(["close", "reopen"] as const)("rejects unauthorized %s actions", async (action) => {
    const f = fixture();
    await expect(f.change(action, closure.requestedBy)).rejects.toThrow(
      "Only the ticket requester or a moderator",
    );
    expect(f.store.complete).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });
  it.each(["close", "reopen"] as const)(
    "rejects stale %s buttons after a new closure",
    async (action) => {
      const f = fixture();
      f.store.get.mockResolvedValueOnce({
        ...closure,
        closureId: "87654321-1234-4234-8234-123456789012",
      });
      await expect(f.change(action)).rejects.toThrow("no longer active");
      expect(f.store.complete).not.toHaveBeenCalled();
      expect(f.channel.delete).not.toHaveBeenCalled();
    },
  );
  it("rejects a button after deletion has already been cancelled", async () => {
    const f = fixture();
    f.store.get.mockResolvedValueOnce(null);
    await expect(f.change("close")).rejects.toThrow("no longer active");
    expect(f.channel.delete).not.toHaveBeenCalled();
  });
  it.each([{ guildId: "other" }, { ownerId: "345678901234567890" }])(
    "rejects mismatched stored identity: %j",
    async (data) => {
      const f = fixture();
      f.store.get.mockResolvedValueOnce({ ...closure, ...data });
      await expect(f.change("reopen")).rejects.toThrow("no longer active");
      expect(f.store.complete).not.toHaveBeenCalled();
    },
  );
  it("reports contention instead of falsely reporting a successful reopening", async () => {
    const f = fixture();
    f.store.withLock.mockResolvedValueOnce(false);
    await expect(f.change("reopen")).rejects.toThrow("being updated");
    expect(f.store.complete).not.toHaveBeenCalled();
  });
  it("does not clear a pending record if immediate deletion fails", async () => {
    const f = fixture();
    f.channel.delete.mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(f.change("close")).rejects.toThrow("Discord unavailable");
    expect(f.store.complete).not.toHaveBeenCalled();
  });
  it("does not immediately delete without bot permissions", async () => {
    const f = fixture();
    f.channel.permissionsFor.mockReturnValueOnce(new PermissionsBitField());
    await expect(f.change("close")).rejects.toThrow("Manage Channels");
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.store.complete).not.toHaveBeenCalled();
  });
  it("cancels deletion before the cron worker rechecks a due candidate", async () => {
    const f = fixture();
    f.store.complete.mockImplementationOnce(async () => {
      f.store.getDue.mockResolvedValue(null);
    });
    await f.change("reopen");
    await f.runtime.cleanup();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });
  it.each([P.ManageMessages, P.Administrator])(
    "allows current moderator and administrator permissions: %s",
    async (permission) => {
      const f = fixture();
      f.member.roles.cache.set("moderator", {
        id: "moderator",
        managed: false,
        permissions: new PermissionsBitField([permission]),
      });
      f.member.permissions = new PermissionsBitField([permission]);
      await f.change("reopen", closure.requestedBy);
      expect(f.store.complete).toHaveBeenCalledOnce();
    },
  );
});

describe("scheduled ticket deletion", () => {
  it("deletes due, still-marked ticket channels and removes completed records", async () => {
    const f = fixture();
    await f.runtime.cleanup();
    expect(f.store.withLock).toHaveBeenCalledWith("channel", expect.any(Function));
    expect(f.store.getDue).toHaveBeenCalledWith("channel");
    expect(f.client.guilds.fetch).toHaveBeenCalledWith("guild");
    expect(f.guild.channels.fetch).toHaveBeenCalledWith("channel", { force: true });
    expect(f.channel.delete).toHaveBeenCalledExactlyOnceWith(
      `Scheduled ticket closure requested by ${closure.requestedBy}`,
    );
    expect(f.store.complete).toHaveBeenCalledExactlyOnceWith("channel");
    expect(f.store.complete.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.channel.delete.mock.invocationCallOrder[0]!,
    );
  });

  it("does nothing when there are no due closures", async () => {
    const f = fixture();
    f.store.due.mockResolvedValueOnce([]);
    await f.runtime.cleanup();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("checks the persisted deadline again under the lock", async () => {
    const f = fixture();
    f.store.getDue.mockResolvedValueOnce(null);
    await f.runtime.cleanup();
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.store.complete).not.toHaveBeenCalled();
  });

  it("leaves work to another worker when the advisory lock is held", async () => {
    const f = fixture();
    f.store.withLock.mockResolvedValueOnce(false);
    await f.runtime.cleanup();
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.store.complete).not.toHaveBeenCalled();
  });

  it("recovers pending records through a newly constructed runtime after restart", async () => {
    const f = fixture();
    const restarted = buildTicketRuntime(f.client as unknown as Client, f.store);
    await restarted.cleanup();
    expect(f.channel.delete).toHaveBeenCalledOnce();
  });

  it.each([null, { code: 10003 }])(
    "completes an already-deleted channel record: %j",
    async (missing) => {
      const f = fixture();
      if (missing) f.guild.channels.fetch.mockRejectedValueOnce(missing);
      else f.guild.channels.fetch.mockResolvedValueOnce(null);
      await f.runtime.cleanup();
      expect(f.store.complete).toHaveBeenCalledWith("channel");
      expect(f.channel.delete).not.toHaveBeenCalled();
    },
  );

  it("handles a channel deleted concurrently with the delete request", async () => {
    const f = fixture();
    f.channel.delete.mockRejectedValueOnce({ code: 10003 });
    await f.runtime.cleanup();
    expect(f.store.complete).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "general" },
    { topic: "ordinary channel" },
    { topic: "Support ticket opened by 345678901234567890" },
    { type: ChannelType.GuildVoice },
    { guild: { id: "another-guild" } },
  ])("refuses unsafe deletion if ticket metadata changed: %j", async (data) => {
    const f = fixture();
    Object.assign(f.channel, data);
    await expect(f.runtime.cleanup()).rejects.toThrow("pending records are retained");
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.store.complete).not.toHaveBeenCalled();
  });

  it("preserves records when permission is lost and retries on the next run", async () => {
    const f = fixture();
    f.channel.permissionsFor.mockReturnValueOnce(new PermissionsBitField());
    await expect(f.runtime.cleanup()).rejects.toThrow("failed");
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.store.complete).not.toHaveBeenCalled();
    await f.runtime.cleanup();
    expect(f.channel.delete).toHaveBeenCalledOnce();
  });

  it("preserves records on Discord API failure", async () => {
    const f = fixture();
    f.channel.delete.mockRejectedValueOnce(new Error("Missing Permissions"));
    await expect(f.runtime.cleanup()).rejects.toThrow("failed");
    expect(f.store.complete).not.toHaveBeenCalled();
  });

  it("does not treat network failures as deleted channels", async () => {
    const f = fixture();
    f.guild.channels.fetch.mockRejectedValueOnce(new Error("Network failure"));
    await expect(f.runtime.cleanup()).rejects.toThrow("failed");
    expect(f.store.complete).not.toHaveBeenCalled();
  });

  it("keeps a record if completion persistence fails after Discord deletion", async () => {
    const f = fixture();
    f.store.complete.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(f.runtime.cleanup()).rejects.toThrow("failed");
    f.guild.channels.fetch.mockResolvedValueOnce(null);
    await f.runtime.cleanup();
    expect(f.channel.delete).toHaveBeenCalledOnce();
    expect(f.store.complete).toHaveBeenCalledTimes(2);
  });

  it("continues processing other due tickets after a failure", async () => {
    const f = fixture();
    f.store.due.mockResolvedValueOnce([closure, { ...closure, channelId: "second" }]);
    f.channel.delete.mockRejectedValueOnce(new Error("Discord unavailable"));
    f.store.getDue
      .mockResolvedValueOnce(closure)
      .mockResolvedValueOnce({ ...closure, channelId: "second" });
    await expect(f.runtime.cleanup()).rejects.toThrow("failed");
    expect(f.store.complete).toHaveBeenCalledExactlyOnceWith("second");
  });

  it("refuses to execute while Discord is unavailable", async () => {
    const f = fixture();
    f.client.isReady.mockReturnValueOnce(false);
    await expect(f.runtime.cleanup()).rejects.toThrow("Discord is unavailable");
    expect(f.store.due).not.toHaveBeenCalled();
  });

  it("shares overlapping HTTP cleanup runs", async () => {
    const f = fixture();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.channel.delete.mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const first = f.runtime.cleanup();
    await started;
    const second = f.runtime.cleanup();
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(f.store.due).toHaveBeenCalledOnce();
    expect(f.channel.delete).toHaveBeenCalledOnce();
  });
});
