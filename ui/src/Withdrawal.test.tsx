import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Withdrawal, { consumeWithdrawalLink, withdrawalLink } from "./Withdrawal";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });
it("uses a fragment and removes the capability from active history", () => {
  const link = new URL(withdrawalLink("private/token", location.origin));
  expect(link.pathname).toBe("/"); expect(link.search).toBe("");
  history.replaceState(null, "", link.href);
  expect(consumeWithdrawalLink()).toBe("private/token");
  expect(location.hash).toBe("#/withdraw");
  expect(consumeWithdrawalLink()).toBe("");
});
it("requires confirmation and sends no credentials or referrer", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetcher);
  render(<Withdrawal token="synthetic-private-token" />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Both marketing permissions withdrawn"));
  expect(fetcher).toHaveBeenCalledWith("/api/demo/unsubscribe", expect.objectContaining({
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer", body: JSON.stringify({ token: "synthetic-private-token" }),
  }));
  expect(screen.getByRole("button")).toBeDisabled();
});
it("permits retry after failure and refuses incomplete links", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const view = render(<Withdrawal token="synthetic" />);
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not be confirmed"));
  expect(screen.getByRole("button")).toBeEnabled();
  view.unmount(); render(<Withdrawal token="" />);
  expect(screen.getByRole("button")).toBeDisabled();
});
