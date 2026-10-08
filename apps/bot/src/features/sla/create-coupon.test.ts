import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type ModalBuilder,
} from "discord.js";
import type { ComponentInteraction, CommandExecutionContext } from "@/core/command.ts";
import { commands, componentHandlers } from "@/core/command-registry.ts";
import { claimComponentHandler, CLAIM_BUTTON_PREFIX } from "./claim-components.ts";
import { slaCommand } from "./sla.command.ts";
import { couponItems } from "@/shared/emojis/emoji-cache.ts";
import {
  autocompleteCouponItems,
  createCouponComponentHandler,
  handleCreateCoupon,
  parseCouponReward,
  renderCouponCard,
} from "./create-coupon.ts";

vi.mock("@/shared/emojis/emoji-cache.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/emojis/emoji-cache.ts")>()),
  getEmojiByName: (name: string) => ({ name, id: "1551725274725359766", animated: false }),
  displayEmoji: (name: string) => `<:${name}:1551725274725359766>`,
}));
const context = {} as CommandExecutionContext;
const user = { id: "user" };
const target = {
  id: "123456789012345678",
  type: ChannelType.GuildText,
  isSendable: () => true,
  isThread: () => false,
  permissionsFor: vi.fn(() => ({ has: (): boolean => true })),
  send: vi.fn<(message: unknown) => Promise<void>>(async () => {}),
};
const guild = {
  id: "guild",
  channels: { fetch: vi.fn(async () => target) },
  members: { fetch: vi.fn(async () => user), fetchMe: vi.fn(async () => ({ id: "bot" })) },
};
function actor(customId: string, modal = false) {
  return {
    customId,
    guild,
    guildId: "guild",
    user,
    isModalSubmit: () => modal,
    isButton: () => !modal,
    reply: vi.fn<(message: unknown) => Promise<void>>(async () => {}),
    editReply: vi.fn<(message: unknown) => Promise<void>>(async () => {}),
    update: vi.fn<(message: unknown) => Promise<void>>(async () => {}),
    showModal: vi.fn<(modal: ModalBuilder) => Promise<void>>(async () => {}),
    deferUpdate: vi.fn(async () => {}),
    deleteReply: vi.fn(async () => {}),
    fields: {
      getTextInputValue: vi.fn(() => "TESTCODE"),
      getSelectedChannels: vi.fn(() => ({ first: () => target })),
    },
  };
}
async function execute(request: ReturnType<typeof actor>) {
  await createCouponComponentHandler.execute(request as unknown as ComponentInteraction, context);
}
async function start(items: readonly (string | null)[] = []) {
  const request = {
    guild,
    guildId: "guild",
    user,
    channel: target,
    channelId: target.id,
    options: { getString: vi.fn((name: string) => items[Number(name.split("_")[1]) - 1] ?? null) },
    showModal: vi.fn<(modal: ModalBuilder) => Promise<void>>(async () => {}),
  };
  await handleCreateCoupon(request as unknown as ChatInputCommandInteraction);
  const modal = request.showModal.mock.calls[0]![0].toJSON();
  const token = modal.custom_id.split(":").at(-1)!;
  const submit = actor(modal.custom_id, true);
  await execute(submit);
  return { token, modal, submit };
}
const id = (action: string, token: string) => `sla:create-coupon:${action}:${token}`;
async function quantityModal(token: string, index = 0) {
  const request = actor(id(`quantity-${index}`, token));
  await execute(request);
  return request.showModal.mock.calls[0]![0].toJSON();
}
async function saveQuantity(token: string, quantity: string, index = 0) {
  const modal = await quantityModal(token, index);
  const request = actor(modal.custom_id, true);
  request.fields.getTextInputValue.mockReturnValue(quantity);
  await execute(request);
  return request;
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  target.permissionsFor.mockImplementation(() => ({ has: () => true }));
});

