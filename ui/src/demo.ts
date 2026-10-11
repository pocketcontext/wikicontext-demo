// Public-demo onboarding: status validation, the enrollment state machine and the
// demo API calls. Live behaviour is enabled only by a validated same-origin status.
// The unsubscribe capability is held in memory; visitors may explicitly save its private link.
import { pb } from "./api";

export const SKILL_SOURCE = "https://github.com/pocketcontext/wikicontext-demo/tree/main/skills/wikicontext";

export interface DemoInstallation {
  method: "skills";
  source: string;
  skill: "wikicontext";
  clientRevision: string;
}
export interface DemoStatus {
  enabled: true;
  clientReady: boolean;
  installation: DemoInstallation | null;
  generation: string;
  resetAt: string;
  termsVersion: string;
  consentVersion: string;
  limits: Record<string, number>;
  restrictions: Record<string, boolean>;
}
export type StatusResult =
  | { kind: "standard" }
  | { kind: "demo"; status: DemoStatus }
  | { kind: "preview"; reason: "resetting" | "unavailable" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Classifies a `/api/demo/status` response. Anything unexpected stays a preview. */
export function parseStatus(httpStatus: number, data: unknown): StatusResult {
  if (httpStatus === 503) return { kind: "preview", reason: "resetting" };
  if (httpStatus !== 200 || !isRecord(data)) return { kind: "preview", reason: "unavailable" };
  if (data.enabled === false && Object.keys(data).length === 1) return { kind: "standard" };
  const generation = data.generation, resetAt = data.resetAt;
  if (
    data.enabled !== true ||
    typeof generation !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(generation) ||
    typeof resetAt !== "string" || !Number.isFinite(Date.parse(resetAt)) ||
    Date.parse(resetAt) !== Date.parse(generation + "T00:00:00Z") + 86400000 ||
    typeof data.termsVersion !== "string" || !data.termsVersion ||
    typeof data.consentVersion !== "string" ||
    typeof data.clientReady !== "boolean"
  )
    return { kind: "preview", reason: "unavailable" };
  const limits: Record<string, number> = {};
  if (isRecord(data.limits))
    for (const [key, value] of Object.entries(data.limits))
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) limits[key] = value;
  const restrictions: Record<string, boolean> = {};
  if (isRecord(data.restrictions))
    for (const [key, value] of Object.entries(data.restrictions))
      if (typeof value === "boolean") restrictions[key] = value;
  return {
    kind: "demo",
    status: {
      enabled: true, clientReady: data.clientReady, generation, resetAt,
      termsVersion: data.termsVersion, consentVersion: data.consentVersion,
      installation: isRecord(data.installation) ? (data.installation as unknown as DemoInstallation) : null,
      limits, restrictions,
    },
  };
}

export async function fetchStatus(signal?: AbortSignal): Promise<StatusResult> {
  try {
    const response = await fetch("/api/demo/status", {
      cache: "no-store", credentials: "omit", headers: { Accept: "application/json" }, signal,
    });
    let data: unknown = null;
    try { data = await response.json(); } catch { data = null; }
    return parseStatus(response.status, data);
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "preview", reason: "unavailable" };
  }
}

/** Installation instructions only for the allowlisted public skill and a full commit pin. */
export function checkedInstallation(status: DemoStatus | null | undefined): DemoInstallation | null {
  const installation = status?.installation;
  if (
    status?.clientReady !== true || !installation ||
    installation.method !== "skills" || installation.source !== SKILL_SOURCE ||
    installation.skill !== "wikicontext" ||
    typeof installation.clientRevision !== "string" || !/^[a-f0-9]{40}$/.test(installation.clientRevision)
  )
    return null;
  return installation;
}

/** POSIX single-quoted shell word; identity text is never interpolated as code. */
export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function agentPrompt(installation: DemoInstallation, origin: string, email: string): string {
  return `Install the WikiContext skill in this workspace with:

npx skills add ${installation.source} --skill wikicontext --yes

Use the appropriate --agent option if needed (codex or claude-code), then load the installed skill and follow its instructions. Check that Node.js/npm and uv are available first.

Before running the client, verify that the installed skill launcher pins client revision ${installation.clientRevision}. If the pin differs, pause setup and report the mismatch; do not substitute another client revision.

Connect to the public WikiContext demo with these settings:

export WIKICONTEXT_URL=${shellQuote(origin)}
export WIKICONTEXT_USER_EMAIL=${shellQuote(email)}
wikicontext login --google
wikicontext check

I have already signed in on the website and accepted today's terms with this same Google account. On a remote host, guide me through the callback port forwarding described in the skill.

Then help me ingest a harmless sample text, Markdown or PDF document (no audio, credentials, confidential or personal data), synthesize cited pages and publish them to my personal space. The demo deletes all wiki data at 00:00 UTC; after a reset I must sign in on the website and accept the terms again.`;
}

