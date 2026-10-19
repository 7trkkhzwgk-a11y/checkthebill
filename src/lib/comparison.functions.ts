import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { compareConfirmed, countWordsChanged, reviewedLineSchema, reviewedPromiseSchema, type Comparison } from "@/lib/comparison";
import { maskSensitive, maskWithIdentifiers } from "@/lib/mask";
import { toDate } from "@/lib/extraction";
import type { Json } from "@/integrations/supabase/types";
import { currencyCode, DRAFT_VERSION, presentFinding } from "@/lib/message-format";
import { invoiceReviewDraft, REVIEW_DRAFT_VERSION } from "@/lib/invoice-results";

const billInput = z.object({ billId: z.string().uuid() });
const confirmationInput = billInput.extend({
  issuer: z.string().max(2000).nullable(), billTotal: z.number().finite().nonnegative().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  lines: z.array(reviewedLineSchema).max(1000), promises: z.array(reviewedPromiseSchema).max(1000),
  confirmedMatches: z.record(z.string().uuid(), z.string().uuid()).optional(),
});

export const confirmCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => confirmationInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [b, l, p] = await Promise.all([
      supabase.from("bills").select("id,confirmed_at,comparison_result,orders_subtotal,sales_tax").eq("id", data.billId).eq("user_id", userId).single(),
      supabase.from("line_items").select("id").eq("bill_id", data.billId).eq("user_id", userId),
      supabase.from("promises").select("id,promise_kind").eq("bill_id", data.billId).eq("user_id", userId),
    ]);
    if (b.error || !b.data || l.error || p.error) throw new Error("Couldn't load this check.");
    if (b.data.comparison_result) return { billId: data.billId };
    const sameIds = (saved: { id: string }[], edited: { id: string }[]) => saved.length === edited.length && new Set(edited.map((r) => r.id)).size === edited.length && saved.every((r) => edited.some((e) => e.id === r.id));
    if (!sameIds(l.data ?? [], data.lines) || !sameIds(p.data ?? [], data.promises)) throw new Error("The saved lines changed. Reload this check before confirming.");
    for (const date of [...data.lines.map((r) => r.date), ...data.promises.map((r) => r.promised_on)]) {
      if (date && !toDate(date)) throw new Error("Enter dates as YYYY-MM-DD or leave them empty.");
    }
    const lines = data.lines.map((r) => ({ ...r, date: toDate(r.date), description: maskSensitive(r.description), reference_no: maskSensitive(r.reference_no, "identifier"), bank_ref: maskSensitive(r.bank_ref, "identifier"), order_no: maskSensitive(r.order_no ?? null, "identifier"), tax_amount: r.tax_amount ?? null, total_amount: r.total_amount ?? null }));
    const promises = data.promises.map((r) => ({ ...r, pnr: maskSensitive(r.pnr ?? null, "identifier"), promised_on: toDate(r.promised_on), item: maskSensitive(r.item), source: maskSensitive(r.source), status_text: maskSensitive(r.status_text), notes: maskSensitive(r.notes ?? null), bank_ref: r.bank_ref ?? "", promise_kind: p.data?.find((saved) => saved.id === r.id)?.promise_kind ?? null }));
    for (const { id, ...row } of lines) {
      const { error } = await supabase.from("line_items").update({ ...row, flagged: false, flag_reason: null }).eq("id", id).eq("bill_id", data.billId).eq("user_id", userId);
      if (error) throw new Error("Couldn't save the confirmed transactions.");
    }
    for (const { id, ...row } of promises) {
      const { error } = await supabase.from("promises").update(row).eq("id", id).eq("bill_id", data.billId).eq("user_id", userId);
      if (error) throw new Error("Couldn't save the confirmed promise.");
    }
    const today = new Date().toISOString().slice(0, 10);
    const comparison = compareConfirmed(lines, promises, today, { orders_subtotal: b.data.orders_subtotal ?? null, sales_tax: b.data.sales_tax ?? null, bill_total: data.billTotal, confirmed_matches: data.confirmedMatches ?? {} });
    comparison.findings = comparison.findings.map((f) => presentFinding(f, promises.find((p) => p.id === f.promise_id), maskSensitive(data.issuer), currencyCode(data.currency)));
    const flaggedIds = [...new Set(comparison.findings.filter((f) => f.flagged && f.line_id).map((f) => f.line_id))];
    for (const id of flaggedIds) {
      if (!id) continue;
      const reason = comparison.findings.filter((f) => f.flagged && f.line_id === id).map((f) => f.flag_reason).join(" ");
      const { error } = await supabase.from("line_items").update({ flagged: true, flag_reason: reason }).eq("id", id).eq("user_id", userId);
      if (error) throw new Error("Couldn't save the flagged transaction.");
    }
    const { error } = await supabase.from("bills").update({ issuer: maskSensitive(data.issuer), currency: currencyCode(data.currency), bill_total: data.billTotal, confirmed_at: new Date().toISOString(), comparison_result: comparison as unknown as Json }).eq("id", data.billId).eq("user_id", userId);
    if (error) throw new Error("Couldn't save this comparison.");
    return { billId: data.billId };
  });

