import { withdrawalLink } from "./Withdrawal";
import "./landing.css";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  agentPrompt,
  canSubmit,
  checkedInstallation,
  formatAmount,
  formatCountdown,
  nextUtcMidnight,
  QUOTA_LABELS,
  secondsUntil,
  type DemoStatus,
  type OnboardingState,
} from "./demo";
import "./landing.css";

export interface LandingProps {
  mode: "live" | "preview";
  previewReason?: "resetting" | "unavailable";
  status: DemoStatus | null;
  state: OnboardingState;
  identity: { email: string; name: string } | null;
  now: number;
  theme: string;
  setTheme: (value: string) => void;
  onSignIn: () => void;
  onCancelSignIn: () => void;
  onSignOut: () => void;
  onSubmit: (choices: { salesConsent: boolean; newsletterConsent: boolean }) => void;
  onWithdraw: () => void;
  onRetryStatus: () => void;
  wikiHref: string;
  onOpenWiki: () => void;
}

function Arrow() {
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

export default function Landing(props: LandingProps) {
  const { mode, status, state, identity, now } = props;
  const live = mode === "live" && !!status;
  const resetAt = live ? status.resetAt : nextUtcMidnight(now);
  const seconds = secondsUntil(resetAt, now);
  const enrolled = live && state.phase === "enrolled";
  const setupRef = useRef<HTMLElement>(null);
  const wasEnrolled = useRef(enrolled);
  useEffect(() => {
    // Move focus to the next step once enrollment completes on this page.
    if (enrolled && !wasEnrolled.current) {
      setupRef.current?.focus({ preventScroll: true });
      setupRef.current?.scrollIntoView?.({
        behavior: matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
    wasEnrolled.current = enrolled;
  }, [enrolled]);
  return (
    <div className="landing">
      <a className="skip-link landing-skip" href="#main" onClick={(event) => { event.preventDefault(); document.getElementById("main")?.focus(); }}>
        Skip to content
      </a>
      <div className="demo-banner" role="note">
        <span className="demo-tag">{live ? "PUBLIC DEMO" : "PREVIEW"}</span>
        <span>
          {live
            ? "Wikis reset at 00:00 UTC · Sample documents only."
            : props.previewReason === "resetting"
              ? "The demo is resetting. Sign-in returns after the reset."
              : "Live demo unavailable. Nothing is saved on this page."}
        </span>
      </div>
      <header className="landing-header wrap">
        <a className="landing-brand" href="#main" onClick={(event) => { event.preventDefault(); document.getElementById("main")?.focus(); }}>
          <span className="brand-mark" aria-hidden="true">W</span>WikiContext<span className="demo-pill">DEMO</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how" onClick={jump("how")}>How it works</a>
          <a href="#data" onClick={jump("data")}>Your data</a>
          <a className="nav-cta" href="#start" onClick={jump("start")}>Get started <Arrow /></a>
        </nav>
        <button
          className="icon-button"
          aria-label={`Switch to ${props.theme === "dark" ? "light" : "dark"} theme`}
          onClick={() => props.setTheme(props.theme === "dark" ? "light" : "dark")}
        >
          {props.theme === "dark" ? "☼" : "☾"}
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="hero wrap" aria-labelledby="hero-title">
          <p className="eyebrow">A WIKI YOUR CODING AGENT WRITES</p>
          <h1 id="hero-title">Your sources.<br />Your agent.<br /><em>A cited wiki.</em></h1>
          <p className="intro">
            Give your coding agent a document. It extracts passages, writes linked wiki pages with citations,
            and publishes them here — where you read, search and follow every claim back to its source.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#start" onClick={jump("start")}>Try it with Google <Arrow /></a>
            <a className="text-link" href="#how" onClick={jump("how")}>See how it works</a>
          </div>
        </section>
        <section className="reset-strip wrap" aria-labelledby="reset-title">
          <div>
            <h2 id="reset-title">A playground, not permanent storage.</h2>
            <p>
              This is a disposable public demo. Every account, source and wiki page is deleted daily at 00:00 UTC.
              Use harmless sample documents only.
            </p>
          </div>
          <div className="countdown" role="timer" aria-label="Time until the next reset">
            <span>NEXT RESET · 00:00 UTC</span>
            <strong>{formatCountdown(seconds)}</strong>
            <small>
              {live
                ? `Reset time supplied by the demo server (${new Date(resetAt).toISOString().replace(".000Z", "Z")}).`
                : "Illustrative · based on your device clock."}
            </small>
          </div>
        </section>
        <section id="how" className="how wrap" aria-labelledby="how-title" tabIndex={-1}>
          <p className="eyebrow">THE ROUND TRIP</p>
          <h2 id="how-title">From a file to a cited page.</h2>
          <ol className="steps">
            <li>
              <span className="step-label">01 / INGEST</span>
              <h3>Your agent uploads a source.</h3>
              <p>Text, Markdown or PDF. The original stays immutable; extracted passages become citable evidence.</p>
            </li>
            <li>
              <span className="step-label">02 / PUBLISH</span>
              <h3>It writes linked pages.</h3>
              <p>Every claim cites a passage. Publication is atomic and checked for broken links and missing citations.</p>
            </li>
            <li>
              <span className="step-label">03 / READ</span>
              <h3>You read and search here.</h3>
              <p>Private search, backlinks, history and one click from any citation to the original passage.</p>
            </li>
          </ol>
        </section>
        <section id="start" className="start wrap" aria-labelledby="start-title" tabIndex={-1}>
          <div className="start-copy">
            <p className="eyebrow">MAKE YOURSELF AT HOME</p>
            <h2 id="start-title">Sign in, accept the terms,<br /><em>connect your agent.</em></h2>
            <p>Any verified Google account works, including personal Gmail and Google Workspace accounts.</p>
            <ul className="expectations">
              <li>A private personal wiki space only you can read</li>
              <li>Your existing terminal and coding agent</li>
              <li>Wiki content and demo accounts reset at 00:00 UTC</li>
            </ul>
          </div>
          <EnrollmentCard {...props} />
        </section>
        {enrolled && (
          <section ref={setupRef} id="setup" className="setup wrap" aria-labelledby="setup-title" tabIndex={-1}>
            <p className="eyebrow">NEXT STEP</p>
            <h2 id="setup-title">Connect your coding agent.</h2>
            <AgentSetup status={status} email={identity?.email || ""} />
            <Restrictions />
            <Usage status={status} usage={state.enrollment?.usage ?? null} />
          </section>
        )}
        <section id="data" className="details wrap" aria-labelledby="data-title" tabIndex={-1}>
          <div>
            <p className="eyebrow">CLEAR FROM THE START</p>
            <h2 id="data-title">Temporary wiki.<br />Thoughtful boundaries.</h2>
          </div>
          <div className="faq">
            <details>
              <summary>What am I agreeing to?</summary>
              <p>
                Use synthetic or harmless sample documents only. Do not upload credentials, confidential information
                or other people’s personal data. The demo is temporary, has no availability or storage guarantee, and
                resets daily at 00:00 UTC. Sales contact and the newsletter are separate optional choices; neither is
                required. <a href="/terms/">Read the full terms.</a>
              </p>
            </details>
            <details>
              <summary>What stays, and for how long?</summary>
              <dl>
                <dt>Wiki data</dt>
                <dd>Accounts, sources, passages, pages and publications are deleted every day at 00:00 UTC. Copies your agent downloaded are not erased.</dd>
                <dt>Email without marketing consent</dt>
                <dd>Kept separately for up to 30 days after your last demo use.</dd>
                <dt>Marketing preferences</dt>
                <dd>Kept separately from wiki data, reviewed after 12 months, and withdrawable at any time. A minimal suppression record may remain to honour a withdrawal.</dd>
              </dl>
              <p><a href="/privacy/">Read the privacy notice.</a></p>
            </details>
            <details>
              <summary>Who can see my wiki?</summary>
              <p>
                Only you. Each visitor gets one private personal space; other visitors’ pages, sources and search
                results are never shown, and shared group spaces are not available in this demo.
              </p>
            </details>
            <details>
              <summary>What is not available?</summary>
              <p>
                Audio and video sources and transcription are disabled. Daily per-account limits apply to sources,
                passages, pages and publications. The browser is a read-only reader: your coding agent writes.
              </p>
            </details>
          </div>
        </section>
      </main>
      <footer className="landing-footer wrap">
        <span>WikiContext · knowledge connected to its evidence.</span>
        <nav aria-label="Legal">
          <a href="/terms/">Terms</a>
          <a href="/privacy/">Privacy</a>
        </nav>
      </footer>
    </div>
  );
}

function jump(id: string) {
  return (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const target = document.getElementById(id);
    target?.scrollIntoView?.({ behavior: matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target?.focus({ preventScroll: true });
  };
}

function EnrollmentCard(props: LandingProps) {
  const { mode, status, state, identity, now } = props;
  const live = mode === "live" && !!status;
  const [terms, setTerms] = useState(false);
  const [sales, setSales] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const statusId = useId();
  // Each freshly loaded revision asks again: terms unchecked, saved choices shown.
  useEffect(() => {
    setTerms(false);
    setSales(state.preferences?.salesContact ?? false);
    setNewsletter(state.preferences?.newsletter ?? false);
  }, [state.preferences]);
  const busy = state.phase === "signing-in" || state.phase === "checking" || state.phase === "enrolling";
  const signedIn = live && !!identity && ["consent", "enrolling", "enrolled"].includes(state.phase);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit(state, terms, status, Date.now())) return;
    props.onSubmit({ salesConsent: sales, newsletterConsent: newsletter });
  };
  return (
    <div className="enrollment-card" aria-busy={busy}>
      <div className="card-heading">
        <span className="mini-label">YOUR DEMO</span>
        <span className="mode-pill">{live ? `Day ${status.generation}` : "Not connected"}</span>
      </div>
      {!live ? (
        <>
          <h3>Sign-in is unavailable right now.</h3>
          <p className="card-intro">
            {props.previewReason === "resetting"
              ? "The demo is being reset for a new day. This usually takes a few minutes."
              : "The demo service could not be reached. This page is a static preview; nothing is saved."}
          </p>
          <button type="button" className="google-button" disabled>
            <span className="google-g" aria-hidden="true">G</span>Continue with Google
          </button>
          <button type="button" className="secondary-button" onClick={props.onRetryStatus}>Check again</button>
        </>
      ) : signedIn ? (
        <>
          <div className="identity">
            <span className="avatar" aria-hidden="true">{Array.from((identity!.name || identity!.email).trim())[0]?.toUpperCase() || "?"}</span>
            <div className="identity-details">
              <strong>{identity!.name || "Google account"}</strong>
              <span>{identity!.email}</span>
            </div>
          </div>
          {state.phase === "enrolled" ? (
            <div className="enrolled">
              <p>You’re enrolled for today’s demo. Your personal wiki is ready.</p>
              <a className="primary-button" href={props.wikiHref} onClick={props.onOpenWiki}>Open your wiki <Arrow /></a>
              {state.unsubscribeToken && (
                <div>
                  <button type="button" className="link-button" onClick={props.onWithdraw}>
                    Withdraw both marketing permissions
                  </button>
                  <p>Save this private link before leaving or reloading this page. It works after sign-out and the daily reset. Anyone with it can withdraw both permissions.</p>
                  <a href={withdrawalLink(state.unsubscribeToken)} target="_blank" rel="noopener noreferrer">Private withdrawal link</a>
                  <p>Copy the link address to save it. No email is sent.</p>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={submit} aria-describedby={statusId}>
              <fieldset disabled={state.phase === "enrolling"}>
                <legend>Your choices</legend>
                <label className="check-row required">
                  <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required />
                  <span>
                    I accept the <a href="/terms/" target="_blank" rel="noopener">demo terms</a> and understand that my
                    demo wiki is deleted daily at 00:00 UTC.
                    <small>Required to try the demo</small>
                  </span>
                </label>
                <div className="optional-label">OPTIONAL · YOUR CHOICE</div>
                <label className="check-row">
                  <input type="checkbox" checked={sales} onChange={(event) => setSales(event.target.checked)} />
                  <span>PocketContext may contact me by email about WikiContext and commercial offers.</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} />
                  <span>Subscribe me to the PocketContext newsletter.</span>
                </label>
                <p className="privacy-note">
                  {state.preferences?.revision
                    ? "Your saved preferences are shown. Review them before continuing."
                    : "Both optional choices are off unless you turn them on."}{" "}
                  Read the <a href="/privacy/" target="_blank" rel="noopener">privacy notice</a>.
                </p>
                <button className="primary-button continue-button" type="submit" disabled={!canSubmit(state, terms, status, now)}>
                  Accept terms &amp; continue <Arrow />
                </button>
              </fieldset>
            </form>
          )}
          <button type="button" className="link-button" onClick={props.onSignOut} disabled={state.phase === "enrolling"}>
            Sign out of this browser
          </button>
        </>
      ) : (
        <>
          <h3>Let’s get you started.</h3>
          <p className="card-intro">Sign in with Google, then review the terms and your preferences.</p>
          <button
            type="button"
            className="google-button"
            onClick={props.onSignIn}
            disabled={busy || state.phase === "resetting" || secondsUntil(status.resetAt, now) === 0}
          >
            <span className="google-g" aria-hidden="true">G</span>
            {state.phase === "signing-in" ? "Waiting for Google…" : state.phase === "checking" ? "Checking your session…" : "Continue with Google"}
          </button>
          {state.phase === "signing-in" && (
            <button type="button" className="link-button" onClick={props.onCancelSignIn}>Cancel Google sign-in</button>
          )}
          <p className="micro">Google identifies you. We never see your Google password.</p>
        </>
      )}
      <p id={statusId} className="form-status" role="status">{state.message}</p>
    </div>
  );
}

function AgentSetup({ status, email }: { status: DemoStatus | null; email: string }) {
  const installation = checkedInstallation(status);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const code = useRef<HTMLElement>(null);
  if (!installation)
    return (
      <div className="setup-unavailable" role="note">
        <strong>Coding-agent setup is temporarily unavailable.</strong>
        <p>
          This server does not currently advertise a tested public client. Your enrollment is saved; check back later
          today. Do not install other WikiContext clients against this demo.
        </p>
      </div>
    );
  const prompt = agentPrompt(installation, location.origin, email);
  const copyPrompt = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
      setCopy("copied");
    } catch {
      // Select the text so it can be copied manually.
      const selection = window.getSelection(), range = document.createRange();
      if (code.current && selection) { range.selectNodeContents(code.current); selection.removeAllRanges(); selection.addRange(range); }
      setCopy("failed");
    }
  };
  return (
    <div className="agent-setup">
      <p>
        Paste these instructions into Claude Code, Codex or another coding agent. It installs the public
        <code> wikicontext </code> skill, signs in with the same Google account and helps you publish your first cited
        pages. Node.js/npm and uv are required. Nothing runs until your agent runs it.
      </p>
      <div className="codebox">
        <button type="button" className="copy-button" onClick={() => void copyPrompt()}>
          {copy === "copied" ? "Copied" : copy === "failed" ? "Select & copy" : "Copy instructions"}
        </button>
        <pre tabIndex={0} aria-label="Coding-agent setup instructions"><code ref={code}>{prompt}</code></pre>
      </div>
      <p className="copy-status" role="status" aria-live="polite">
        {copy === "copied"
          ? "Instructions copied. No commands have been run."
          : copy === "failed"
            ? "Clipboard unavailable. The instructions are selected; copy them manually."
            : ""}
      </p>
      <p className="micro">Client revision {installation.clientRevision.slice(0, 12)} · source {installation.source}</p>
    </div>
  );
}

function Restrictions() {
  return (
    <ul className="restrictions" aria-label="Demo restrictions">
      <li><strong>Personal space only.</strong> Your wiki is private to you; group spaces are off.</li>
      <li><strong>No audio or video.</strong> Audio/video sources and transcription are refused.</li>
      <li><strong>Read-only browser.</strong> Your coding agent ingests and publishes; this site reads.</li>
    </ul>
  );
}

function Usage({ status, usage }: { status: DemoStatus | null; usage: Record<string, number> | null }) {
  const rows = QUOTA_LABELS.filter(([key]) => status?.limits[key] !== undefined);
  if (!rows.length) return null;
  return (
    <table className="usage">
      <caption>Today’s usage and daily limits</caption>
      <thead><tr><th scope="col">Item</th><th scope="col">Used</th><th scope="col">Limit</th></tr></thead>
      <tbody>
        {rows.map(([key, label, unit]) => (
          <tr key={key}>
            <th scope="row">{label}</th>
            <td>{formatAmount(usage?.[key] ?? 0, unit)}</td>
            <td>{formatAmount(status!.limits[key], unit)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
