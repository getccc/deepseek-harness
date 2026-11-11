---
kind: upgrade-guide
description: "Team macOS desktop packaging requires a signed and notarized Computer Use artifact."
---

# Team macOS desktop helper input

English | [中文](guide.zh.md)

## Change

Team macOS desktop packaging requires `DSH_TEAM_CUA_HELPER`. Earlier builds carried no Computer Use application, so enabling that plugin could not load its native helper. Packaging now verifies the official helper artifact against the current sources and checks its signature, architecture and notarization before staging it. Windows packaging does not require this input.

The desktop profile is initialized only when missing. Existing plugin selections, dependencies and user patches remain in place. Shipped Office and ECharts plugins move to a private writable directory; profile-declared dependencies take precedence. Existing sessions and settings require no conversion.

## Migration

1. Configure the official macOS release credentials and run `node --import tsx/esm scripts/cua-helper/package.ts --out /absolute/path/to/cua-artifact` from the repository root. See [Team desktop packaging](../../../../apps/team-runner-desktop/README.md#preparing-computer-use).
2. Extract `cua-helper.tgz` into a separate directory and set `DSH_TEAM_CUA_HELPER` to that directory for both `package:mac` and `package:mac:x64`. Rebuild the artifact when its source digest changes. Keep the existing Runner, plugin-tree and Office-sidecar inputs.
3. Build the installer. Confirm it contains `Contents/Resources/runner/cua/DSH Computer Use.app` and that packaging's post-sign digest check passes.
4. On macOS 14 or later, enable Computer Use in Plugins, select a PTC session and grant Accessibility and Screen Recording through its permission page. Restart WeWork and confirm the selected plugin remains enabled. System grants still require the user's action.