export const getCheckResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => billInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [b, l, p] = await Promise.all([
      supabase.from("bills").select("id,issuer,currency,confirmed_at,comparison_result,bill_type,orders_subtotal,sales_tax,bill_total").eq("id", data.billId).eq("user_id", userId).single(),
      supabase.from("line_items").select("*").eq("bill_id", data.billId).eq("user_id", userId).order("date"),
      supabase.from("promises").select("*").eq("bill_id", data.billId).eq("user_id", userId),
    ]);
    if (b.error || !b.data || l.error || p.error) throw new Error("Couldn't load this check.");
    const ids = (l.data ?? []).map((r) => r.id);
    const messages = ids.length ? await supabase.from("messages").select("*").in("line_id", ids).eq("user_id", userId).order("id") : { data: [], error: null };
    if (messages.error) throw new Error("Couldn't load saved messages.");
    let comparison = b.data.comparison_result as unknown as Comparison | null;
    if (comparison && b.data.confirmed_at && b.data.bill_type === "lab_invoice") {
      const confirmed_matches = Object.fromEntries(comparison.findings.filter((f) => f.line_id && f.promise_id).map((f) => [f.line_id, f.promise_id]));
      comparison = compareConfirmed((l.data ?? []).map((row) => reviewedLineSchema.parse(row)), (p.data ?? []).map((row) => ({ ...reviewedPromiseSchema.parse(row), promise_kind: row.promise_kind })), comparison.checked_on,
        { orders_subtotal: b.data.orders_subtotal, sales_tax: b.data.sales_tax, bill_total: b.data.bill_total, confirmed_matches });
      const { error: saveError } = await supabase.from("bills").update({ comparison_result: comparison as unknown as Json }).eq("id", data.billId).eq("user_id", userId);
      if (saveError) throw new Error("Couldn't save the updated lab summary.");
    }
    if (comparison) comparison.findings = comparison.findings.map((f) => presentFinding(f, p.data?.find((r) => r.id === f.promise_id), b.data.issuer, b.data.currency));
    return { bill: { ...b.data, comparison_result: comparison }, lines: l.data ?? [], messages: messages.data ?? [] };
  });

export const generateCheckDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => billInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: bill, error } = await supabase.from("bills").select("issuer,currency,confirmed_at,comparison_result").eq("id", data.billId).eq("user_id", userId).single();
    if (error || !bill?.confirmed_at || !bill.comparison_result) throw new Error("Confirm the lines before drafting a message.");
    const comparison = bill.comparison_result as unknown as Comparison;
    const promises = await supabase.from("promises").select("id,source,item,pnr").eq("bill_id", data.billId).eq("user_id", userId);
    if (promises.error) throw new Error("Couldn't load the message recipient.");
    comparison.findings = comparison.findings.map((f) => presentFinding(f, promises.data?.find((p) => p.id === f.promise_id), bill.issuer, bill.currency));
    const { writeDraft } = await import("@/lib/draft.server");
    const review = comparison.findings.filter((f) => f.kind === "invoice" && f.disposition === "no_contract");
    const firstReview = review[0];
    if (firstReview?.line_id) {
      const existing = await supabase.from("messages").select("id,sent,declined_at,final_text,draft_version").eq("line_id", firstReview.line_id).eq("user_id", userId).limit(1);
      if (existing.error) throw new Error("Couldn't read the saved review message.");
      const saved = existing.data?.[0];
      if (!saved || (!saved.sent && !saved.declined_at && saved.final_text === null && saved.draft_version !== REVIEW_DRAFT_VERSION)) {
        const recipient = firstReview.contact_name ?? bill.issuer ?? "the vendor";
        const identifiers = review.flatMap((f) => [f.order_no ?? null]);
        const row = { sent_to: recipient, draft_text: maskWithIdentifiers(invoiceReviewDraft(review, recipient, bill.currency), identifiers), draft_version: REVIEW_DRAFT_VERSION };
        const result = saved ? await supabase.from("messages").update(row).eq("id", saved.id).eq("user_id", userId).eq("sent", false).is("final_text", null).is("declined_at", null)
          : await supabase.from("messages").insert({ user_id: userId, line_id: firstReview.line_id, ...row });
        if (result.error) throw new Error("Couldn't save the review message.");
      }
    }
    for (const f of comparison.findings.filter((r) => r.flagged)) {
      if (!f.line_id || !f.recipient) continue;
      const existing = await supabase.from("messages").select("id,sent,declined_at,final_text,draft_version").eq("line_id", f.line_id).eq("user_id", userId).limit(1);
      if (existing.error) throw new Error("Couldn't read the saved message.");
      const saved = existing.data?.[0];
      if (saved && (saved.sent || saved.declined_at || saved.final_text !== null || saved.draft_version === DRAFT_VERSION)) continue;
      const draft_text = await writeDraft(f);
      const row = { sent_to: f.contact_name ?? (f.recipient === "BANK" ? "your bank" : "the billing company"), draft_text, draft_version: DRAFT_VERSION };
      const { error: saveError } = saved
        ? await supabase.from("messages").update(row).eq("id", saved.id).eq("user_id", userId).eq("sent", false).is("final_text", null).is("declined_at", null)
        : await supabase.from("messages").insert({ user_id: userId, line_id: f.line_id, ...row });
      if (saveError) throw new Error("Couldn't save the draft message.");
    }
    return { ok: true };
  });

