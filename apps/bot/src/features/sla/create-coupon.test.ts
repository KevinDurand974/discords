import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ModalBuilder,
} from "discord.js";
import type { ComponentInteraction, CommandExecutionContext } from "@/core/command.ts";
import { commands, componentHandlers } from "@/core/command-registry.ts";
import { claimComponentHandler, CLAIM_BUTTON_PREFIX } from "./claim-components.ts";
import { couponItems } from "@/shared/emojis/emoji-cache.ts";
import { getCouponProduct, redeemCoupon } from "./coupon.client.ts";
import {
  normalizeCouponItem,
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
vi.mock("./coupon.client.ts", () => ({
  redeemCoupon: vi.fn(),
  getCouponProduct: vi.fn(async () => ({
    productName: "Hunter reward",
    productImageUrl: "https://example.com/coupon.webp",
  })),
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
      getTextInputValue: vi.fn((name?: string): string => {
        if (name !== "code") throw new Error(`Unexpected creation field: ${name}`);
        return "TESTCODE";
      }),
      getSelectedChannels: vi.fn(() => ({ first: () => target })),
    },
  };
}
async function execute(request: ReturnType<typeof actor>) {
  await createCouponComponentHandler.execute(request as unknown as ComponentInteraction, context);
}
async function start(items: readonly string[] = []) {
  const request = {
    guild,
    guildId: "guild",
    user,
    channel: target,
    channelId: target.id,
    showModal: vi.fn<(modal: ModalBuilder) => Promise<void>>(async () => {}),
  };
  await handleCreateCoupon(request as unknown as ChatInputCommandInteraction);
  const modal = request.showModal.mock.calls[0]![0].toJSON();
  const token = modal.custom_id.split(":").at(-1)!;
  const submit = actor(modal.custom_id, true);
  await execute(submit);
  let view = JSON.stringify(submit.reply.mock.calls);
  for (const item of items) {
    const saved = await saveItem(token, item);
    view = JSON.stringify(saved.editReply.mock.calls);
  }
  if (items.length > 4) {
    const page = actor(id("page", token));
    await execute(page);
    view = JSON.stringify(page.update.mock.calls);
  }
  return { token, modal, submit, view };
}
const id = (action: string, token: string) => `sla:create-coupon:${action}:${token}`;
async function itemModal(token: string, index?: number) {
  const request = actor(id(index === undefined ? "add-item" : `edit-item-${index}`, token));
  await execute(request);
  return request.showModal.mock.calls[0]![0].toJSON();
}
async function saveItem(token: string, item: string, quantity = "1", index?: number) {
  const modal = await itemModal(token, index);
  const request = actor(modal.custom_id, true);
  request.fields.getTextInputValue.mockImplementation((name?: string) =>
    name === "item" ? item : quantity,
  );
  await execute(request);
  return request;
}
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
  it("registers a parameter-free draft command without the legacy create command", () => {
    const sla = commands.find((command) => command.data.name === "sla")!.data.toJSON();
    expect(sla.options?.map((option) => option.name)).toContain("create-coupon");
    expect(sla.options?.map((option) => option.name)).not.toContain("create");
    const create = sla.options?.find((option) => option.name === "create-coupon");
    expect(create?.type).toBe(1);
    if (create?.type !== 1) throw new Error("Expected a subcommand");
    expect(create.options ?? []).toHaveLength(0);
    expect(componentHandlers).toContain(createCouponComponentHandler);
    expect(claimComponentHandler.matches(`${CLAIM_BUTTON_PREFIX}TESTCODE`)).toBe(true);
  });
  it("recognizes catalog labels and identifiers without changing custom names", () => {
    expect(normalizeCouponItem(" GOLD ")).toBe("Gold");
    expect(normalizeCouponItem("precision design")).toBe("Precision_Design");
    expect(normalizeCouponItem("New reward")).toBe("New reward");
    for (const [label, name] of Object.entries(couponItems)) {
      expect(normalizeCouponItem(label)).toBe(name);
      expect(normalizeCouponItem(name)).toBe(name);
    }
  });
  it("adds, renames, changes quantity and removes rewards only in the draft", async () => {
    const { token, view } = await start();
    expect(view).toContain("Add item");
    await saveItem(token, "gold", "");
    const edit = await itemModal(token, 0);
    expect(JSON.stringify(edit)).toContain('"value":"Gold"');
    expect(JSON.stringify(edit)).toContain('"value":"1"');
    const changed = await saveItem(token, "precision design", "15", 0);
    expect(JSON.stringify(changed.editReply.mock.calls)).toContain("Precision Design x15");
    await saveItem(token, "New reward", "3");
    const remove = actor(id("remove-item-0", token));
    await execute(remove);
    expect(JSON.stringify(remove.editReply.mock.calls)).not.toContain("Precision Design");
    expect(JSON.stringify(remove.editReply.mock.calls)).toContain("Item 1");
    expect(target.send).not.toHaveBeenCalled();
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("New reward x3");
    expect(sent).not.toContain("Precision");
    expect(sent).not.toContain("Add item");
    await expect(saveItem(token, "Gold")).rejects.toThrow("expired");
  });
  it("rejects duplicate edits and invalid quantities without changing existing rewards", async () => {
    const { token } = await start(["Gold", "Precision_Design"]);
    await expect(saveItem(token, " gold ", "1", 1)).rejects.toThrow("only once");
    await expect(saveItem(token, "precision design")).rejects.toThrow("only once");
    await expect(saveItem(token, "Design", "-2", 0)).rejects.toThrow("positive whole-number");
    await saveItem(token, "Gold", "2", 0);
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("Gold:1551725274725359766> x2");
    expect(sent).toContain("Precision_Design:1551725274725359766> x1");
  });
  it("caps drafts at eight items and permits another addition after removal", async () => {
    const { token, view } = await start(Array.from({ length: 8 }, (_, i) => `Reward ${i}`));
    expect(view).toContain('"label":"Add item","style":1,"disabled":true');
    await expect(itemModal(token)).rejects.toThrow("at most eight");
    await execute(actor(id("remove-item-7", token)));
    await saveItem(token, "Replacement");
    const edit = await itemModal(token, 8);
    expect(JSON.stringify(edit)).toContain("Replacement");
    await execute(actor(id("publish", token)));
    expect(JSON.stringify(target.send.mock.calls)).toContain("Replacement x1");
    expect(JSON.stringify(target.send.mock.calls)).not.toContain("Reward 7");
  });
  it("clamps pagination after removal and supports deleting every reward", async () => {
    const { token } = await start(["Gold", "Design", "A", "B", "C"]);
    await execute(actor(id("page", token)));
    const remove = actor(id("remove-item-4", token));
    await execute(remove);
    const view = JSON.stringify(remove.editReply.mock.calls);
    expect(view).toContain("quantity-0:");
    expect(view).not.toContain("Previous items");
    for (let index = 0; index < 4; index++) await execute(actor(id(`remove-item-${index}`, token)));
    await execute(actor(id("publish", token)));
    expect(JSON.stringify(target.send.mock.calls)).not.toContain("Gold");
  });
  it("rejects stale item and quantity forms after removal without reusing item IDs", async () => {
    const { token } = await start(["Gold"]);
    const edit = await itemModal(token, 0);
    const quantity = await quantityModal(token, 0);
    await execute(actor(id("remove-item-0", token)));
    await saveItem(token, "Design");
    for (const modal of [edit, quantity]) {
      const save = actor(modal.custom_id, true);
      save.fields.getTextInputValue.mockReturnValue("9");
      await expect(execute(save)).rejects.toThrow("unavailable");
    }
    await expect(execute(actor(id("remove-item-0", token)))).rejects.toThrow("already removed");
    await expect(itemModal(token, 0)).rejects.toThrow("removed");
    await execute(actor(id("publish", token)));
    expect(JSON.stringify(target.send.mock.calls)).toContain("Design:1551725274725359766> x1");
  });
  it("rejects consumed and superseded item forms", async () => {
    const { token } = await start();
    const old = await itemModal(token);
    await saveItem(token, "Gold");
    const stale = actor(old.custom_id, true);
    stale.fields.getTextInputValue.mockReturnValue("Design");
    await expect(execute(stale)).rejects.toThrow("unavailable");
    const current = await itemModal(token, 0);
    const save = actor(current.custom_id, true);
    save.fields.getTextInputValue.mockImplementation((name?: string) =>
      name === "item" ? "Gold" : "5",
    );
    await execute(save);
    await expect(execute(save)).rejects.toThrow("unavailable");
  });
  it.each(["cancelled", "expired", "removed"])(
    "rejects item saves when the draft becomes %s during acknowledgement",
    async (reason) => {
      vi.useFakeTimers();
      const { token } = await start(["Gold"]);
      const modal = await itemModal(token, 0);
      const save = actor(modal.custom_id, true);
      save.fields.getTextInputValue.mockImplementation((name?: string) =>
        name === "item" ? "Design" : "1",
      );
      save.deferUpdate.mockImplementationOnce(async () => {
        if (reason === "cancelled") await execute(actor(id("cancel", token)));
        else if (reason === "removed") await execute(actor(id("remove-item-0", token)));
        else vi.advanceTimersByTime(300_000);
      });
      await expect(execute(save)).rejects.toThrow("unavailable");
      expect(save.editReply).not.toHaveBeenCalled();
    },
  );
  it("restricts draft item controls to their creator and server", async () => {
    const { token } = await start(["Gold"]);
    for (const action of ["add-item", "edit-item-0", "remove-item-0"]) {
      const otherUser = actor(id(action, token));
      otherUser.user = { id: "other" };
      await expect(execute(otherUser)).rejects.toThrow();
      const otherGuild = actor(id(action, token));
      otherGuild.guildId = "other";
      await expect(execute(otherGuild)).rejects.toThrow();
    }
  });
  it("opens code/channel entry with the current channel selected and allows publication without items", async () => {
    const { modal, submit } = await start();
    expect(modal.components).toHaveLength(2);
    expect(JSON.stringify(modal)).not.toContain('"custom_id":"pid"');
    expect(submit.fields.getTextInputValue).toHaveBeenCalledExactlyOnceWith("code");
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
  it("edits and clears optional UTC availability through a revision-bound modal", async () => {
    const { token } = await start(["Gold"]);
    const open = async () => {
      const click = actor(id("availability", token));
      await execute(click);
      return click.showModal.mock.calls[0]![0].toJSON();
    };
    const old = await open();
    const modal = await open();
    expect(modal.components).toHaveLength(2);
    expect(JSON.stringify(modal)).toContain("UTC+0");
    expect(JSON.stringify(modal)).toContain('"required":false');
    expect(JSON.stringify(modal)).toContain('"label":"Available from"');
    expect(JSON.stringify(modal)).toContain('"label":"Available until"');
    await expect(execute(actor(old.custom_id, true))).rejects.toThrow("unavailable");
    const save = actor(modal.custom_id, true);
    save.fields.getTextInputValue.mockImplementation((name?: string) =>
      name === "starts-at" ? "25/12/2030 18:30" : "25/12/2030 19:30",
    );
    await execute(save);
    expect(JSON.stringify(save.editReply.mock.calls)).toContain(
      `**Available from:** <t:${Date.parse("2030-12-25T18:30:00Z") / 1000}:F>`,
    );
    expect(JSON.stringify(save.editReply.mock.calls)).toContain(
      `**Available until:** <t:${Date.parse("2030-12-25T19:30:00Z") / 1000}:F>`,
    );
    await expect(execute(save)).rejects.toThrow("unavailable");
    const prefilled = await open();
    expect(JSON.stringify(prefilled)).toContain('"value":"2030-12-25 18:30:00"');
    expect(JSON.stringify(prefilled)).toContain('"value":"2030-12-25 19:30:00"');
    const clear = actor(prefilled.custom_id, true);
    clear.fields.getTextInputValue.mockReturnValue("");
    await execute(clear);
    const cleared = JSON.stringify(clear.editReply.mock.calls);
    expect(cleared).not.toContain("**Available from:**");
    expect(cleared).not.toContain("**Available until:**");
    expect(cleared).not.toContain("Immediately");
    expect(cleared).not.toContain("No expiry");
    expect(cleared).toContain("Edit availability");
    await execute(actor(id("publish", token)));
    expect(JSON.stringify(target.send.mock.calls)).toContain('"custom_id":"sla:claim:TESTCODE"');
  });
  it("does not reactivate older availability forms when opens finish out of order", async () => {
    const { token } = await start();
    const first = actor(id("availability", token));
    let resolve!: () => void;
    first.showModal.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const opening = execute(first);
    const second = actor(id("availability", token));
    await execute(second);
    resolve();
    await opening;
    const old = actor(first.showModal.mock.calls[0]![0].toJSON().custom_id, true);
    old.fields.getTextInputValue.mockReturnValue("");
    await expect(execute(old)).rejects.toThrow("unavailable");
    const current = actor(second.showModal.mock.calls[0]![0].toJSON().custom_id, true);
    current.fields.getTextInputValue.mockReturnValue("");
    await expect(execute(current)).resolves.toBeUndefined();
  });
  it("accepts a submitted availability form before the open request finishes", async () => {
    const { token } = await start();
    const click = actor(id("availability", token));
    let resolve!: () => void;
    click.showModal.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const opening = execute(click);
    const save = actor(click.showModal.mock.calls[0]![0].toJSON().custom_id, true);
    save.fields.getTextInputValue.mockReturnValue("");
    try {
      await expect(execute(save)).resolves.toBeUndefined();
    } finally {
      resolve();
      await opening;
    }
    await expect(execute(save)).rejects.toThrow("unavailable");
  });
  it("does not clear a newer form when an earlier modal open fails", async () => {
    const { token } = await start();
    const first = actor(id("availability", token));
    let reject!: (error: Error) => void;
    first.showModal.mockImplementation(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    const opening = execute(first);
    const failed = expect(opening).rejects.toThrow("network");
    const second = actor(id("availability", token));
    await execute(second);
    reject(new Error("network"));
    await failed;
    const save = actor(second.showModal.mock.calls[0]![0].toJSON().custom_id, true);
    save.fields.getTextInputValue.mockReturnValue("");
    await expect(execute(save)).resolves.toBeUndefined();
  });
  it.each([{ startsAt: 0 }, { endsAt: 3600 }, { startsAt: 0, endsAt: 3600 }, {}])(
    "only displays configured availability dates: %j",
    (availability) => {
      const card = JSON.stringify(renderCouponCard("TESTCODE", [], availability).toJSON());
      expect(card.includes("🕒 **Available from:**")).toBe("startsAt" in availability);
      expect(card.includes("🕒 **Available until:**")).toBe("endsAt" in availability);
      expect(card).not.toContain("Immediately");
      expect(card).not.toContain("No expiry");
    },
  );
  it("publishes both availability dates in the card and persistent claim ID", async () => {
    const { token } = await start();
    const click = actor(id("availability", token));
    await execute(click);
    const modal = click.showModal.mock.calls[0]![0].toJSON();
    const save = actor(modal.custom_id, true);
    save.fields.getTextInputValue.mockImplementation((name?: string) =>
      name === "starts-at" ? "25/12/2030 18:30" : "25/12/2030 19:30",
    );
    await execute(save);
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain(
      `**Available from:** <t:${Date.parse("2030-12-25T18:30:00Z") / 1000}:F>`,
    );
    expect(sent).toContain(
      `**Available until:** <t:${Date.parse("2030-12-25T19:30:00Z") / 1000}:F>`,
    );
    expect(sent).not.toContain("Availability");
    expect(sent).not.toContain("UTC+0");
    expect(sent).not.toContain("`<t:");
    expect(sent).toContain('"custom_id":"sla:claim:TESTCODE?');
  });
  it("rejects reversed dates without changing the draft and prevents expired publication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-12-25T18:00:00Z"));
    const { token } = await start();
    const click = actor(id("availability", token));
    await execute(click);
    const modal = click.showModal.mock.calls[0]![0].toJSON();
    const save = actor(modal.custom_id, true);
    save.fields.getTextInputValue.mockImplementation((name?: string) =>
      name === "starts-at" ? "25/12/2030 18:30" : "25/12/2030 17:30",
    );
    await expect(execute(save)).rejects.toThrow(
      "**Available until** must be after **Available from**.",
    );
    expect(save.editReply).not.toHaveBeenCalled();
    save.fields.getTextInputValue.mockImplementation((name?: string) =>
      name === "starts-at" ? "" : "25/12/2030 17:30",
    );
    await execute(save);
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("expiry date has passed");
    expect(target.send).not.toHaveBeenCalled();
  });
  it("publishes a reward-free card with the existing Claim prefix and thumbnail", async () => {
    const { token } = await start();
    await execute(actor(id("publish", token)));
    expect(target.send).toHaveBeenCalledOnce();
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("Claim coupon");
    expect(sent).toContain(`${CLAIM_BUTTON_PREFIX}TESTCODE`);
    expect(sent).toContain("# Claim coupon\\n## Hunter reward");
    expect(sent).toContain("https://example.com/coupon.webp");
    expect(getCouponProduct).toHaveBeenCalledExactlyOnceWith(
      "TESTCODE",
      "B28D7AC7B5E34A6CA8B06ED800653165",
    );
    expect(sent).not.toContain("B28D7AC7B5E34A6CA8B06ED800653165");
    expect(sent).not.toContain("PID");
    expect(sent).not.toContain("Gold");
    expect(target.send).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      }),
    );
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("expired");
  });
  it("defaults quantities to 1 and opens an editable one-field modal for the correct item", async () => {
    const { token, view: reply } = await start(["Gold", "Design"]);
    expect(reply).toContain("2/2 quantities configured");
    expect(reply).toContain("quantity-0:");
    expect(reply).toContain("quantity-1:");
    expect(reply).toContain('"disabled":false');
    expect(reply).toContain(" x1");
    const modal = await quantityModal(token);
    expect(modal.components).toHaveLength(1);
    expect(modal.custom_id.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(modal)).toContain('"required":true');
    expect(JSON.stringify(modal)).toContain('"description":"Gold"');
    expect(JSON.stringify(modal)).toContain('"value":"1"');
    const invalid = actor(modal.custom_id, true);
    invalid.fields.getTextInputValue.mockReturnValue("0");
    await expect(execute(invalid)).rejects.toThrow("positive whole-number");
    expect(invalid.editReply).not.toHaveBeenCalled();
    await saveQuantity(token, "1000");
    const completed = await saveQuantity(token, "2", 1);
    expect(JSON.stringify(completed.editReply.mock.calls)).toContain("2/2 quantities configured");
    expect(JSON.stringify(completed.editReply.mock.calls)).toContain('"disabled":false');
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("Gold:1551725274725359766> x1,000");
    expect(sent).toContain("Design:1551725274725359766> x2");
  });
  it("numbers draft items consecutively", async () => {
    const { token, view } = await start(["Gold", "Design"]);
    expect(view).toContain("Item 1");
    expect(view).toContain("Item 2");
    expect(view).not.toContain("Next items");
    await saveQuantity(token, "5", 0);
    await saveQuantity(token, "6", 1);
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
    const { token, view: first } = await start(items);
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
  it.each(["removed", "superseded"])(
    "does not revive a %s quantity form when its modal open finishes late",
    async (reason) => {
      const { token } = await start(["Gold"]);
      let finish!: () => void;
      const click = actor(id("quantity-0", token));
      click.showModal.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const opening = execute(click);
      const modal = click.showModal.mock.calls[0]![0].toJSON();
      if (reason === "removed") await execute(actor(id("remove-item-0", token)));
      else await quantityModal(token);
      finish();
      await opening;
      const save = actor(modal.custom_id, true);
      save.fields.getTextInputValue.mockReturnValue("10");
      await expect(execute(save)).rejects.toThrow("unavailable");
      expect(save.editReply).not.toHaveBeenCalled();
    },
  );
  it("accepts quantity submission before the modal-open request completes", async () => {
    const { token } = await start(["Gold"]);
    const click = actor(id("quantity-0", token));
    click.showModal.mockImplementationOnce(async (modal) => {
      const save = actor(modal.toJSON().custom_id, true);
      save.fields.getTextInputValue.mockReturnValue("12");
      await execute(save);
    });
    await execute(click);
    await execute(actor(id("publish", token)));
    expect(JSON.stringify(target.send.mock.calls)).toContain("Gold:1551725274725359766> x12");
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
  it("publishes custom names with QuestionMark and all quantities defaulting to 1", async () => {
    const { token, view: preview } = await start(["  New reward  ", "Gold"]);
    expect(preview).toContain("QuestionMark:1551725274725359766> New reward x1");
    expect(preview).not.toContain("undefined");
    const modal = await quantityModal(token);
    expect(JSON.stringify(modal)).toContain('"description":"New reward"');
    expect(JSON.stringify(modal)).toContain('"value":"1"');
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("QuestionMark:1551725274725359766> New reward x1");
    expect(sent).toContain("Gold:1551725274725359766> x1");
  });
  it("rejects empty, oversized, multiline and duplicate names", async () => {
    await expect(start(["   "])).rejects.toThrow("item name");
    await expect(start(["a".repeat(101)])).rejects.toThrow("item name");
    await expect(start(["a\nb"])).rejects.toThrow("line breaks");
    await expect(start(["Gold", " gold "])).rejects.toThrow("only once");
    await expect(start(["Custom", "Custom"])).rejects.toThrow("only once");
    expect(target.send).not.toHaveBeenCalled();
  });
  it.each(["0", "-1", "1.5", "NaN", "Infinity", "1e3", "9007199254740992", ""])(
    "rejects invalid quantity %s",
    (quantity) => {
      expect(() => parseCouponReward("Gold", quantity)).toThrow("positive whole-number");
    },
  );
  it("accepts catalog and custom items with a positive safe integer", () => {
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
    expect(parseCouponReward("unknown", "1")).toEqual({ item: "unknown", quantity: 1 });
    expect(() => parseCouponReward("  ", "1")).toThrow();
  });
  it("escapes Markdown in custom reward names", () => {
    const card = renderCouponCard("TESTCODE", [{ item: "**Custom**", quantity: 1 }]).toJSON();
    expect(card.components[2]).toMatchObject({
      content: "## Rewards\n**<:QuestionMark:1551725274725359766> \\*\\*Custom\\*\\* x1**",
    });
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
  it("publishes with the default image and no subtitle when metadata is missing", async () => {
    const { token } = await start(["Gold"]);
    vi.mocked(getCouponProduct).mockResolvedValueOnce(undefined);
    await execute(actor(id("publish", token)));
    const sent = JSON.stringify(target.send.mock.calls);
    expect(sent).toContain("https://cdn.discordapp.com/emojis/1556396384461262899.webp");
    expect(sent).toContain('"content":"# Claim coupon"');
    expect(sent).not.toContain("Hunter reward");
    expect(sent).toContain("Gold:1551725274725359766> x1");
    expect(sent).toContain(`${CLAIM_BUTTON_PREFIX}TESTCODE`);
    expect(redeemCoupon).not.toHaveBeenCalled();
  });
  it("does not publish or redeem when metadata fails and keeps the draft retryable", async () => {
    const { token } = await start();
    vi.mocked(getCouponProduct).mockRejectedValueOnce(new Error("Metadata unavailable"));
    await expect(execute(actor(id("publish", token)))).rejects.toThrow("Metadata unavailable");
    expect(target.send).not.toHaveBeenCalled();
    expect(redeemCoupon).not.toHaveBeenCalled();
    await execute(actor(id("publish", token)));
    expect(getCouponProduct).toHaveBeenCalledWith("TESTCODE", "B28D7AC7B5E34A6CA8B06ED800653165");
    expect(target.send).toHaveBeenCalledOnce();
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
