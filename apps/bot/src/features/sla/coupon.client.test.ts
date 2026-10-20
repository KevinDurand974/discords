import { afterEach, expect, it, vi } from "vitest";
import { ofetch } from "ofetch";
import { getCouponProduct, redeemCoupon } from "./coupon.client.ts";

vi.mock("ofetch", () => ({ ofetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("loads coupon metadata with GET /reward and never redeems it", async () => {
  vi.mocked(ofetch).mockResolvedValue({
    errorCode: 200,
    resultData: [
      { productName: "Hunter reward", productImageUrl: "https://example.com/coupon.webp" },
    ],
  });
  await expect(getCouponProduct("CODE", "PID")).resolves.toEqual({
    productName: "Hunter reward",
    productImageUrl: "https://example.com/coupon.webp",
  });
  expect(ofetch).toHaveBeenCalledExactlyOnceWith("https://coupon.netmarble.com/api/coupon/reward", {
    query: { gameCode: "sololv", couponCode: "CODE", langCd: "EN_US", pid: "PID" },
    retry: 0,
  });
});

it("gives the coupon with POST and JSON body instead of query parameters", async () => {
  const response = { errorCode: 200, resultData: [{ quantity: 1 }], success: true };
  vi.mocked(ofetch).mockResolvedValue(response);
  await expect(redeemCoupon("CODE", "PID")).resolves.toEqual(response);
  expect(ofetch).toHaveBeenCalledExactlyOnceWith("https://coupon.netmarble.com/api/coupon", {
    method: "POST",
    body: { gameCode: "sololv", couponCode: "CODE", langCd: "EN_US", pid: "PID" },
    retry: 0,
  });
});

it.each([
  null,
  undefined,
  { errorCode: 200 },
  { errorCode: 200, resultData: null },
  { errorCode: 400 },
  { errorCode: 200, resultData: [] },
  { errorCode: 200, resultData: [{ quantity: 1 }] },
])("allows missing coupon metadata: %j", async (response) => {
  vi.mocked(ofetch).mockResolvedValue(response);
  await expect(getCouponProduct("CODE", "PID")).resolves.toBeUndefined();
});
