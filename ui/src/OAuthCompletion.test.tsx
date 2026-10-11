import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import OAuthCompletion, { oauthCompletionOutcome } from "./OAuthCompletion";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("recognizes only the two exact callback outcomes", () => {
  expect(oauthCompletionOutcome("#/auth/oauth2-redirect-success")).toBe("success");
  expect(oauthCompletionOutcome("#/auth/oauth2-redirect-failure")).toBe("failure");
  for (const hash of ["#/collections", "#/auth/oauth2-redirect-success/extra", "#/auth/oauth2-redirect-success?token=fake"])
    expect(oauthCompletionOutcome(hash)).toBeNull();
});

it.each(["success", "failure"] as const)("shows a safe %s fallback without authenticating", outcome => {
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  const fetcher = vi.spyOn(window, "fetch");
  const save = vi.spyOn(Storage.prototype, "setItem");
  render(<OAuthCompletion outcome={outcome} />);
  expect(screen.getByRole("heading")).toHaveTextContent(outcome === "success" ? "Return to WikiContext" : "Sign-in could not complete");
  expect(screen.getByText(/Return to the tab where you started sign-in/)).toBeVisible();
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close this window" }));
  expect(close).toHaveBeenCalledTimes(2);
  expect(fetcher).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