describe("interactive coupon creation", () => {
  it("registers eight optional autocomplete items without the legacy create command", () => {
    const sla = commands.find((command) => command.data.name === "sla")!.data.toJSON();
    expect(sla.options?.map((option) => option.name)).toContain("create-coupon");
    expect(sla.options?.map((option) => option.name)).not.toContain("create");
    const create = sla.options?.find((option) => option.name === "create-coupon");
    expect(create?.type).toBe(1);
    if (create?.type !== 1) throw new Error("Expected a subcommand");
    expect(create.options).toHaveLength(8);
    for (const [index, option] of create.options!.entries()) {
      expect(option).toMatchObject({ name: `item_${index + 1}`, autocomplete: true });
      expect(option.required ?? false).toBe(false);
    }
    expect(componentHandlers).toContain(createCouponComponentHandler);
    expect(claimComponentHandler.matches(`${CLAIM_BUTTON_PREFIX}TESTCODE`)).toBe(true);
  });
  it("searches the complete catalog with at most 25 sorted autocomplete suggestions", () => {
    const empty = autocompleteCouponItems("");
    expect(empty).toHaveLength(25);
    expect(empty.map((choice) => choice.name)).toEqual(
      empty.map((choice) => choice.name).sort((a, b) => a.localeCompare(b, "en")),
    );
    expect(autocompleteCouponItems(" GOLD ")).toEqual([{ name: "Gold", value: "Gold" }]);
    expect(autocompleteCouponItems("precision_design")).toEqual([
      { name: "Precision Design", value: "Precision_Design" },
    ]);
    expect(autocompleteCouponItems("workshop")).toEqual([
      { name: "Workshop of Brilliant Light Invitation", value: "Workshop_Of_Brillant_Light" },
    ]);
    expect(autocompleteCouponItems("not-a-reward")).toEqual([]);
    for (const [name, value] of Object.entries(couponItems))
      expect(autocompleteCouponItems(name)).toContainEqual({ name, value });
  });
  it("filters selected items before the 25-result limit", () => {
    const first = autocompleteCouponItems("");
    const excluded = first.map(({ value }) => value);
    const next = autocompleteCouponItems("", excluded);
    expect(next).toHaveLength(25);
    expect(next.every(({ value }) => !excluded.includes(value))).toBe(true);
    expect(autocompleteCouponItems("gold", ["Gold"])).toEqual([]);
  });
  it("excludes choices in other options but retains the focused option's own choice", async () => {
    const request = {
      options: {
        getSubcommand: () => "create-coupon",
        getFocused: () => ({ name: "item_1", value: "gold" }),
        getString: (name: string) =>
          name === "item_1" ? "Gold" : name === "item_8" ? "Design" : null,
      },
      createdTimestamp: Date.now(),
      client: { ws: { ping: 20 } },
      respond: vi.fn(),
    };
    await slaCommand.autocomplete(request as unknown as AutocompleteInteraction);
    expect(request.respond).toHaveBeenLastCalledWith([{ name: "Gold", value: "Gold" }]);
    request.options.getFocused = () => ({ name: "item_8", value: "gold" });
    await slaCommand.autocomplete(request as unknown as AutocompleteInteraction);
    expect(request.respond).toHaveBeenLastCalledWith([]);
    request.options.getFocused = () => ({ name: "item_9", value: "gold" });
    await slaCommand.autocomplete(request as unknown as AutocompleteInteraction);
    expect(request.respond).toHaveBeenLastCalledWith([]);
    request.options.getSubcommand = () => "redeem";
    await slaCommand.autocomplete(request as unknown as AutocompleteInteraction);
    expect(request.respond).toHaveBeenLastCalledWith([]);
  });
  it("opens code/channel entry with the current channel selected and allows publication without items", async () => {
    const { modal, submit } = await start();
    expect(modal.components).toHaveLength(2);
    expect(JSON.stringify(modal)).toContain(
      `"default_values":[{"id":"${target.id}","type":"channel"}]`,
    );
    expect(submit.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }),
    );
    const reply = JSON.stringify(submit.reply.mock.calls);
    expect(reply).toContain("Publish without items");
    expect(reply).toContain("This draft expires after 5 minutes.");
    expect(reply).not.toContain("Add items");
    expect(reply).not.toContain(`"type":${ComponentType.StringSelect}`);
    expect(target.send).not.toHaveBeenCalled();
  });
  it("publishes a reward-free card with the existing Claim prefix and thumbnail", async () => {
    const { token } = await start();
    await execute(actor(id("publish", token)));
    expect(target.send).toHaveBeenCalledOnce();
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("Claim coupon");
    expect(sent).toContain(`${CLAIM_BUTTON_PREFIX}TESTCODE`);
    expect(sent).toContain("https://cdn.discordapp.com/emojis/1556396384461262899.webp");
    expect(sent).not.toContain("Gold");
    expect(target.send).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      }),
    );
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("expired");
  });
  it("requires each selected quantity and opens a one-field modal for the correct item", async () => {
    const { token, submit } = await start(["Gold", "Design"]);
    const reply = JSON.stringify(submit.reply.mock.calls);
    expect(reply).toContain("0/2 quantities configured");
    expect(reply).toContain("quantity-0:");
    expect(reply).toContain("quantity-1:");
    expect(reply).toContain('"disabled":true');
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("every selected item");
    const modal = await quantityModal(token);
    expect(modal.components).toHaveLength(1);
    expect(modal.custom_id.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(modal)).toContain('"required":true');
    expect(JSON.stringify(modal)).toContain('"description":"Gold"');
    const invalid = actor(modal.custom_id, true);
    invalid.fields.getTextInputValue.mockReturnValue("0");
    await expect(execute(invalid)).rejects.toThrow("positive whole-number");
    expect(invalid.editReply).not.toHaveBeenCalled();
    await saveQuantity(token, "1000");
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("every selected item");
    const completed = await saveQuantity(token, "2", 1);
    expect(JSON.stringify(completed.editReply.mock.calls)).toContain("2/2 quantities configured");
    expect(JSON.stringify(completed.editReply.mock.calls)).toContain('"disabled":false');
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("Gold:1551725274725359766> x1,000");
    expect(sent).toContain("Design:1551725274725359766> x2");
  });
  it("accepts sparse optional items and keeps their slash option positions", async () => {
    const { token, submit } = await start([null, "Gold", null, null, null, null, null, "Design"]);
    const reply = JSON.stringify(submit.reply.mock.calls);
    expect(reply).toContain("Item 2");
    expect(reply).toContain("Item 8");
    expect(reply).not.toContain("Next items");
    await expect(execute(actor(id("quantity-0", token)))).rejects.toThrow(
      "This draft is unavailable",
    );
    await saveQuantity(token, "5", 1);
    await saveQuantity(token, "6", 7);
    await execute(actor(id("publish", token)));
    expect(JSON.stringify(target.send.mock.calls)).toContain("x5");
    expect(JSON.stringify(target.send.mock.calls)).toContain("x6");
  });
  it("displays four selected items per page and publishes all eight", async () => {
    const items = [
      "Gold",
      "Design",
      "Precision_Design",
      "Special_Design",
      "Diamond",
      "Rune_Fragment",
      "Time_Crystal",
      "Guild_Point",
    ];
    const { token, submit } = await start(items);
    const first = JSON.stringify(submit.reply.mock.calls);
    expect(first).toContain("quantity-3:");
    expect(first).not.toContain("quantity-4:");
    const next = actor(id("page", token));
    await execute(next);
    const second = JSON.stringify(next.update.mock.calls);
    expect(second).toContain("quantity-4:");
    expect(second).toContain("quantity-7:");
    expect(second).not.toContain("quantity-3:");
    expect(second).toContain("Previous items");
    for (let index = 0; index < items.length; index++)
      await saveQuantity(token, String(index + 1), index);
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    for (const [index, item] of items.entries())
      expect(sent).toContain(`${item}:1551725274725359766> x${index + 1}`);
  });
  it("prefills saved quantities and rejects consumed or superseded forms", async () => {
    const { token } = await start(["Gold", "Design"]);
    await saveQuantity(token, "10");
    const old = await quantityModal(token);
    expect(JSON.stringify(old)).toContain('"value":"10"');
    const current = await quantityModal(token, 1);
    const stale = actor(old.custom_id, true);
    stale.fields.getTextInputValue.mockReturnValue("99");
    await expect(execute(stale)).rejects.toThrow("This draft is unavailable");
    const save = actor(current.custom_id, true);
    save.fields.getTextInputValue.mockReturnValue("2");
    await execute(save);
    await expect(execute(save)).rejects.toThrow("This draft is unavailable");
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("Gold:1551725274725359766> x10");
    expect(sent).toContain("Design:1551725274725359766> x2");
    expect(sent).not.toContain("x99");
  });
  it.each(["cancelled", "expired"])(
    "rejects quantity saves when the draft is %s during acknowledgement",
    async (reason) => {
      vi.useFakeTimers();
      const { token } = await start(["Gold"]);
      const modal = await quantityModal(token);
      const save = actor(modal.custom_id, true);
      save.fields.getTextInputValue.mockReturnValue("10");
      save.deferUpdate.mockImplementationOnce(async () => {
        if (reason === "cancelled") await execute(actor(id("cancel", token)));
        else vi.advanceTimersByTime(300_000);
      });
      await expect(execute(save)).rejects.toThrow("This form is unavailable");
      expect(save.editReply).not.toHaveBeenCalled();
      expect(target.send).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid catalog values and duplicate selections", async () => {
    await expect(start(["made-up-item"])).rejects.toThrow("autocomplete suggestions");
    await expect(start(["Gold", null, "Gold"])).rejects.toThrow("only once");
    expect(target.send).not.toHaveBeenCalled();
  });
  it.each(["0", "-1", "1.5", "NaN", "Infinity", "1e3", "9007199254740992", ""])(
    "rejects invalid quantity %s",
    (quantity) => {
      expect(() => parseCouponReward("Gold", quantity)).toThrow("positive whole-number");
    },
  );
  it("requires a valid catalog item and a positive safe integer", () => {
    expect(parseCouponReward(undefined, "")).toBeNull();
    expect(parseCouponReward("Precision_Design", " 42 ")).toEqual({
      item: "Precision_Design",
      quantity: 42,
    });
    expect(parseCouponReward("Mana_Power_Elixir_I", "5")).toEqual({
      item: "Mana_Power_Elixir_I",
      quantity: 5,
    });
    expect(() => parseCouponReward(undefined, "1")).toThrow();
    expect(() => parseCouponReward("unknown", "1")).toThrow();
  });
  it("rejects unsafe coupon codes and oversized Claim IDs", () => {
    expect(() => renderCouponCard("```", [])).toThrow();
    expect(() => renderCouponCard("a\nb", [])).toThrow();
    expect(() => renderCouponCard("é".repeat(80), [])).toThrow("too long");
    const card = renderCouponCard(" CODE-123 ", []).toJSON();
    expect(card.type).toBe(ComponentType.Container);
    expect(JSON.stringify(card)).toContain(`${CLAIM_BUTTON_PREFIX}CODE-123`);
  });
  it("rejects other users, other servers and the original five-minute deadline", async () => {
    vi.useFakeTimers();
    const { token } = await start(["Gold"]);
    const modal = await quantityModal(token);
    const foreign = actor(modal.custom_id, true);
    foreign.user = { id: "other" };
    await expect(execute(foreign)).rejects.toThrow("belongs to another user");
    const otherGuild = actor(modal.custom_id, true);
    otherGuild.guildId = "other";
    await expect(execute(otherGuild)).rejects.toThrow("belongs to another user");
    vi.advanceTimersByTime(299_999);
    await saveQuantity(token, "10");
    vi.advanceTimersByTime(1);
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("expired");
    expect(target.send).not.toHaveBeenCalled();
  });
  it("renders title and code beside the thumbnail, then items and the Primary Claim row", () => {
    const card = renderCouponCard("TESTCODE", [{ item: "Gold", quantity: 10 }]).toJSON();
    expect(card.components[0]).toMatchObject({
      type: ComponentType.Section,
      components: [
        { type: ComponentType.TextDisplay, content: "# Claim coupon" },
        { type: ComponentType.TextDisplay, content: "```\nTESTCODE\n```" },
      ],
      accessory: {
        type: ComponentType.Thumbnail,
        media: { url: "https://cdn.discordapp.com/emojis/1556396384461262899.webp" },
      },
    });
    expect(card.components[1]).toMatchObject({ type: ComponentType.Separator, divider: true });
    expect(card.components[2]).toMatchObject({
      type: ComponentType.TextDisplay,
      content: "## Rewards\n**<:Gold:1551725274725359766> x10**",
    });
    expect(card.components[3]).toMatchObject({ type: ComponentType.Separator, divider: true });
    expect(card.components[4]).toMatchObject({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Primary,
          label: "Claim",
          custom_id: `${CLAIM_BUTTON_PREFIX}TESTCODE`,
        },
      ],
    });
    const empty = renderCouponCard("TESTCODE", []).toJSON();
    expect(empty.components).toHaveLength(2);
    expect(empty.components[1]).toMatchObject({ type: ComponentType.ActionRow });
    expect(JSON.stringify(empty)).not.toContain("Rewards");
    expect(empty.components.some((component) => component.type === ComponentType.Separator)).toBe(
      false,
    );
  });
  it.each(["publish", "cancel"])(
    "shows a terminal confirmation and deletes it after 10 seconds on %s",
    async (action) => {
      vi.useFakeTimers();
      const { token } = await start();
      const request = actor(id(action, token));
      await execute(request);
      expect(request.deleteReply).not.toHaveBeenCalled();
      expect(request.deferUpdate).toHaveBeenCalledOnce();
      expect(request.editReply).toHaveBeenCalledOnce();
      expect(JSON.stringify(request.editReply.mock.calls)).toContain(
        action === "publish" ? "Coupon published" : "Coupon creation cancelled",
      );
      expect(vi.getTimerCount()).toBe(1);
      expect(target.send).toHaveBeenCalledTimes(action === "cancel" ? 0 : 1);
      if (action === "publish")
        expect(target.send.mock.invocationCallOrder[0]).toBeLessThan(
          request.editReply.mock.invocationCallOrder[0]!,
        );
      await vi.advanceTimersByTimeAsync(9_999);
      expect(request.deleteReply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(request.deleteReply).toHaveBeenCalledOnce();
    },
  );
  it("ignores deletion errors on an already-dismissed reply and cancels without publication", async () => {
    vi.useFakeTimers();
    const { token } = await start(["Gold"]);
    const cancel = actor(id("cancel", token));
    cancel.deleteReply.mockRejectedValueOnce(new Error("Unknown Message"));
    await execute(cancel);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cancel.deleteReply).toHaveBeenCalledOnce();
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("expired");
    expect(target.send).not.toHaveBeenCalled();
  });
  it("checks channel permissions and keeps failed drafts retryable", async () => {
    const { token } = await start();
    target.permissionsFor.mockImplementation(() => ({ has: () => false }));
    const failed = actor(id("publish", token));
    await expect(execute(failed)).rejects.toThrow("Both you and the bot");
    expect(failed.deleteReply).not.toHaveBeenCalled();
    expect(target.send).not.toHaveBeenCalled();
    target.permissionsFor.mockImplementation(() => ({ has: () => true }));
    await execute(actor(id("publish", token)));
    expect(target.send).toHaveBeenCalledOnce();
  });
  it("prevents duplicate publication while the first request is in progress", async () => {
    const { token } = await start();
    const pending = execute(actor(id("publish", token)));
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("already being published");
    await pending;
    expect(target.send).toHaveBeenCalledOnce();
  });
});
