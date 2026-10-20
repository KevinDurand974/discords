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
import { getCouponProduct, redeemCoupon } from "./coupon.client.ts";

vi.mock("./coupon.client.ts", () => ({
  redeemCoupon: vi.fn(),
  getCouponProduct: vi.fn(async () => ({
    productName: "Reward",
    productImageUrl: "https://example.com/reward.webp",
  })),
}));
const context = {} as CommandExecutionContext;
afterEach(() => vi.clearAllMocks());

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
      success: true,
      resultData: [{ quantity: 1 }],
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
    expect(getCouponProduct).toHaveBeenCalledExactlyOnceWith("CODE", "PID");
    expect(vi.mocked(getCouponProduct).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(redeemCoupon).mock.invocationCallOrder[0]!,
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.IsComponentsV2 }),
    );
    const reply = JSON.stringify(interaction.editReply.mock.calls);
    expect(reply).toContain("# Coupon redeemed.\\n## Reward");
    expect(reply).toContain("https://example.com/reward.webp");
    expect(reply).not.toContain("embeds");
  });
  it("still redeems with the default image and no subtitle when metadata is missing", async () => {
    vi.mocked(getCouponProduct).mockResolvedValueOnce(undefined);
    vi.mocked(redeemCoupon).mockResolvedValue({
      errorCode: 200,
      errorMessage: "SUCCESS",
      resultData: [{ quantity: 1 }],
      success: true,
    });
    const interaction = {
      isModalSubmit: () => true,
      fields: { getTextInputValue: (name: string) => (name === "coupon" ? "CODE" : "PID") },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn(),
    };
    await redeemComponentHandler.execute(interaction as unknown as ComponentInteraction, context);
    expect(redeemCoupon).toHaveBeenCalledExactlyOnceWith("CODE", "PID");
    const reply = JSON.stringify(interaction.editReply.mock.calls);
    expect(reply).toContain('"content":"# Coupon redeemed."');
    expect(reply).toContain("https://cdn.discordapp.com/emojis/1556396384461262899.webp");
    expect(reply).not.toContain("##");
  });
  it("does not redeem when coupon metadata cannot be loaded", async () => {
    vi.mocked(getCouponProduct).mockRejectedValueOnce(new Error("Metadata unavailable"));
    const interaction = {
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => "VALUE" },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };
    await expect(
      redeemComponentHandler.execute(interaction as unknown as ComponentInteraction, context),
    ).rejects.toThrow("Metadata unavailable");
    expect(redeemCoupon).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
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
