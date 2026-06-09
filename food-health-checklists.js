(function foodHealthChecklistFactory(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LiveFoodHealthChecklists = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createFoodHealthChecklists() {
"use strict";

// These two source-specific templates intentionally remain empty until their
// exact items have been reviewed and approved by the user.
const placeholderTemplates = [
  {
    id: "twenty-one-tweaks",
    name: "21 Tweaks for Weight Loss",
    description: "Placeholder awaiting reviewed checklist items.",
    sourceName: "NutritionFacts.org",
    isBuiltIn: true,
    items: []
  },
  {
    id: "maximally-ldl-lowering",
    name: "Maximally LDL-Lowering Checklist",
    description: "Placeholder awaiting reviewed checklist items.",
    sourceName: "",
    isBuiltIn: true,
    items: []
  }
];

return { placeholderTemplates };
}));
