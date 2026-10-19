import { describe, expect, it } from "vitest";
import { parseDandyPriceList, priceListSectionCounts, priceListItemName } from "@/lib/dandy";
import { closestPriceListNames, compareConfirmed, matchInvoiceItems, isComparablePromise, type ReviewedPromise } from "@/lib/comparison";

const text = `Dandy Lab — Master Pricing List
1. Crown & Bridge
Materials
Material Price
Zirconia Monolithic $75
3. Removables
Full Dentures — Signature dentures
Type Requirements Price
New Dentures & Overdentures Using the reference denture workflow with existing
appliance
$149
New Dentures & Overdentures Using the wax bite rim workflow (includes wax bite rim and
monolithic try-in)
$199*
Extra set of Signature Dentures N/A $159
Immediate Dentures N/A $129
Full Dentures — Aesthetic dentures
Type Requirements Price
New Dentures & Overdentures Using the wax bite rim workflow
$299*
Full Dentures — Additional options
Option Price
Monolithic Try-in (per arch) $79
Sleep Apnea Appliances
Type Price
Preferred Nylon MAD $599`;
const parsed = parseDandyPriceList(text);
const promises: ReviewedPromise[] = parsed.agreed_items.map((p, i) => ({ ...p, id: `synthetic-${i}`, source: parsed.source, promise_kind: "price_list" }));
const line = (description: string, amount: number) => ({ id: description, description, amount, type: "charge" as const, date: null, reference_no: "SYN-ORDER", order_no: "SYN-ORDER", bank_ref: null });

describe("section-aware Dandy price lists", () => {
  it("prefixes rows and retains all four Signature entries including standalone starred prices", () => {
    expect(parsed.agreed_items.filter(p => p.item?.startsWith("Full Dentures — Signature dentures – ")).map(p => [priceListItemName(p), p.promised_amount])).toEqual([
      ["New Dentures & Overdentures – reference workflow", 149], ["New Dentures & Overdentures – wax bite rim workflow", 199], ["Extra set of Signature Dentures", 159], ["Immediate Dentures", 129],
    ]);
  });
  it("treats the asterisk and Requirements N/A as notes, not missing fixed prices", () => {
    for (const p of parsed.agreed_items) expect(isComparablePromise(p)).toBe(true);
  });
  it("counts every saved section, including sections after the denture page", () => {
    expect(priceListSectionCounts(parsed.agreed_items)).toEqual([
      { section: "Crown & Bridge – Materials", count: 1 }, { section: "Full Dentures — Signature dentures", count: 4 },
      { section: "Full Dentures — Aesthetic dentures", count: 1 }, { section: "Full Dentures — Additional options", count: 1 }, { section: "Sleep Apnea Appliances", count: 1 },
    ]);
  });
  it.each(["Signature Denture Bundle - Wax Rim Workflow", "Signature Denture - New Denture, Wax Rim Workflow"])("matches %s to Signature rather than Aesthetic at exactly $398 for x2", (name) => {
    const finding = compareConfirmed([line(`${name} (x2)`, 398)], promises, "2026-10-19").findings[0];
    expect(finding).toMatchObject({ promised: "398.00", flagged: false, overcharge: "0.00", disposition: "matched" });
    expect(finding?.item).toBe("Full Dentures — Signature dentures – New Dentures & Overdentures – wax bite rim workflow");
  });
  it("matches reference workflow at $149", () => {
    expect(compareConfirmed([line("Signature Denture - New Denture, Reference Workflow", 149)], promises, "2026-10-19").findings[0]).toMatchObject({ promised: "149.00", flagged: false });
  });
  it("matches section-prefixed monolithic try-in and crowns", () => {
    expect(matchInvoiceItems([line("Monolithic Try-in", 79), line("Crown N - Zirconia Monolithic", 75)], promises).map(m => m.disposition)).toEqual(["matched", "matched"]);
  });
  it("shows three distinct closest names without matching Additional Wax Rim automatically", () => {
    const names = closestPriceListNames("Additional Wax Rim", promises);
    expect(names).toHaveLength(3);
    expect(names[0]).toContain("wax bite rim workflow");
    expect(new Set(names).size).toBe(3);
    expect(matchInvoiceItems([line("Additional Wax Rim", 40)], promises)[0]?.disposition).toBe("no_contract");
  });
  it("retains the final aligner section as plan rows rather than orphan prices", () => {
    const list = parseDandyPriceList(`4. Clear Aligners
Plans
Dandy On-Demand Dandy 20 Dandy Max
Price $100 base price +
$35 / aligner
Dual arch: $1,099
Single arch: $824
Dual arch: $1,599
Single arch: $1,199
Plan expiration 1 year 2 years 3 years
Extra Retainers Single: $50
Dual (1 set): $85
Multiple (4 sets): $240
Single: $50
Dual (1 set): $85
Multiple (3 sets): $180
Single: $50
Dual (1 set): $85
Multiple (2 sets): $120
Turnaround time`);
    expect(priceListSectionCounts(list.agreed_items)).toEqual([{ section: "Clear Aligners", count: 6 }]);
    expect(list.agreed_items.map(priceListItemName)).toEqual(["Dandy On-Demand", "Dandy 20", "Dandy Max", "Dandy On-Demand – Extra Retainers", "Dandy 20 – Extra Retainers", "Dandy Max – Extra Retainers"]);
    expect(list.agreed_items.every(p => p.promised_amount === null)).toBe(true);
  });
});