// ai-context.js — a single DETERMINISTIC context surface for a future AI agent (and
// for Home), composing the substrate the earlier slices built: WHAT'S TRUE NOW
// (projectToday), WHAT THE APP CAN DO (the platform-capabilities catalog), and the
// GROUND RULES an agent must honor. Pure composition, no side effects.
//
// This is explicitly NOT an AI framework: no model calls, no agent loop, no
// autonomy live here. The point of "AI readiness" is that the APPLICATION is
// legible — canonical concepts, provenance on ingress data, capability discovery,
// deterministic projections, diagnostics, account-scoped boundaries — so a future
// agent can reason about and operate on it through the existing typed tool layer
// (ARCHITECTURE.md §9) rather than re-deriving facts or writing arbitrary state.

import { projectToday } from "./today-projection.js";
import { describeCapabilities } from "./platform-capabilities.js";

// The ground rules an agent must honor. Encoded as data (not prose) so they travel
// with the context and can be asserted in tests. Mirrors ARCHITECTURE.md §9.
export const AGENT_CONTRACT = Object.freeze({
  factsAreDeterministic: true,      // read facts from `today`; never invent them
  actThroughTypedToolsOnly: true,   // mutate only via the typed tool layer (chat.js TOOLS)
  confirmOutwardOrDestructive: true,// outward/destructive actions are confirmation-first
  accountScoped: true,              // all context + actions are scoped to the active account
  provenanceOnIngressData: true,    // imported/provider/generated records carry provenance
});

// Compose the deterministic context. `now` is always supplied (pure). `extra.today`
// injects still-inline domain projections (tasks/meals) into projectToday; `extra.available`
// marks which capabilities are live in this runtime.
export function buildAgentContext(state, now = new Date(), extra = {}) {
  return {
    generatedAt: now.toISOString(),
    today: projectToday(state, now, extra.today || {}),
    capabilities: describeCapabilities(extra.available || null),
    contract: AGENT_CONTRACT,
  };
}
