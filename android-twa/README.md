# Weftling for Android (TWA)

A Trusted Web Activity wrapper: a real Android app whose entire UI is the
live https://weftling.fabbricerp.com. Content updates ship by deploying the
website — the app is only rebuilt to change its icon, name, version, or
other shell-level details.

## What's in here

- `twa-manifest.json` — the app definition (package id `com.fabbric.weftling`,
  colors, icons, start URL). Edit this, then regenerate + rebuild.
- `weftling-signing.keystore` + `signing-key-password.txt` — the signing key
  (NOT committed; see .gitignore). **Back these up.** Losing them means a
  future build can't install over the old app (users would have to uninstall
  first), and Play Store would treat it as a different app entirely.
- The rest is the generated Android project (safe to regenerate any time).

## Rebuilding

Toolchain (already installed on this machine, ~1 GB in `%USERPROFILE%\.bubblewrap`):
Bubblewrap CLI (npm i -g @bubblewrap/cli), JDK 17, Android cmdline-tools with
build-tools 36.1.0 — paths wired up in `%USERPROFILE%\.bubblewrap\config.json`.

From this directory (PowerShell):

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\.bubblewrap\jdk"
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = (Get-Content signing-key-password.txt)
$env:BUBBLEWRAP_KEY_PASSWORD = $env:BUBBLEWRAP_KEYSTORE_PASSWORD
Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue  # this machine sets it; it breaks gradlew resolution
bubblewrap update --skipVersionUpgrade   # after editing twa-manifest.json
bubblewrap build
```

Output: `app-release-signed.apk` (sideload) and `app-release-bundle.aab`
(Play Store upload, same key).

When releasing an update, bump `appVersionCode` (+1) and `appVersionName`
in twa-manifest.json first — Android refuses to install a same-or-lower
versionCode over an existing app.

## Installing on a device (sideload)

1. Copy `app-release-signed.apk` to the device (USB, Drive, email…).
2. Open it; Android will ask to allow installs from that source — allow it.
3. First launch needs the network (it renders the live site).

## The address bar

The app hides Chrome's URL bar only when the site proves it belongs to the
same owner: https://weftling.fabbricerp.com/.well-known/assetlinks.json must be
live and list this app's package name + signing-cert SHA-256. That file is
in the repo at `public/.well-known/assetlinks.json` — once it's deployed,
force-stop and reopen the app and the bar disappears. Until then the app
still works, just with a visible URL bar.

If the signing key is ever regenerated, update the fingerprint in
assetlinks.json (get it via):

```powershell
& "$env:USERPROFILE\.bubblewrap\jdk\bin\keytool" -list -v -keystore weftling-signing.keystore -alias weftling
```

## Play Store later

Upload `app-release-bundle.aab` to a Google Play Console account ($25
one-time). Keep using this same keystore — or better, enroll in Play App
Signing and let Google hold the release key (then assetlinks.json needs
Google's certificate fingerprint added alongside this one).
