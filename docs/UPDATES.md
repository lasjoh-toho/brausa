# Automatic updates

brausa uses the Tauri updater. Installed copies read

    https://github.com/lasjoh-toho/brausa/releases/latest/download/latest.json

shortly after starting (unless switched off in the settings) and offer to install a newer version.
Every update must be signed with brausa's private key; the matching public key is in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). An update with any other signature is refused.

## What the release workflow does

`.github/workflows/ci.yml`, job `bundle`:

- If the repository secret `TAURI_SIGNING_PRIVATE_KEY` is set, it builds with
  `--config src-tauri/tauri.updater.conf.json` (`createUpdaterArtifacts`), which signs the update files:
  `brausa.app.tar.gz` (macOS), `brausa_<v>_x64-setup.exe` (Windows), `brausa_<v>_amd64.AppImage` (Linux),
  each with a `.sig` next to it. These are attached to the release.
- Without the secret it builds the installers as before, without update files (a warning shows in the log).

Job `updater` then writes `latest.json` from the `.sig` files (`scripts/latest-json.mjs`) and attaches it.

Releases are published as full releases (not pre-releases), because `releases/latest` skips pre-releases.

## Secrets

| Secret | Content |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the whole content of the private key file (one line, starts with `dW50cnVzdGVk…`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key's password |

Set them under *Settings → Secrets and variables → Actions → New repository secret*.

Keep a backup of the private key and its password outside GitHub. If the key is lost, installed copies can no
longer be updated automatically: a new key pair needs a new public key in the app, and everybody has to install
that version once by hand.

## Platforms

- macOS and Windows (setup.exe) update themselves. The MSI is not used for updates.
- Linux: the AppImage updates itself. Installations from the `.deb` package cannot; brausa then offers the
  download page.
