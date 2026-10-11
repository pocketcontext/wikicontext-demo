import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import OAuthCompletion, { oauthCompletionOutcome } from "./OAuthCompletion";
const oauthOutcome = oauthCompletionOutcome(location.hash);
// Completion popups must not initialize auth storage or cancel the original tab's
// pending login. Load the ordinary application only for non-completion routes.
const ApplicationRoot = React.lazy(() => import("./ApplicationRoot"));
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {oauthOutcome ? <OAuthCompletion outcome={oauthOutcome} /> :
      <React.Suspense fallback={<p role="status">Loading WikiContext…</p>}><ApplicationRoot /></React.Suspense>}
  </React.StrictMode>,
);