export function secondsUntil(resetAt: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(resetAt) - now) / 1000));
}
export function nextUtcMidnight(now: number): string {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}
export function formatCountdown(seconds: number): string {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((n) => String(n).padStart(2, "0")).join(":");
}

/** How a later status observation affects a session admitted under `previous`. */
export function statusChange(previous: DemoStatus, next: StatusResult, now: number): "same" | "new-day" | "resetting" {
  if (next.kind === "preview") return "resetting";
  if (next.kind !== "demo" || next.status.generation !== previous.generation) return "new-day";
  return secondsUntil(previous.resetAt, now) === 0 ? "resetting" : "same";
}

// ---- Enrollment state machine ----

export interface Preferences { revision: number; salesContact: boolean; newsletter: boolean }
export interface Enrollment {
  enrolled: boolean;
  generation: string;
  termsVersion: string;
  space: string | null;
  usage: Record<string, number> | null;
}
export type Phase =
  | "signed-out" | "signing-in" | "checking" | "consent" | "enrolling" | "enrolled" | "resetting";
export interface OnboardingState {
  phase: Phase;
  preferences: Preferences | null;
  enrollment: Enrollment | null;
  message: string;
  /** Whether the latest preferences were reloaded after a 409 conflict. */
  conflict: boolean;
  /** Withdrawal capability returned once by enrollment. Memory only. */
  unsubscribeToken: string;
}
export type OnboardingEvent =
  | { type: "signin-start" }
  | { type: "signin-failed"; message: string }
  | { type: "check" }
  | { type: "enrollment"; enrollment: Enrollment }
  | { type: "preferences"; preferences: Preferences }
  | { type: "submit" }
  | { type: "enrolled"; enrollment: Enrollment; unsubscribeToken: string }
  | { type: "conflict" }
  | { type: "failed"; message: string }
  | { type: "refresh-enrollment"; enrollment: Enrollment }
  | { type: "withdrawn"; message: string }
  | { type: "withdrawn-failed"; message: string }
  | { type: "signed-out"; message: string }
  | { type: "auth-cleared" }
  | { type: "resetting"; message?: string };

export const initialOnboarding: OnboardingState = {
  phase: "signed-out", preferences: null, enrollment: null, message: "", conflict: false, unsubscribeToken: "",
};

export function onboardingReducer(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  switch (event.type) {
    case "signin-start":
      return { ...initialOnboarding, phase: "signing-in", message: "Complete Google sign-in in the popup, or cancel to try again." };
    case "signin-failed":
      return { ...initialOnboarding, message: event.message };
    case "check":
      return { ...state, phase: "checking", preferences: null, message: state.conflict ? state.message : "" };
    case "enrollment":
      if (state.phase !== "checking") return state;
      return event.enrollment.enrolled
        ? { ...state, phase: "enrolled", enrollment: event.enrollment, preferences: null }
        : { ...state, enrollment: event.enrollment };
    case "preferences":
      if (state.phase !== "checking") return state;
      return { ...state, phase: "consent", preferences: event.preferences };
    case "submit":
      if (state.phase !== "consent" || !state.preferences) return state;
      return { ...state, phase: "enrolling", message: "Saving your choices…" };
    case "enrolled":
      if (state.phase !== "enrolling") return state;
      return {
        ...state, phase: "enrolled", enrollment: event.enrollment, conflict: false,
        unsubscribeToken: event.unsubscribeToken,
        message: "Enrollment saved for today. No email has been sent.",
      };
    case "conflict":
      // Never retry a stale opt-in: reload preferences and ask again.
      return {
        ...state, phase: "checking", preferences: null, conflict: true,
        message: "Your preferences changed elsewhere. Review the latest choices and submit again.",
      };
    case "failed":
      return {
        ...state,
        phase: state.phase === "enrolling" ? "consent" : state.phase === "checking" ? "signed-out" : state.phase,
        message: event.message,
      };
    case "refresh-enrollment":
      return state.phase === "enrolled" ? { ...state, enrollment: event.enrollment } : state;
    case "withdrawn":
      return { ...state, unsubscribeToken: "", message: event.message };
    case "withdrawn-failed":
      return { ...state, message: event.message };
    case "signed-out":
      return { ...initialOnboarding, message: event.message };
    case "auth-cleared":
      // Stored credentials disappeared (sign-out here or in another tab, expiry).
      if (state.phase === "signed-out" || state.phase === "resetting" || state.phase === "signing-in") return state;
      return { ...initialOnboarding, message: "Signed out of this browser. Existing coding-agent sessions are unchanged." };
    case "resetting":
      return { ...initialOnboarding, phase: "resetting", message: event.message ?? "The demo is resetting. Sign in again after the reset." };
  }
}