export const askCheckQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ billId: z.string().uuid(), question: z.string().min(1).max(2000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: bill, error } = await supabase.from("bills").select("issuer,currency,comparison_result").eq("id", data.billId).eq("user_id", userId).single();
    const comparison = bill?.comparison_result as unknown as Comparison | null;
    if (error || !comparison) throw new Error("Confirm the lines before asking questions.");
    const promises = await supabase.from("promises").select("id,source,item,pnr").eq("bill_id", data.billId).eq("user_id", userId);
    if (promises.error) throw new Error("Couldn't load the check details.");
    comparison.findings = comparison.findings.map((f) => presentFinding(f, promises.data?.find((p) => p.id === f.promise_id), bill.issuer, bill.currency));
    const { answerQuestion } = await import("@/lib/ask.server");
    const answer = await answerQuestion(comparison, bill.currency, data.question);
    return { answer };
  });

export const listChecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const bills = await supabase.from("bills").select("id,issuer,currency,confirmed_at,uploaded_at,comparison_result").eq("user_id", userId).order("uploaded_at", { ascending: false });
    if (bills.error) throw new Error("Couldn't load your checks.");
    const ids = (bills.data ?? []).map((b) => b.id);
    const lines = ids.length ? await supabase.from("line_items").select("id,bill_id").eq("user_id", userId).in("bill_id", ids) : { data: [], error: null };
    if (lines.error) throw new Error("Couldn't load your checks.");
    const lineIds = (lines.data ?? []).map((l) => l.id);
    const messages = lineIds.length ? await supabase.from("messages").select("line_id,sent,declined_at,words_changed").eq("user_id", userId).in("line_id", lineIds) : { data: [], error: null };
    if (messages.error) throw new Error("Couldn't load your checks.");
    const lineBill = new Map((lines.data ?? []).map((l) => [l.id, l.bill_id]));
    return (bills.data ?? []).map((b) => {
      const comparison = b.comparison_result as unknown as Comparison | null;
      const flagged = comparison?.findings.find((f) => f.flagged) ?? null;
      const billLineIds = new Set((lines.data ?? []).filter((l) => l.bill_id === b.id).map((l) => l.id));
      const billMessages = (messages.data ?? []).filter((m) => lineBill.get(m.line_id) === b.id || billLineIds.has(m.line_id));
      const message = billMessages.find((m) => m.sent) ?? billMessages[0] ?? null;
      return {
        id: b.id, issuer: b.issuer, currency: b.currency,
        date: b.confirmed_at ?? b.uploaded_at,
        status: comparison?.status ?? null,
        flagged: flagged ? { flag_reason: flagged.flag_reason, missing_amount: flagged.missing_amount, overcharge: flagged.overcharge } : null,
        sent: message?.sent ?? false, declined: !!message && !message.sent && !!message.declined_at,
        words_changed: message?.words_changed ?? null,
      };
    });
  });

export const saveMessageDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ messageId: z.string().uuid(), finalText: z.string().max(20000), decision: z.enum(["sent", "not_sending"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: message, error } = await supabase.from("messages").select("id,line_id,draft_text,sent,words_changed").eq("id", data.messageId).eq("user_id", userId).single();
    if (error || !message) throw new Error("Couldn't find this message.");
    if (message.sent) return { wordsChanged: message.words_changed ?? 0 };
    if (data.decision === "sent" && !data.finalText.trim()) throw new Error("The message is empty.");
    // Identifiers in the draft remain available for the dispute; other edited text is masked.
    const line = await supabase.from("line_items").select("bill_id").eq("id", message.line_id).eq("user_id", userId).single();
    if (line.error || !line.data) throw new Error("Couldn't find the message transaction.");
    const bill = await supabase.from("bills").select("comparison_result").eq("id", line.data.bill_id).eq("user_id", userId).single();
    if (bill.error || !bill.data) throw new Error("Couldn't find the message check.");
    const comparison = bill.data.comparison_result as unknown as Comparison | null;
    const identifiers = comparison?.findings.flatMap((f) => [f.refund_id, f.transaction_id, f.bank_ref, f.pnr ?? null, f.order_no ?? null]) ?? [];
    const final_text = maskWithIdentifiers(data.finalText, identifiers);
    const words_changed = countWordsChanged(message.draft_text ?? "", final_text);
    const { error: saveError } = await supabase.from("messages").update({ final_text, words_changed, sent: data.decision === "sent", sent_at: data.decision === "sent" ? new Date().toISOString() : null, declined_at: data.decision === "not_sending" ? new Date().toISOString() : null }).eq("id", data.messageId).eq("user_id", userId);
    if (saveError) throw new Error("Couldn't save the message decision.");
    return { wordsChanged: words_changed };
  });