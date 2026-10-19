import { describe, expect, it } from "vitest";
import { assertExactNumbers, assertMessageRouting, formatCurrency, presentFinding } from "@/lib/message-format";
import { compareConfirmed, draftFacts } from "@/lib/comparison";

const promise = { id: "p", item: "Train ticket refund", pnr: "1234567890", original_charge: 7475.40, promised_amount: 7180, promised_on: "2026-09-24", reference_no: "100006792070399", transaction_id: "100001447873288", bank_ref: "", source: "IRCTC", status_text: null, promise_kind: "refund" };
const line = { id: "l", date: null, description: "Train ticket", amount: 7475.40, type: "charge" as const, reference_no: promise.transaction_id, bank_ref: null };
function finding(bankRef = "") {
  const f = compareConfirmed([line], [{ ...promise, bank_ref: bankRef }], "2026-10-18").findings[0];
  if (!f) throw new Error("No finding");
  return presentFinding(f, promise, "Example Bank", "INR");
}
describe("result and message facts", () => {
  it("routes blank-reference refunds to IRCTC, never DEMO BANK, even with stale routing", () => {
    const f = presentFinding({ ...finding(), recipient: "BANK", contact_name: "DEMO BANK", bank_ref: "OLD" }, { ...promise, bank_ref: " " }, "DEMO BANK", "INR");
    expect(f.recipient).toBe("MERCHANT");
    expect(draftFacts(f)).toMatchObject({ recipient: "IRCTC", request: "Please provide the bank reference number for refund ID 100006792070399." });
  });
  it("routes reference-present refunds to the bank with the exact missing amount and reference", () => {
    const f = presentFinding(finding(), { ...promise, bank_ref: "BANK-123" }, "DEMO BANK", "INR");
    expect(f.recipient).toBe("BANK");
    expect(draftFacts(f)).toMatchObject({ recipient: "DEMO BANK", request: "Please trace and credit ₹7,180.00 using bank reference BANK-123." });
  });
  it("uses the invoice issuer, not the price-list source, for vendor messages", () => {
    const raw = compareConfirmed([line], [{ ...promise, item: "Train ticket", source: "Contract publisher", promise_kind: "price_list", original_charge: null, transaction_id: null }], "2026-10-18").findings[0];
    if (!raw) throw new Error("No invoice finding");
    const f = presentFinding(raw, { source: "Contract publisher" }, "Vendor Lab", "USD");
    expect(draftFacts(f)).toMatchObject({ recipient: "Vendor Lab", request: "Please correct this invoice overcharge." });
  });
  it("rejects mixed or repeated refund requests while accepting the single routed ask", () => {
    const f = finding();
    const message = `Dear IRCTC Customer Care,\n${draftFacts(f).request}`;
    expect(() => assertMessageRouting(message, f)).not.toThrow();
    expect(() => assertMessageRouting(`${message}\nPlease trace the refund.`, f)).toThrow();
    expect(() => assertMessageRouting(`${message}\n${draftFacts(f).request}`, f)).toThrow();
    const bank = finding("BANK-123");
    expect(() => assertMessageRouting(`Dear Example Bank Customer Care,\n${draftFacts(bank).request}\nPlease provide the bank reference.`, bank)).toThrow();
  });
  it("formats INR with rupee symbol, commas and exact two decimals", () => {
    expect(formatCurrency("7475.40", "INR")).toBe("₹7,475.40");
    expect(formatCurrency("7180.00", "INR")).toBe("₹7,180.00");
  });
  it("formats USD with dollar symbol without converting amounts", () => {
    expect(formatCurrency("7475.40", "USD")).toBe("$7,475.40");
  });
  it("does not invent a currency when it is absent", () => {
    expect(formatCurrency("7475.40", null)).toBe("7,475.40");
  });
  it("resolves the merchant from the promise and bank from the issuer", () => {
    expect(finding().contact_name).toBe("IRCTC");
    expect(finding("BANK-123").contact_name).toBe("Example Bank");
  });
  it("removes document labels from legacy promise sources", () => {
    expect(presentFinding(finding(), { ...promise, source: "IRCTC cancellation/refund confirmation" }, "Example Bank", "INR").contact_name).toBe("IRCTC");
  });
  it("passes exact PNR, refund and transaction identifiers and computed days", () => {
    expect(draftFacts(finding())).toMatchObject({ recipient: "IRCTC", pnr: "1234567890", refund_id: "100006792070399", transaction_id: "100001447873288", days_waiting: 24, refund_promised: "7180.00" });
  });
  it("excludes merchant-kept amounts from AI facts", () => {
    expect(draftFacts(finding())).not.toHaveProperty("kept_by_merchant");
    expect(draftFacts(finding())).not.toHaveProperty("charged");
  });
  it("accepts exact formatted amounts, dates, days and whole IDs", () => {
    expect(() => assertExactNumbers("₹7,180.00 on 2026-09-24, after 24 days. Refund ID 100006792070399.", ["₹7,180.00", "2026-09-24", 24, "100006792070399"])).not.toThrow();
  });
  it("preserves a supplied train number without allowing a changed one", () => {
    expect(() => assertExactNumbers("SANGHAMITRA EXP (12295)", ["12295"])).not.toThrow();
    expect(() => assertExactNumbers("SANGHAMITRA EXP (12296)", ["12295"])).toThrow();
  });
  it("rejects changed currency amounts even if their numeric chunks are allowed", () => {
    expect(() => assertExactNumbers("₹7,180.24", ["₹7,180.00", 24])).toThrow();
    expect(() => assertExactNumbers("7180.00", ["₹7,180.00"])).toThrow();
  });
  it("rejects altered identifiers and invented elapsed days", () => {
    expect(() => assertExactNumbers("100006792070398", ["100006792070399"])).toThrow();
    expect(() => assertExactNumbers("25 days", [24])).toThrow();
  });
});
import { assertChatMoney } from "@/lib/message-format";
describe("chat money guard", () => {
  const allowed = ["₹7,180.00", "₹295.40", 7475.4];
  it("allows answers using only code-calculated money", () => {
    expect(() => assertChatMoney("₹7,180.00 was promised on 24 Sep; after 31 days total, ₹295.40 is missing. Ref ID 100006792070399.", allowed, "what if they don't reply in 7 days?")).not.toThrow();
  });
  it("allows day counts, dates, IDs and plain integers freely", () => {
    expect(() => assertChatMoney("Follow up after 7 days; it has been 24 days since 2026-09-24. PNR 1234567890.", allowed, "who do I contact?")).not.toThrow();
  });
  it("allows money stated in the user's own question", () => {
    expect(() => assertChatMoney("You mentioned ₹500.00; that does not match any figure in this check.", allowed, "what about the ₹500 fee?")).not.toThrow();
  });
  it("blocks money that is not a code-calculated value", () => {
    expect(() => assertChatMoney("You could claim ₹9,999.99 in compensation.", allowed, "what can I claim?")).toThrow("I couldn't answer that safely — please rephrase.");
  });
});
