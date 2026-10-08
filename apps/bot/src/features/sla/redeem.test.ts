import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComponentType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ModalBuilder,
} from "discord.js";
import type { CommandExecutionContext, ComponentInteraction } from "@/core/command.ts";
import { slaCommand } from "./sla.command.ts";
import { handleRedeem, redeemComponentHandler } from "./redeem.ts";
import { redeemCoupon } from "./coupon.client.ts";

vi.mock("./coupon.client.ts", () => ({ redeemCoupon: vi.fn() }));
const context = {} as CommandExecutionContext;
afterEach(() => vi.resetAllMocks());

describe("simplified /sla redeem", () => {
  it("registers no slash options", () => {
    const redeem = slaCommand.data.toJSON().options?.find((option) => option.name === "redeem");
    expect(redeem?.type).toBe(1);
    if (redeem?.type !== 1) throw new Error("Expected a subcommand");
    expect(redeem.options ?? []).toEqual([]);
  });
  it("always opens the required code/PID modal without reading slash arguments or calling the API", async () => {
    const interaction = {
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "redeem",
        getString: vi.fn(() => {
          throw new Error("Slash arguments must not be read");
        }),
      },
      showModal: vi.fn<(modal: ModalBuilder) => Promise<void>>(async () => {}),
    };
    await slaCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(interaction.showModal).toHaveBeenCalledOnce();
    const modal = interaction.showModal.mock.calls[0]![0].toJSON();
    expect(modal.custom_id).toBe("sla:redeem");
    expect(modal.components).toHaveLength(2);
    const fields = modal.components.flatMap((component) =>
      component.type === ComponentType.Label && component.component.type === ComponentType.TextInput
        ? [component.component]
        : [],
    );
    expect(fields.map(({ custom_id }) => custom_id)).toEqual(["coupon", "pid"]);
    for (const field of fields) {
      expect(field.required).toBe(true);
      expect(field.value).toBeUndefined();
    }
    expect(interaction.options.getString).not.toHaveBeenCalled();
    expect(redeemCoupon).not.toHaveBeenCalled();
  });
  it("does not need an options resolver when opening the modal directly", async () => {
    const interaction = { showModal: vi.fn() };
    await handleRedeem(interaction as unknown as ChatInputCommandInteraction);
    expect(interaction.showModal).toHaveBeenCalledOnce();
  });
  it("redeems trimmed values from the modal and confirms privately", async () => {
    vi.mocked(redeemCoupon).mockResolvedValue({
      errorCode: 200,
      errorMessage: "SUCCESS",
      rewardType: "coupon",
      success: true,
      resultData: [
        {
          productName: "Reward",
          productImageUrl: "https://example.com/reward.webp",
          userSelectionRate: 0,
        },
      ],
    });
    const interaction = {
      isModalSubmit: () => true,
      fields: { getTextInputValue: (name: string) => (name === "coupon" ? " CODE " : " PID ") },
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn(async () => {}),
    };
    await redeemComponentHandler.execute(interaction as unknown as ComponentInteraction, context);
    expect(redeemCoupon).toHaveBeenCalledExactlyOnceWith("CODE", "PID");
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: "Coupon redeemed.", description: "Reward" })],
      }),
    );
  });
  it.each([24004, 400])("preserves redemption errors for API code %s", async (errorCode) => {
    vi.mocked(redeemCoupon).mockResolvedValue({ errorCode });
    const interaction = {
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => "VALUE" },
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn(async () => {}),
    };
    await expect(
      redeemComponentHandler.execute(interaction as unknown as ComponentInteraction, context),
    ).rejects.toThrow(
      errorCode === 24004 ? "already been claimed" : "Check your coupon code and player ID",
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
