import { useState } from "react";
import { withdraw } from "./demo";

/** Fragments are never sent in HTTP requests or Referer headers. */
export function withdrawalLink(token: string, origin = location.origin): string {
  return `${origin}/#/withdraw/${encodeURIComponent(token)}`;
}

/** Consume before mounting the application; don't retain the capability in history. */
export function consumeWithdrawalLink(): string | null {
  if (location.hash === "#/withdraw") return "";
  const prefix = "#/withdraw/";
  if (!location.hash.startsWith(prefix)) return null;
  const encoded = location.hash.slice(prefix.length);
  history.replaceState(null, "", location.pathname + "#/withdraw");
  try { return decodeURIComponent(encoded); } catch { return ""; }
}

export default function Withdrawal({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState(token ? "" : "This withdrawal link is incomplete. Open your saved private link again, or contact info@pocketcontext.com.");
  const submit = async () => {
    if (busy || done || !token) return;
    setBusy(true);
    try {
      await withdraw(token);
      setDone(true);
      setMessage("Both marketing permissions withdrawn. Signing in again or the daily demo reset does not reverse your withdrawal.");
    } catch {
      setMessage("Withdrawal could not be confirmed. Try again, or contact info@pocketcontext.com.");
    } finally { setBusy(false); }
  };
  return <main className="landing">
    <h1>Withdraw marketing permissions</h1>
    <p>This withdraws commercial contact and newsletter permission. No sign-in is needed.</p>
    <p>Opening this page does not change your choices. Confirm below to withdraw both permissions.</p>
    <button type="button" disabled={busy || done || !token} onClick={() => void submit()}>
      {busy ? "Withdrawing…" : "Withdraw both marketing permissions"}
    </button>
    <p role="status">{message}</p>
    <a href="/">Back to the demo</a>
  </main>;
}
