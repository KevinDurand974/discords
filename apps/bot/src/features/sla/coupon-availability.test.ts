import { afterEach, describe, expect, it, vi } from "vitest";
import { type ComponentInteraction, type CommandExecutionContext } from "@/core/command.ts";
import { claimComponentHandler } from "./claim-components.ts";
import { redeemCoupon } from "./coupon.client.ts";
import {
  assertCouponAvailable,
  claimCustomId,
  parseClaimCustomId,
  parseCouponAvailability,
  CLAIM_BUTTON_PREFIX,
  CLAIM_MODAL_PREFIX,
} from "./coupon-availability.ts";

vi.mock("./coupon.client.ts", () => ({ redeemCoupon: vi.fn(async () => ({ errorCode: 200 })) }));
const start = Date.parse("2030-12-25T18:30:00Z") / 1000;
const end = start + 3600;
const availability = { startsAt: start, endsAt: end };
const context = {} as CommandExecutionContext;
function request(customId: string, modal = false) {
  return {
    customId,
    isButton: () => !modal,
    showModal: vi.fn(async (_modal: unknown) => {}),
    fields: { getTextInputValue: () => "PID" },
    deferReply: vi.fn(async (_options: unknown) => {}),
    editReply: vi.fn(async (_message: unknown) => {}),
    deleteReply: vi.fn(async () => {}),
  };
}
const execute = (interaction: ReturnType<typeof request>) =>
  claimComponentHandler.execute(interaction as unknown as ComponentInteraction, context);
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("coupon availability", () => {
  it("parses optional UTC dates with 24-hour and AM/PM times", () => {
    expect(parseCouponAvailability("25/12/2030 6:30 PM", "2030/12/25 19:30")).toEqual(availability);
    expect(parseCouponAvailability("", "")).toEqual({ startsAt: undefined, endsAt: undefined });
    expect(parseCouponAvailability("25/12/2030", "").startsAt).toBe(
      Date.parse("2030-12-25T00:00:00Z") / 1000,
    );
  });
  it.each([
    ["31/02/2030", ""],
    ["25/12/2030 18:30", "25/12/2030 18:30"],
    ["25/12/2030 18:30", "24/12/2030"],
    ["25/12/2030 18:30+02:00", ""],
    ["25/12/2030 +02", ""],
    ["25/12/2030 +02:00", ""],
    ["25/12/2030 18H30+02:00", ""],
    ["25/12/2030 UTC+02", ""],
  ])("rejects invalid or non-UTC inputs %s %s", (from, until) => {
    expect(() => parseCouponAvailability(from, until)).toThrow();
  });
  it.each([{}, { startsAt: start }, { endsAt: end }, availability])(
    "roundtrips dates in persistent component IDs: %j",
    (window) => {
      const code = "CODE?test:é%";
      const button = claimCustomId(code, window);
      const modal = claimCustomId(code, window, true);
      expect(button.length).toBeLessThanOrEqual(100);
      expect(modal.length).toBeLessThanOrEqual(100);
      expect(parseClaimCustomId(button, CLAIM_BUTTON_PREFIX)).toEqual({
        code,
        availability: window,
      });
      expect(parseClaimCustomId(modal, CLAIM_MODAL_PREFIX)).toEqual({ code, availability: window });
    },
  );
  it("retains legacy IDs and refuses oversized scheduled IDs", () => {
    expect(claimCustomId("TESTCODE")).toBe("sla:claim:TESTCODE");
    expect(() => claimCustomId("A".repeat(80), availability)).toThrow("shorter code");
  });
  it.each([
    "sla:claim:%ZZ",
    "sla:claim:",
    "sla:claim:CODE?bad",
    "sla:claim:CODE?.",
    "sla:claim:CODE?z.1",
    "sla:claim:CODE?zzzzzzzzzzzzzzzz.",
    "sla:claim:CODE?1.2?3",
  ])("rejects malformed IDs %s", (id) => {
    expect(parseClaimCustomId(id, CLAIM_BUTTON_PREFIX)).toBeNull();
  });
  it("allows the start boundary and rejects the expiry boundary", () => {
    expect(() => assertCouponAvailable(availability, start - 1)).toThrow("available from");
    expect(() => assertCouponAvailable(availability, start)).not.toThrow();
    expect(() => assertCouponAvailable(availability, end - 0.001)).not.toThrow();
    expect(() => assertCouponAvailable(availability, end)).toThrow("expired");
    expect(() => assertCouponAvailable({ endsAt: end }, start - 1)).not.toThrow();
    expect(() => assertCouponAvailable({ startsAt: start }, end + 1)).not.toThrow();
  });
  it("checks the dates before opening the modal and preserves them in the form ID", async () => {
    vi.useFakeTimers();
    vi.setSystemTime((start - 1) * 1000);
    const interaction = request(claimCustomId("TESTCODE", availability));
    await expect(execute(interaction)).rejects.toThrow("available from");
    expect(interaction.showModal).not.toHaveBeenCalled();
    vi.setSystemTime(start * 1000);
    await execute(interaction);
    expect(JSON.stringify(interaction.showModal.mock.calls)).toContain(
      claimCustomId("TESTCODE", availability, true),
    );
    vi.setSystemTime(end * 1000);
    await expect(execute(interaction)).rejects.toThrow("expired");
  });
  it("rechecks expiry on submission without calling the coupon API", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(end * 1000);
    const interaction = request(claimCustomId("TESTCODE", availability, true), true);
    await expect(execute(interaction)).rejects.toThrow("expired");
    expect(redeemCoupon).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });
  it("rechecks expiry after deferring and before calling the API", async () => {
    vi.useFakeTimers();
    vi.setSystemTime((end - 1) * 1000);
    const interaction = request(claimCustomId("TESTCODE", availability, true), true);
    interaction.deferReply.mockImplementation(async () => {
      vi.setSystemTime(end * 1000);
    });
    await expect(execute(interaction)).rejects.toThrow("expired");
    expect(redeemCoupon).not.toHaveBeenCalled();
  });
  it("redeems inside the window and supports unrestricted legacy forms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start * 1000);
    await execute(request(claimCustomId("TESTCODE", availability, true), true));
    expect(redeemCoupon).toHaveBeenCalledWith("TESTCODE", "PID");
    await execute(request("sla:claim-modal:LEGACY", true));
    expect(redeemCoupon).toHaveBeenCalledWith("LEGACY", "PID");
  });
});
