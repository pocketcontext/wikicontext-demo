import { afterEach, expect, it, vi } from "vitest";
import { handleFailure, onServiceSignal, pb, selectSpace, setDemoMode, type Space } from "./api";
import { agentPrompt, checkedInstallation, initialOnboarding, onboardingReducer, parseStatus, SKILL_SOURCE, statusChange, type DemoStatus } from "./demo";
const status: DemoStatus = { enabled: true, clientReady: true, generation: "2026-10-10", resetAt: "2026-10-11T00:00:00Z", termsVersion: "1", consentVersion: "1", limits: {}, restrictions: {}, installation: { method: "skills", source: SKILL_SOURCE, skill: "wikicontext", clientRevision: "a".repeat(40) } };
afterEach(() => { setDemoMode(false); pb.authStore.clear(); vi.restoreAllMocks(); });
it("enables live mode only for a coherent same-day deadline and explicit demo response", () => {
  expect(parseStatus(200, status).kind).toBe("demo");
  expect(parseStatus(200, { enabled: false })).toEqual({ kind: "standard" });
  for (const value of [null, {}, { ...status, resetAt: "2026-10-12T00:00:00Z" }, { ...status, generation: "bad" }, { enabled: false, unexpected: true }]) expect(parseStatus(200, value).kind).toBe("preview");
  expect(parseStatus(503, status)).toEqual({ kind: "preview", reason: "resetting" });
});
it("advertises only the allowlisted pinned client and quotes shell identity text", () => {
  expect(checkedInstallation(status)).toEqual(status.installation);
  expect(checkedInstallation({ ...status, clientReady: false })).toBeNull();
  expect(checkedInstallation({ ...status, installation: { ...status.installation!, source: "https://evil.test" } })).toBeNull();
  expect(agentPrompt(status.installation!, "https://demo.example", "a'$(echo unsafe)@example.test")).toContain("'a'\\''$(echo unsafe)@example.test'");
});
it("a consent conflict removes stale preferences and never retries automatically", () => {
  let state = onboardingReducer(initialOnboarding, { type: "check" });
  state = onboardingReducer(state, { type: "preferences", preferences: { revision: 0, salesContact: false, newsletter: false } });
  state = onboardingReducer(state, { type: "submit" });
  state = onboardingReducer(state, { type: "conflict" });
  expect(state.phase).toBe("checking"); expect(state.preferences).toBeNull();
  state = onboardingReducer(state, { type: "preferences", preferences: { revision: 1, salesContact: true, newsletter: false } });
  expect(state.phase).toBe("consent"); expect(state.conflict).toBe(true);
  expect(onboardingReducer(state, { type: "auth-cleared" })).toMatchObject({ phase: "signed-out", preferences: null, unsubscribeToken: "" });
});
it("fences expired days and changed generations", () => {
  expect(statusChange(status, { kind: "demo", status }, Date.parse("2026-10-10T12:00:00Z"))).toBe("same");
  expect(statusChange(status, { kind: "demo", status }, Date.parse(status.resetAt))).toBe("resetting");
  expect(statusChange(status, { kind: "demo", status: { ...status, generation: "2026-10-11" } }, 0)).toBe("new-day");
});
it("signals enrollment for demo wiki denials but clears revoked authentication and ignores stale failures", () => {
  setDemoMode(true); pb.authStore.save("current", { id: "user00000000001", collectionName: "users", collectionId: "_pb_users_auth_" });
  const listener = vi.fn(), remove = onServiceSignal(listener);
  handleFailure(403, "old", "/api/context/query"); expect(listener).not.toHaveBeenCalled();
  handleFailure(403, "current", "/api/context/query"); expect(listener).toHaveBeenCalledWith("enrollment"); expect(pb.authStore.token).toBe("current");
  handleFailure(503, "current", "/api/context/query"); expect(listener).toHaveBeenCalledWith("resetting");
  handleFailure(403, "current", "/api/collections/users/auth-refresh"); expect(pb.authStore.token).toBe(""); remove();
});
it("chooses only memberships and defaults to the personal space", () => {
  const group: Space = { id: "space0000000001", kind: "group", name: "Group", role: "reader" };
  const personal: Space = { id: "space0000000002", kind: "personal", name: "Mine", role: "owner" };
  expect(selectSpace([group, personal])).toBe(personal);
  expect(selectSpace([group, personal], group.id)).toBe(group);
  expect(selectSpace([group, personal], "foreign00000001")).toBe(personal);
  expect(selectSpace([])).toBeNull();
});
it("loads enrolled preferences and preserves access while refreshing conflicting or withdrawn choices", () => {
  const enrollment = { enrolled: true, generation: status.generation, termsVersion: status.termsVersion, space: "personal", usage: {} };
  let state = onboardingReducer(initialOnboarding, { type: "check" });
  state = onboardingReducer(state, { type: "enrollment", enrollment });
  expect(state).toMatchObject({ phase: "checking", preferences: null, enrollment });
  state = onboardingReducer(state, { type: "preferences", preferences: { revision: 2, salesContact: true, newsletter: false } });
  expect(state.phase).toBe("enrolled");
  state = onboardingReducer(state, { type: "submit" });
  state = onboardingReducer(state, { type: "enrolled", enrollment, unsubscribeToken: "synthetic", preferences: { revision: 3, salesContact: false, newsletter: true } });
  expect(state.preferences).toEqual({ revision: 3, salesContact: false, newsletter: true });
  state = onboardingReducer(state, { type: "conflict" });
  expect(state).toMatchObject({ phase: "checking", preferences: null, enrollment });
  state = onboardingReducer(state, { type: "preferences", preferences: { revision: 4, salesContact: false, newsletter: false } });
  expect(state).toMatchObject({ phase: "enrolled", conflict: true, enrollment });
  state = onboardingReducer(state, { type: "withdrawn", message: "Withdrawn" });
  expect(state).toMatchObject({ phase: "checking", preferences: null, unsubscribeToken: "", enrollment });
  state = onboardingReducer(state, { type: "failed", message: "Unavailable" });
  expect(state).toMatchObject({ phase: "enrolled", preferences: null, enrollment });
  expect(onboardingReducer(state, { type: "submit" })).toEqual(state);
});
