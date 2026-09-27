#!/usr/bin/env bash
# Netlify build-skip rule (netlify.toml → [build] ignore). Exit 0 = SKIP the
# build, exit 1 = BUILD it (Netlify's convention).
#
# Merging to `main` no longer deploys by itself: a PRODUCTION build runs only
# when the commit being built has "[deploy]" in its message (e.g. merge the PR
# with a title containing [deploy]). Everything else — deploy previews, branch
# deploys — always builds. Undeployed work waiting on main is listed in
# UNDEPLOYED.md. Fails OPEN: if anything here breaks, the build proceeds (i.e.
# the old always-deploy behavior), never a silently-lost deploy request.
if [ "${CONTEXT:-}" != "production" ]; then
  exit 1
fi
if [ "${FORCE_DEPLOY:-}" = "true" ]; then
  echo "FORCE_DEPLOY=true — building."
  exit 1
fi
msg="$(git log -1 --format=%B "${COMMIT_REF:-HEAD}" 2>/dev/null)" || exit 1
case "$msg" in
  *"[deploy]"*)
    echo "[deploy] found in the commit message — building production."
    exit 1 ;;
  *)
    echo "Skipping production build: no [deploy] in the commit message. Pending work is listed in UNDEPLOYED.md."
    exit 0 ;;
esac
