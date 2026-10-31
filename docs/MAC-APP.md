# The Mac app

Inroad is also a Mac app: the same Inroad in its own window, no Terminal needed. It runs its server inside the app,
on this Mac only, keeps your work in `~/Library/Application Support/Inroad/Workspace`, and your AI key in the Mac
Keychain.

**Get it.** On GitHub, open **Actions → Mac app**, pick the latest green run, and download **Inroad-mac-arm64**
(Apple silicon: M1 and later) or **Inroad-mac-x64** (Intel). Tagged versions (`v0.2.0`) are also attached to a
**Release**. Open the `.dmg` and drag Inroad into Applications.

**The first time you open it.** Until the app is signed with an Apple Developer ID (below), macOS blocks it as coming
from an unidentified developer. Open it once, then go to **System Settings → Privacy & Security**, find the line
saying Inroad was blocked, and choose **Open Anyway**. Or, in Terminal: `xattr -dr com.apple.quarantine
/Applications/Inroad.app`. You only do this once per version.

**Day to day.** Closing the window keeps Inroad in the Dock; quitting stops its server. **Inroad → Settings…** (⌘,)
opens Settings; **Help** opens the data folder and the server log (`~/Library/Application Support/Inroad/Logs`).
**Inroad → Open at Login** starts it when you log in, so hooks, the public URL and agents keep reaching it. Opened
from the disk image or Downloads, Inroad offers to move itself to Applications. If its server quits after running a
while, the app starts it again by itself (once in ten minutes) and puts you back on the page you were on.

**Updates, in one click.** Every 6 hours (and from **Inroad → Check for Updates…** or Settings → General → Updates)
the app asks GitHub for the latest release. A newer one downloads in the background, is checked against the SHA-256
GitHub publishes for it (or the release's `SHA256SUMS.txt`), and then by macOS: a valid signature, from the same
developer as the copy you have when that copy is signed, and the version it claims. When it's ready, the sidebar says
so: **Restart to update** backs up your workspace, quits, swaps the new app in where the old one was and opens it. If
the swap fails, the old app is put back and opened. Your data and Keychain key aren't touched. This works for ad hoc
builds too (Electron's own updater only installs into apps signed with a Developer ID). It needs Inroad in a folder
your account can change (Applications, for an admin account); otherwise Settings says why and links the download.
Automatic checks can be turned off in Settings. A check tells GitHub your IP address and which version you run,
as any download would, and nothing about your work.

**Build it yourself on a Mac:**

```bash
npm ci
npm run desktop:server -- --platform darwin --arch arm64   # the app's server (x64 for Intel)
npm run desktop:dist -- --arm64 -c.mac.identity=-          # desktop/dist/Inroad-<version>-arm64.dmg
npm run desktop:dev                                        # or run the shell from the repository
npm run desktop:test                                       # check the shell (on Linux: xvfb-run npm run desktop:test)
```

**Signing for release.** A paid Apple Developer Program membership gives you a Developer ID Application certificate.
Add these repository secrets and the Mac app workflow signs every build and has Apple notarize it, so it opens like any
app from the internet: `MAC_CERTIFICATE` (the certificate exported as .p12, base64), `MAC_CERTIFICATE_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Before the first release, change `appId` in
`desktop/electron-builder.yml` to a reverse-DNS name you own. The Mac App Store would need App Sandbox, which this
build doesn't use.

**Publishing an update.** `npm run release -- 0.2.0` sets the version in `package.json`, `package-lock.json` and
`desktop/app/package.json`, moves the changelog's Unreleased notes under `v0.2.0`, commits and tags. Pushing the tag
(`git push origin main v0.2.0`) runs the Mac app workflow, which refuses a tag that doesn't match those versions,
builds both chips and publishes the release with `SHA256SUMS.txt`. Installed apps find it within 6 hours. Keep signing
the same way from release to release: an app signed with a Developer ID only accepts updates signed by the same team.
