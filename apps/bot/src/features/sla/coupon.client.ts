import { ofetch } from "ofetch";

const COUPON_API_URL = "https://coupon.netmarble.com/api/coupon";

type CouponError = {
  errorCode: number;
  errorMessage?: string;
  httpStatus?: number;
};

export type CouponProduct = {
  productName: string;
  productImageUrl: string;
};

export type CouponSuccess = {
  errorCode: 200;
  errorMessage: string;
  rewardType: string;
  resultData: {
    productName: string;
    productImageUrl: string;
    userSelectionRate: number;
  }[];
  success: boolean;
};

export type CouponResponse = CouponError | CouponSuccess;

export async function getCouponProduct(
  couponCode: string,
  pid: string,
): Promise<CouponProduct | undefined> {
  const data = await ofetch<CouponResponse | null | undefined>(`${COUPON_API_URL}/reward`, {
    query: { gameCode: "sololv", couponCode, langCd: "EN_US", pid },
    retry: 0,
  });
  const product = data && "resultData" in data ? data.resultData?.[0] : undefined;
  if (data?.errorCode !== 200 || !product?.productName || !product.productImageUrl)
    return undefined;
  return { productName: product.productName, productImageUrl: product.productImageUrl };
}

export type CouponRedemptionResponse =
  | CouponError
  | {
      errorCode: 200;
      errorMessage: string;
      resultData: { quantity: number }[];
      success: boolean;
    };

export const redeemCoupon = (couponCode: string, pid: string) =>
  ofetch<CouponRedemptionResponse>(COUPON_API_URL, {
    method: "POST",
    body: {
      gameCode: "sololv",
      couponCode,
      langCd: "EN_US",
      pid,
    },
    retry: 0,
  });
