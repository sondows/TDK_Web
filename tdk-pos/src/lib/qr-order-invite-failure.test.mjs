import assert from "node:assert/strict";
import test from "node:test";
import { getQrOrderInviteFailure } from "./qr-order-invite-failure.ts";

test("maps each invite conflict to a distinct safe code and customer message", () => {
  assert.deepEqual(getQrOrderInviteFailure("CLOSED"), {
    code: "SESSION_CLOSED",
    message: "테이블 이용이 종료되어 초대할 수 없습니다.",
  });
  assert.deepEqual(getQrOrderInviteFailure("EXPIRED"), {
    code: "SESSION_EXPIRED",
    message: "테이블 이용 시간이 만료되었습니다.",
  });
  assert.deepEqual(getQrOrderInviteFailure("FULL"), {
    code: "INVITE_FULL",
    message: "함께 주문할 수 있는 인원을 초과했습니다.",
  });
});
