import { describe, it, expect } from "vitest";
import { maskSensitive } from "@/lib/mask";

describe("maskSensitive", () => {
  it("masks a card number keeping last 4", () => {
    expect(maskSensitive("Card 4111 1111 1111 1234 charged")).toBe("Card •••• 1234 charged");
  });
  it("masks phone numbers", () => {
    expect(maskSensitive("Call (555) 123-4567")).toBe("Call [PHONE]");
  });
  it("masks labelled account numbers", () => {
    expect(maskSensitive("Account #: 9876543210")).toBe("Account #: •••• 3210");
  });
  it("leaves amounts and short references alone", () => {
    expect(maskSensitive("Refund REF-4821 $49.99")).toBe("Refund REF-4821 $49.99");
  });
});
