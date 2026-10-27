// "The user's group", picked the same way everywhere (ISSUES.md P2, 2026-10-20).
// Several functions looked it up with `limit=1` and no ordering, so a second
// membership would have made the pick arbitrary. The client orders by when the
// member joined (app.js loadOrCreateUserGroup); the server now does the same.
// Business spaces live in their own tables and never appear here (VIEWS_DESIGN §2.1).

const FIRST_GROUP_ORDER = "order=joined_at.asc,group_id.asc";

// PostgREST path (no leading slash, no host) for a user's first group membership.
function userGroupQuery(userId, select = "group_id") {
  return `live_group_members?user_id=eq.${encodeURIComponent(userId)}&select=${select}&${FIRST_GROUP_ORDER}&limit=1`;
}

module.exports = { userGroupQuery, FIRST_GROUP_ORDER };
