#!/usr/bin/env bash
# Fails unless the archived app AND its Share Extension carry the shared
# keychain group in their code signature. Export (App Store signing) copies
# entitlements from the archived signature, so if they're missing here the
# TestFlight build ships without them and the Share Extension can't read the
# receipt share token. Used by ios-compile.yml and ios-testflight.yml.
set -euo pipefail
APP="${1:?usage: ios-check-entitlements.sh path/to/App.app}"
GROUP="6RTNUZR7K5.com.mrlukedevans.live.shared"
EXT="$APP/PlugIns/ShareExtension.appex"

[ -d "$EXT" ] || { echo "::error::ShareExtension.appex is not embedded in $APP"; exit 1; }
for bundle in "$APP" "$EXT"; do
  ents=$(codesign -d --entitlements :- "$bundle" 2>/dev/null || true)
  if ! printf '%s' "$ents" | grep -q "$GROUP"; then
    echo "::error::$(basename "$bundle") is missing keychain group $GROUP"
    printf '%s\n' "$ents"
    exit 1
  fi
  echo "ok: $(basename "$bundle") has $GROUP"
done
