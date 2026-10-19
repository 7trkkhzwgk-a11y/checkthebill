import { describe, expect, it } from "vitest";
import { isAuthLink, isRecoveryLink, resetRedirectTo } from "@/lib/password-reset";

describe("password reset link rules", () => {
  it("sends the reset email back to the reset-password page on the same origin", () => {
    expect(resetRedirectTo("http://localhost:8080")).toBe("http://localhost:8080/reset-password");
    expect(resetRedirectTo("https://billshield.example/")).toBe(
      "https://billshield.example/reset-password",
    );
  });

  it("only treats a fragment marked type=recovery as a recovery link", () => {
    expect(isRecoveryLink("#access_token=abc&token_type=bearer&type=recovery")).toBe(true);
    expect(isRecoveryLink("#type=recovery")).toBe(true);
    expect(isRecoveryLink("#access_token=abc&type=magiclink")).toBe(false);
    expect(isRecoveryLink("")).toBe(false);
  });

  it("recognises an arriving auth link but not a bare visit to the page", () => {
    expect(isAuthLink("", "")).toBe(false);
    expect(isAuthLink("#type=recovery", "")).toBe(true);
    expect(isAuthLink("#access_token=abc&token_type=bearer", "")).toBe(true);
    expect(isAuthLink("", "?code=xyz")).toBe(true);
  });
});
