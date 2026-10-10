import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { api, onServiceSignal, pb, sessionGeneration, setDemoMode } from "./api";
import {
  DemoError,
  enroll,
  fetchStatus,
  getEnrollment,
  getPreferences,
  initialOnboarding,
  onboardingReducer,
  secondsUntil,
  statusChange,
  withdraw,
  type StatusResult,
} from "./demo";
import Landing from "./Landing";
import { useTheme } from "./theme";

export interface DemoReaderContext {
  generation: string;
  resetAt: string;
  setupHref: string;
}

function readerRoute(hash: string) {
  return hash.startsWith("#/") && !hash.startsWith("#/setup");
}

/**
 * Public-demo shell: live onboarding only after `/api/demo/status` validates,
 * otherwise a static preview with no authentication. Enrolled visitors see the
 * reader; resets, generation changes and missing enrollment return here.
 */
export default function DemoApp({
  initial,
  renderReader,
}: {
  initial: StatusResult;
  renderReader: (context: DemoReaderContext, key: number) => ReactNode;
}) {
  const [result, setResult] = useState(initial);
  const status = result.kind === "demo" ? result.status : null;
  const statusRef = useRef(status);
  statusRef.current = status;
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const [now, setNow] = useState(() => Date.now());
  const [hash, setHash] = useState(() => location.hash);
  const [session, setSession] = useState(sessionGeneration);
  const [stayOnSetup, setStayOnSetup] = useState(false);
  const [returnHash, setReturnHash] = useState(() => (readerRoute(location.hash) ? location.hash : "#/"));
  const [theme, setTheme] = useTheme();
  const signingIn = useRef(false);
  const epoch = useRef(0);

  useEffect(() => {
    setDemoMode(!!status);
    return () => setDemoMode(false);
  }, [status]);
  useEffect(() => pb.authStore.onChange(() => setSession(sessionGeneration)), []);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadPreferences = useCallback(async (own: number) => {
    const preferences = await getPreferences();
    if (own === epoch.current) dispatch({ type: "preferences", preferences });
  }, []);
  const fail = useCallback((error: unknown, own: number) => {
    if (own !== epoch.current) return;
    const code = error instanceof DemoError ? error.status : (error as { status?: number })?.status;
    if (code === 503) {
      api.logout();
      dispatch({ type: "resetting" });
      return;
    }
    // Never keep a signed-in look without verified preferences or enrollment.
    signingIn.current = false;
    api.logout();
    dispatch({
      type: "signed-out",
      message: code === 401 || code === 403
        ? "Your session expired. Sign in again."
        : error instanceof Error && error.message !== "Session changed" ? error.message : "Your session could not be verified. Sign in again.",
    });
  }, []);
  const check = useCallback(async () => {
    const current = statusRef.current;
    if (!current || !pb.authStore.isValid) return;
    const own = ++epoch.current;
    dispatch({ type: "check" });
    try {
      await api.refreshSession();
      if (own !== epoch.current) return;
      if (secondsUntil(current.resetAt, Date.now()) === 0) {
        api.logout();
        dispatch({ type: "resetting", message: "The daily reset is due. Sign in again after the reset." });
        return;
      }
      const enrollment = await getEnrollment(current);
      if (own !== epoch.current) return;
      dispatch({ type: "enrollment", enrollment });
      if (!enrollment.enrolled) await loadPreferences(own);
    } catch (error) {
      fail(error, own);
    }
  }, [fail, loadPreferences]);

  // Re-evaluate whenever the stored identity changes (sign-in, sign-out, other tabs).
  useEffect(() => {
    if (!status) return; // Preview: stored credentials are never used.
    if (!pb.authStore.isValid) {
      epoch.current++;
      if (!signingIn.current) dispatch({ type: "auth-cleared" });
      return;
    }
    signingIn.current = false;
    void check();
  }, [session, status?.generation, check]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returning to setup refreshes usage after the agent has written new content.
  useEffect(() => {
    if (hash.startsWith("#/setup") && pb.authStore.isValid) void check();
  }, [hash, check]);

  // Server signals from any API call: resets fence the session; 403 rechecks terms.
  useEffect(() => onServiceSignal((signal) => {
    if (signal === "resetting") {
      epoch.current++;
      api.logout();
      dispatch({ type: "resetting" });
      void fetchStatus().then(setResult);
    } else void check();
  }), [check]);

  // Deadline and generation watch: never carry a session across the daily reset.
  const expired = !!status && secondsUntil(status.resetAt, now) === 0;
  useEffect(() => {
    if (!expired) return;
    epoch.current++;
    if (pb.authStore.token) api.logout();
    dispatch({ type: "resetting", message: "The daily reset is due. Sign in again after the reset." });
  }, [expired]);
  useEffect(() => {
    if (!status) return;
    let disposed = false;
    const poll = () => void fetchStatus().then((next) => {
      if (disposed) return;
      const change = statusChange(status, next, Date.now());
      if (change === "same") return;
      epoch.current++;
      if (pb.authStore.token) api.logout();
      setResult(next);
      if (change === "new-day")
        dispatch({ type: "signed-out", message: "A new demo day has started. Sign in again and accept today’s terms." });
      else dispatch({ type: "resetting" });
    });
    const timer = window.setInterval(poll, expired ? 10000 : 60000);
    window.addEventListener("focus", poll);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [status, expired]);
  // A preview or reset page checks again until the service returns.
  useEffect(() => {
    if (status) return;
    const timer = window.setInterval(() => void fetchStatus().then((next) => {
      if (next.kind !== "preview") { setResult(next); dispatch({ type: "signed-out", message: "" }); }
    }), 30000);
    return () => clearInterval(timer);
  }, [status]);

  const signIn = () => {
    if (!status || signingIn.current) return;
    signingIn.current = true;
    epoch.current++;
    dispatch({ type: "signin-start" });
    // Clear stored auth first; the SDK opens its popup synchronously in this click.
    api.logout();
    api.loginGoogle().catch((error: unknown) => {
      if (!signingIn.current) return;
      signingIn.current = false;
      const aborted = (error as { isAbort?: boolean })?.isAbort;
      dispatch({
        type: "signin-failed",
        message: aborted ? "Google sign-in cancelled. You can try again." : "Google sign-in was not completed. Please try again.",
      });
    });
  };
  const submit = async (choices: { salesConsent: boolean; newsletterConsent: boolean }) => {
    if (!status || state.phase !== "consent" || !state.preferences) return;
    const own = epoch.current;
    dispatch({ type: "submit" });
    try {
      const outcome = await enroll(status, { ...choices, expectedRevision: state.preferences.revision });
      if (own !== epoch.current || !pb.authStore.isValid) return;
      setReturnHash(readerRoute(location.hash) ? location.hash : returnHash);
      setStayOnSetup(true);
      // Re-read enrollment so usage and the personal space come from the server.
      dispatch({ type: "enrolled", enrollment: outcome.enrollment, unsubscribeToken: outcome.unsubscribeToken });
      void getEnrollment(status).then((enrollment) => {
        if (own === epoch.current && enrollment.enrolled) dispatch({ type: "refresh-enrollment", enrollment });
      }).catch(() => {});
    } catch (error) {
      if (own !== epoch.current) return;
      if (error instanceof DemoError && error.status === 409) {
        dispatch({ type: "conflict" });
        try { await loadPreferences(own); }
        catch { fail(new DemoError("Could not refresh your preferences. Sign in again.", 0), own); }
        return;
      }
      if (error instanceof DemoError && (error.status === 401 || error.status === 503)) { fail(error, own); return; }
      dispatch({ type: "failed", message: error instanceof Error ? error.message : "Enrollment failed. Please try again." });
    }
  };
  const signOut = () => {
    if (state.phase === "enrolling") return;
    epoch.current++;
    setStayOnSetup(false);
    api.logout();
    dispatch({ type: "signed-out", message: "Signed out of this browser. Existing coding-agent sessions are unchanged." });
  };
  const withdrawConsent = async () => {
    const token = state.unsubscribeToken;
    if (!token) return;
    try {
      await withdraw(token);
      dispatch({ type: "withdrawn", message: "Both marketing permissions withdrawn." });
    } catch (error) {
      dispatch({ type: "withdrawn-failed", message: error instanceof Error ? error.message : "Withdrawal failed." });
    }
  };
  const openWiki = () => {
    setStayOnSetup(false);
    if (location.hash === returnHash) setHash(location.hash);
  };

  const identity = pb.authStore.isValid && pb.authStore.record
    ? { email: String(pb.authStore.record.email || ""), name: String(pb.authStore.record.name || "") }
    : null;
  if (status && state.phase === "enrolled" && identity && !stayOnSetup && !hash.startsWith("#/setup") && !expired)
    return <>{renderReader({ generation: status.generation, resetAt: status.resetAt, setupHref: "#/setup" }, session)}</>;
  return (
    <Landing
      mode={status ? "live" : "preview"}
      previewReason={result.kind === "preview" ? result.reason : undefined}
      status={status}
      state={state}
      identity={identity}
      now={now}
      theme={theme}
      setTheme={setTheme}
      onSignIn={signIn}
      onCancelSignIn={() => { signingIn.current = false; api.cancelGoogleLogin(); dispatch({ type: "signin-failed", message: "Google sign-in cancelled. You can try again." }); }}
      onSignOut={signOut}
      onSubmit={(choices) => void submit(choices)}
      onWithdraw={() => void withdrawConsent()}
      onRetryStatus={() => void fetchStatus().then((next) => { setResult(next); if (next.kind === "demo") dispatch({ type: "signed-out", message: "" }); })}
      wikiHref={returnHash}
      onOpenWiki={openWiki}
    />
  );
}
