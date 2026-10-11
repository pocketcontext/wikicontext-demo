import { useEffect } from "react";
import "./oauth-completion.css";

export function oauthCompletionOutcome(hash: string): "success" | "failure" | null {
  if (hash === "#/auth/oauth2-redirect-success") return "success";
  if (hash === "#/auth/oauth2-redirect-failure") return "failure";
  return null;
}

/** The original tab completes authentication over the SDK's existing connection. */
export default function OAuthCompletion({ outcome }: { outcome: "success" | "failure" }) {
  useEffect(() => { window.close(); }, []);
  return <main className="oauth-completion">
    <h1>{outcome === "success" ? "Return to WikiContext" : "Sign-in could not complete"}</h1>
    <p>{outcome === "success"
      ? "Return to the tab where you started sign-in to continue. You can close this window."
      : "Return to the tab where you started sign-in and try again. You can close this window."}</p>
    <button type="button" onClick={() => window.close()}>Close this window</button>
    <p><a href="/">Open WikiContext</a></p>
  </main>;
}