export function canSubmit(state: OnboardingState, termsAccepted: boolean, status: DemoStatus | null, now: number): boolean {
  return (
    state.phase === "consent" && termsAccepted && !!status &&
    !!state.preferences && Number.isInteger(state.preferences.revision) && state.preferences.revision >= 0 &&
    pb.authStore.isValid && secondsUntil(status.resetAt, now) > 0
  );
}

// ---- Demo API ----

export class DemoError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function demoMessage(status: number): string {
  if (status === 409) return "Your preferences changed elsewhere. Review the latest choices and submit again.";
  if (status === 503) return "The demo is resetting or temporarily unavailable. Please try again shortly.";
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 400) return "Accept the current terms and choose each optional preference.";
  if (status === 429) return "The demo is at capacity for today. Please try again after the reset.";
  return "The request could not be completed. Please try again.";
}
async function demoSend<T>(path: string, body?: unknown): Promise<T> {
  try {
    return await pb.send<T>(path, body === undefined ? { method: "GET" } : { method: "POST", body });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 0;
    throw new DemoError(demoMessage(status), status);
  }
}
const isFlag = (value: unknown): value is boolean => typeof value === "boolean";

export async function getEnrollment(status: DemoStatus): Promise<Enrollment> {
  const value = await demoSend<Enrollment>("/api/demo/enrollment");
  if (!isRecord(value) || !isFlag(value.enrolled) || value.generation !== status.generation)
    throw new DemoError("Your enrollment could not be verified. Sign in again.", 0);
  const usage = isRecord(value.usage) ? Object.fromEntries(
    Object.entries(value.usage).filter((entry): entry is [string, number] => Number.isSafeInteger(entry[1]))) : null;
  return {
    enrolled: value.enrolled && value.termsVersion === status.termsVersion,
    generation: value.generation, termsVersion: String(value.termsVersion),
    space: typeof value.space === "string" && /^[a-z0-9]{15}$/.test(value.space) ? value.space : null,
    usage,
  };
}
export async function getPreferences(): Promise<Preferences> {
  const value = await demoSend<Preferences>("/api/demo/preferences");
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !isFlag(value.salesContact) || !isFlag(value.newsletter))
    throw new DemoError("Your preferences could not be verified. Sign in again.", 0);
  return { revision: value.revision, salesContact: value.salesContact, newsletter: value.newsletter };
}
export async function enroll(
  status: DemoStatus,
  choices: { salesConsent: boolean; newsletterConsent: boolean; expectedRevision: number },
): Promise<{ enrollment: Enrollment; unsubscribeToken: string }> {
  if (!isFlag(choices.salesConsent) || !isFlag(choices.newsletterConsent) ||
      !Number.isSafeInteger(choices.expectedRevision) || choices.expectedRevision < 0)
    throw new DemoError(demoMessage(400), 400);
  const value = await demoSend<Record<string, unknown>>("/api/demo/enroll", {
    generation: status.generation, termsVersion: status.termsVersion, acceptTerms: true,
    salesConsent: choices.salesConsent, newsletterConsent: choices.newsletterConsent,
    expectedRevision: choices.expectedRevision,
  });
  const contact = isRecord(value?.contact) ? value.contact : null;
  if (value?.enrolled !== true || value.generation !== status.generation || !contact || !Number.isSafeInteger(contact.revision))
    throw new DemoError("Enrollment could not be verified. Refresh your preferences before retrying.", 0);
  return {
    enrollment: {
      enrolled: true, generation: status.generation, termsVersion: status.termsVersion,
      space: typeof value.space === "string" ? value.space : null, usage: {},
    },
    unsubscribeToken: typeof contact.unsubscribeToken === "string" ? contact.unsubscribeToken : "",
  };
}
export async function withdraw(token: string): Promise<void> {
  // Keep withdrawal independent of stale login credentials and reset status.
  const response = await fetch("/api/demo/unsubscribe", {
    method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new DemoError("Withdrawal could not be confirmed. Please try again.", response.status);
  const value: unknown = await response.json();
  if (!isRecord(value) || value.ok !== true) throw new DemoError("Withdrawal could not be confirmed. Please try again.", 0);
}

/** Usage rows shown to the visitor: today's counter against its daily limit. */
export const QUOTA_LABELS: [key: string, label: string, unit?: "bytes"][] = [
  ["sources", "Sources"],
  ["originalBytes", "Original files", "bytes"],
  ["passages", "Passages"],
  ["textBytes", "Text", "bytes"],
  ["pages", "Pages"],
  ["publications", "Publications"],
  ["writes", "Writes"],
];
export function formatAmount(value: number, unit?: "bytes"): string {
  if (unit !== "bytes") return value.toLocaleString("en");
  if (value >= 1048576) return `${(value / 1048576).toFixed(value % 1048576 ? 1 : 0)} MiB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KiB`;
  return `${value} B`;
}
