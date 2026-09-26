import { ofetch } from "ofetch";

const COUPON_API_URL = "https://coupon.netmarble.com/api/coupon/reward";

type CouponError = {
  errorCode: number;
  errorMessage?: string;
  httpStatus?: number;
};

export type CouponSuccess = {
  errorCode: 200;
  errorMessage: "SUCCESS";
  rewardType: string;
  resultData: {
    productName: string;
    productImageUrl: string;
    userSelectionRate: number;
  }[];
  success: boolean;
};

export type CouponResponse = CouponError | CouponSuccess;

export const redeemCoupon = (couponCode: string, pid: string) =>
  ofetch<CouponResponse>(COUPON_API_URL, {
    query: {
      gameCode: "sololv",
      couponCode,
      langCd: "EN_US",
      pid,
    },
    retry: 0,
  });
