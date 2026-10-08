import { describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type ModalBuilder,
  type ModalSubmitInteraction,
} from "discord.js";
import { pollCommand } from "./poll.command.ts";
import { createPollData, createPollFromForm } from "./poll.ts";
import { pollComponentHandler } from "./poll-modal.ts";
import { commands, componentHandlers } from "../../core/command-registry.ts";

function fixture({
  strings = { question: " Lunch? ", answers: " Pizza \nSalad" },
  duration = null,
  multiple = null,
  destination = null,
  type = ChannelType.GuildText,
  userPermissions = [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.SendPolls],
  botPermissions = userPermissions,
  archived = false,
  locked = false,
}: {
  strings?: Record<string, string>;
  duration?: number | null;
  multiple?: boolean | null;
  destination?: string | null;
  type?: ChannelType;
  userPermissions?: bigint[];
  botPermissions?: bigint[];
  archived?: boolean;
  locked?: boolean;
} = {}) {
  const member = { id: "user" };
  const bot = { id: "bot" };
  const thread = [
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ].includes(type);
  const channel = {
    id: destination ?? "current",
    type,
    archived,
    locked,
    members: { fetch: vi.fn(async (id: string) => ({ id })) },
    isSendable: () => type !== ChannelType.GuildForum,
    isThread: () => thread,
    permissionsFor: (actor: { id: string }) =>
      new PermissionsBitField(actor.id === "user" ? userPermissions : botPermissions),
    send: vi.fn(async () => ({ url: "https://discord.com/channels/guild/channel/message" })),
  };
  const fetch = vi.fn(async () => channel);
  const interaction = {
    inGuild: () => true,
    guild: {
      channels: { fetch },
      members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
    },
    user: member,
    channelId: "current",
    channel,
    customId: "poll:create:user",
    isModalSubmit: () => true,
    fields: {
      getTextInputValue: (name: string) =>
        name === "duration" ? (duration === null ? "" : String(duration)) : (strings[name] ?? ""),
      getStringSelectValues: () => [multiple ? "multiple" : "single"],
      getSelectedChannels: () =>
        new Collection([[destination ?? "current", { id: destination ?? "current" }]]),
    },
    showModal: vi.fn<(modal: ModalBuilder) => Promise<void>>(async () => {}),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(),
  };
  return {
    interaction,
    channel,
    fetch,
    execute: () => pollComponentHandler.execute(interaction as unknown as ModalSubmitInteraction),
  };
}

