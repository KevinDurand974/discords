import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ComponentType,
  PermissionFlagsBits as P,
  PermissionsBitField,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { createTrapModal, trapBotCommand, trapComponentHandler } from "./trap-bot.command.ts";
import { createTrapChannel } from "./trap-service.ts";
import { componentHandlers } from "@/core/command-registry.ts";

vi.mock("./trap-service.ts", () => ({ createTrapChannel: vi.fn(async () => {}) }));
vi.mock("./trap-repository.ts", () => ({ getTrapStore: vi.fn(() => ({})) }));
beforeEach(() => vi.clearAllMocks());

function fixture() {
  const interaction = {
    inGuild: () => true,
    guild: { id: "guild" } as { id: string } | null,
    user: { id: "user" },
    memberPermissions: new PermissionsBitField([P.ManageChannels, P.BanMembers]),
    showModal: vi.fn(),
    isModalSubmit: () => true,
    customId: "trap:create:user:guild",
    fields: { getTextInputValue: vi.fn(() => "custom-trap") },
  };
  return {
    interaction,
    open: () => trapBotCommand.execute(interaction as unknown as ChatInputCommandInteraction),
    submit: () => trapComponentHandler.execute(interaction as unknown as ModalSubmitInteraction),
  };
}

describe("trap channel naming modal", () => {
  it("opens a user-bound modal prefilled with trap without creating a channel", async () => {
    const f = fixture();
    await f.open();
    expect(f.interaction.showModal).toHaveBeenCalledOnce();
    expect(createTrapChannel).not.toHaveBeenCalled();
    expect(createTrapModal("user", "guild").toJSON()).toMatchObject({
      custom_id: "trap:create:user:guild",
      components: [
        {
          type: ComponentType.Label,
          component: {
            type: ComponentType.TextInput,
            custom_id: "trap-channel-name",
            style: TextInputStyle.Short,
            value: "trap",
            required: true,
            max_length: 100,
          },
        },
      ],
    });
  });
  it.each([P.ManageChannels, P.BanMembers])(
    "rejects opening without required permission %s",
    async (permission) => {
      const f = fixture();
      f.interaction.memberPermissions.remove(permission);
      await expect(f.open()).rejects.toThrow("Manage Channels and Ban Members");
      expect(f.interaction.showModal).not.toHaveBeenCalled();
    },
  );
  it("registers the modal handler and forwards the submitted name to the permission-checking service", async () => {
    const f = fixture();
    expect(componentHandlers).toContain(trapComponentHandler);
    expect(trapComponentHandler.matches(f.interaction.customId)).toBe(true);
    expect(trapComponentHandler.matches("rules:modal:user:guild")).toBe(false);
    await f.submit();
    expect(createTrapChannel).toHaveBeenCalledWith(f.interaction, {}, "custom-trap");
    expect(f.interaction.fields.getTextInputValue).toHaveBeenCalledWith("trap-channel-name");
  });
  it.each(["trap:create:other:guild", "trap:create:user:other"])(
    "rejects foreign form %s",
    async (id) => {
      const f = fixture();
      f.interaction.customId = id;
      await expect(f.submit()).rejects.toThrow("another user or server");
      expect(createTrapChannel).not.toHaveBeenCalled();
    },
  );
  it("rejects a DM modal", async () => {
    const f = fixture();
    f.interaction.guild = null;
    await expect(f.submit()).rejects.toThrow("another user or server");
    expect(createTrapChannel).not.toHaveBeenCalled();
    await expect(f.open()).rejects.toThrow("server-only");
  });
});