describe("native /poll", () => {
  it("is registered and declares Discord limits without hiding it behind default permissions", () => {
    expect(commands).toContain(pollCommand);
    const data = pollCommand.data.toJSON();
    expect(data.contexts).toEqual([InteractionContextType.Guild]);
    expect(data.default_member_permissions).toBeNull();
    expect(data.options ?? []).toEqual([]);
    expect(componentHandlers).toContain(pollComponentHandler);
    expect(pollComponentHandler.matches("poll:create:user")).toBe(true);
    expect(pollComponentHandler.matches("sla:create-coupon:user")).toBe(false);
  });

  it("opens a five-field modal without sending or deferring", async () => {
    const f = fixture();
    await pollCommand.execute(f.interaction as unknown as ChatInputCommandInteraction);
    const modal = f.interaction.showModal.mock.calls[0]![0].toJSON();
    expect(modal.custom_id).toBe("poll:create:user");
    expect(modal.components).toHaveLength(5);
    expect(modal.components).toEqual([
      expect.objectContaining({
        type: ComponentType.Label,
        component: expect.objectContaining({
          custom_id: "question",
          max_length: 300,
          required: true,
        }),
      }),
      expect.objectContaining({
        type: ComponentType.Label,
        component: expect.objectContaining({ custom_id: "answers", style: 2, required: true }),
      }),
      expect.objectContaining({
        type: ComponentType.Label,
        component: expect.objectContaining({ custom_id: "duration", value: "24", required: false }),
      }),
      expect.objectContaining({
        type: ComponentType.Label,
        component: expect.objectContaining({
          custom_id: "voting-mode",
          options: expect.arrayContaining([
            expect.objectContaining({ value: "single", default: true }),
          ]),
        }),
      }),
      expect.objectContaining({
        type: ComponentType.Label,
        component: expect.objectContaining({
          custom_id: "channel",
          default_values: [{ id: "current", type: "channel" }],
          required: true,
        }),
      }),
    ]);
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });

  it("does not preselect an unsupported current channel", async () => {
    const f = fixture({ type: ChannelType.GuildForum });
    await pollCommand.execute(f.interaction as unknown as ChatInputCommandInteraction);
    const modal = f.interaction.showModal.mock.calls[0]![0].toJSON();
    expect(modal.components[4]).toMatchObject({ component: { custom_id: "channel" } });
    expect(modal.components[4]).not.toMatchObject({
      component: { default_values: expect.anything() },
    });
  });

  it("rejects a form belonging to another user", async () => {
    const f = fixture();
    f.interaction.customId = "poll:create:someone-else";
    await expect(f.execute()).rejects.toThrow("This form is unavailable. Run /poll again");
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing destination", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels = () => new Collection();
    await expect(f.execute()).rejects.toThrow("Select a destination");
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it("rejects invalid answers before fetching or sending", async () => {
    const f = fixture({ strings: { question: "Q", answers: "A\n a " } });
    await expect(f.execute()).rejects.toThrow("unique");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });

  it("rejects DMs when opening the modal", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(
      pollCommand.execute(f.interaction as unknown as ChatInputCommandInteraction),
    ).rejects.toThrow("server");
    expect(f.interaction.showModal).not.toHaveBeenCalled();
  });

  it("posts a native poll before displaying the private success confirmation", async () => {
    const f = fixture();
    await f.execute();
    expect(f.fetch).toHaveBeenCalledWith("current");
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.channel.send).toHaveBeenCalledWith({
      poll: {
        question: { text: "Lunch?" },
        answers: [{ text: "Pizza" }, { text: "Salad" }],
        duration: 24,
        allowMultiselect: false,
      },
      allowedMentions: { parse: [] },
    });
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: `Poll published in <#${f.channel.id}>.`,
      allowedMentions: { parse: [] },
    });
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    expect(f.channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      f.interaction.editReply.mock.invocationCallOrder[0]!,
    );
  });

  it("supports all 10 answers, 32 days, multiselect and a destination channel", async () => {
    const f = fixture({
      strings: {
        question: "Pick",
        answers: Array.from({ length: 10 }, (_, i) => `Choice ${i + 1}`).join("\n"),
      },
      duration: 768,
      multiple: true,
      destination: "other",
    });
    await f.execute();
    expect(f.fetch).toHaveBeenCalledWith("other");
    expect(f.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        poll: expect.objectContaining({
          answers: expect.arrayContaining([{ text: "Choice 10" }]),
          duration: 768,
          allowMultiselect: true,
        }),
      }),
    );
  });

  it("ignores blank lines between answers", async () => {
    const f = fixture({
      strings: { question: "Pick", answers: "A\n\n B\r\nC\n" },
    });
    await f.execute();
    expect(f.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        poll: expect.objectContaining({ answers: [{ text: "A" }, { text: "B" }, { text: "C" }] }),
      }),
    );
  });

  it.each(["user", "bot"])("checks %s permissions in the destination", async (actor) => {
    const f = fixture(
      actor === "user"
        ? {
            userPermissions: [P.ViewChannel, P.SendMessages],
            botPermissions: [P.ViewChannel, P.SendMessages, P.SendPolls],
          }
        : { botPermissions: [P.ViewChannel, P.SendMessages] },
    );
    await expect(f.execute()).rejects.toThrow("Send Polls");
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it.each([P.ViewChannel, P.SendMessages, P.SendPolls])(
    "rejects missing destination permission %s",
    async (missing) => {
      const f = fixture({
        userPermissions: [P.ViewChannel, P.SendMessages, P.SendPolls].filter((p) => p !== missing),
      });
      await expect(f.execute()).rejects.toThrow("You need");
      expect(f.channel.send).not.toHaveBeenCalled();
    },
  );

  it("uses Send Messages in Threads rather than Send Messages for threads", async () => {
    const f = fixture({
      type: ChannelType.PublicThread,
      userPermissions: [P.ViewChannel, P.SendMessagesInThreads, P.SendPolls],
    });
    await f.execute();
    expect(f.channel.send).toHaveBeenCalledOnce();
    const denied = fixture({
      type: ChannelType.PublicThread,
      userPermissions: [P.ViewChannel, P.SendMessages, P.SendPolls],
    });
    await expect(denied.execute()).rejects.toThrow("Send Messages in Threads");
  });

  it.each([{ archived: true }, { locked: true }])("rejects inactive threads: %j", async (state) => {
    const f = fixture({ type: ChannelType.PublicThread, ...state });
    await expect(f.execute()).rejects.toThrow("archived or locked");
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it("checks membership for private threads", async () => {
    const f = fixture({ type: ChannelType.PrivateThread });
    await f.execute();
    expect(f.channel.members.fetch).toHaveBeenCalledWith("user");
    expect(f.channel.members.fetch).toHaveBeenCalledWith("bot");
    f.channel.send.mockClear();
    f.channel.members.fetch.mockRejectedValueOnce(new Error("Unknown Member"));
    await expect(f.execute()).rejects.toThrow("members of the private thread");
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it("allows thread managers to access private threads without membership", async () => {
    const f = fixture({
      type: ChannelType.PrivateThread,
      userPermissions: [P.ViewChannel, P.SendMessagesInThreads, P.SendPolls, P.ManageThreads],
    });
    await f.execute();
    expect(f.channel.members.fetch).not.toHaveBeenCalled();
    expect(f.channel.send).toHaveBeenCalledOnce();
  });

  it("rejects forums and missing channels", async () => {
    const f = fixture({ type: ChannelType.GuildForum });
    await expect(f.execute()).rejects.toThrow("Choose a server text channel");
    f.fetch.mockResolvedValueOnce(null as unknown as typeof f.channel);
    await expect(f.execute()).rejects.toThrow("Choose a server text channel");
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it("rejects DMs before fetching or sending", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(f.execute()).rejects.toThrow("server");
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("propagates Discord failures without confirming success", async () => {
    const f = fixture();
    f.channel.send.mockRejectedValueOnce(new Error("Missing Permissions"));
    await expect(f.execute()).rejects.toThrow("Missing Permissions");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });
});

describe("poll validation", () => {
  it("accepts exact text boundaries and the minimum duration", () => {
    expect(createPollData("Q".repeat(300), ["A".repeat(55), "B".repeat(55)], 1).duration).toBe(1);
  });
  it.each(["", "   ", "Q".repeat(301)])("rejects invalid questions", (question) => {
    expect(() => createPollData(question, ["A", "B"])).toThrow("question");
  });
  it.each([
    { answers: [] },
    { answers: ["A"] },
    { answers: Array.from({ length: 11 }, (_, i) => String(i)) },
  ])("rejects invalid answer counts", ({ answers }) => {
    expect(() => createPollData("Q", answers)).toThrow("between 2 and 10");
  });
  it.each([
    { answers: [" ", "B"], error: "between 1 and 55" },
    { answers: ["A".repeat(56), "B"], error: "between 1 and 55" },
    { answers: ["A", " a "], error: "unique" },
  ])("rejects blank, oversized or duplicate answers", ({ answers, error }) => {
    expect(() => createPollData("Q", answers)).toThrow(error);
  });
  it.each([0, -1, 769, 1.5, NaN, Infinity])("rejects invalid duration %s", (duration) => {
    expect(() => createPollData("Q", ["A", "B"], duration)).toThrow("whole number");
  });
});

describe("poll form parsing", () => {
  it("trims inputs, handles line endings and defaults an empty duration to 24", () => {
    expect(createPollFromForm(" Q ", " A\r\n\r\nB\rC\n ", " ", ["single"])).toEqual({
      question: { text: "Q" },
      answers: [{ text: "A" }, { text: "B" }, { text: "C" }],
      duration: 24,
      allowMultiselect: false,
    });
  });
  it("accepts a numeric duration and multiple-choice voting", () => {
    expect(createPollFromForm("Q", "A\nB", " 768 ", ["multiple"])).toMatchObject({
      duration: 768,
      allowMultiselect: true,
    });
  });
  it.each(["0", "769", "-1", "1.5", "1e2", "0x10", "abc", "Infinity"])(
    "rejects invalid duration %s",
    (duration) => {
      expect(() => createPollFromForm("Q", "A\nB", duration, ["single"])).toThrow("whole number");
    },
  );
  it.each([{ modes: [] }, { modes: ["unknown"] }, { modes: ["single", "multiple"] }])(
    "rejects invalid voting selections",
    ({ modes }) => {
      expect(() => createPollFromForm("Q", "A\nB", "24", modes)).toThrow("Choose single-choice");
    },
  );
  it.each([
    { answers: "A", error: "between 2 and 10" },
    { answers: "A\n a ", error: "unique" },
    {
      answers: Array.from({ length: 11 }, (_, i) => String(i)).join("\n"),
      error: "between 2 and 10",
    },
    { answers: `${"A".repeat(56)}\nB`, error: "between 1 and 55" },
  ])("enforces answer limits when parsing the form", ({ answers, error }) => {
    expect(() => createPollFromForm("Q", answers, "24", ["single"])).toThrow(error);
  });
});
