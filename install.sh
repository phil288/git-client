#!/usr/bin/env bash
# GitClient installer for Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/phil288/git-client/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/phil288/git-client/main/install.sh | bash -s -- --user
#
# Options (flag or environment variable):
#   --user                 Install into ~/.local without sudo (any distro). Default on non-Debian systems.
#   --version vX.Y.Z       Install a specific release (GITCLIENT_VERSION). Default: latest.
#   --uninstall            Remove GitClient (keeps settings unless --purge).
#   --purge                With --uninstall: also delete settings (~/.config/GitClient).
#   --quiet                Only print errors and the final result (GITCLIENT_QUIET=1).
#   --remote               In a repository clone: download a release instead of using dist/.
#   --rebuild              In a repository clone: rebuild the package even if dist/ is up to date.
#   -h, --help             Show this help.
#   GITHUB_TOKEN           Optional token (private forks, higher API rate limit).
#
# Running it again upgrades to the latest (or the pinned) version.
#
# Run from a clone of the repository (bash ./install.sh), it installs the
# locally built package from dist/ instead of downloading, building it first
# when it is missing or older than the sources. --remote forces a download,
# --rebuild forces a build.
#
# The whole script is wrapped in main(), called on the last line, so a
# partially downloaded script never runs halfway.

set -euo pipefail

main() {
  # ---------------------------------------------------------------------------
  # Configuration
  # ---------------------------------------------------------------------------
  # Keep in sync with "repository" in package.json (a unit test checks this).
  local DEFAULT_REPO='phil288/git-client'
  local REPO="${GITCLIENT_REPO:-$DEFAULT_REPO}"
  # Overridable for testing against a local mirror (file:// works too).
  local RELEASES_URL="${GITCLIENT_RELEASES_URL:-https://github.com/${REPO}/releases}"
  local API_URL="${GITCLIENT_API_URL:-https://api.github.com/repos/${REPO}}"

  local APP=gitclient
  local PKG=gitclient
  local USER_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gitclient"
  local BIN_DIR="$HOME/.local/bin"
  local APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  local ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
  local CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/GitClient"
  local APPARMOR_PROFILE=/etc/apparmor.d/gitclient-user

  local mode='' version="${GITCLIENT_VERSION:-}" action=install purge=0 quiet="${GITCLIENT_QUIET:-0}"
  local force_remote=0 rebuild=0
  local token="${GITHUB_TOKEN:-}"

  # ---------------------------------------------------------------------------
  # Output
  # ---------------------------------------------------------------------------
  local c_red='' c_green='' c_yellow='' c_blue='' c_bold='' c_reset=''
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    c_red=$'\033[31m' c_green=$'\033[32m' c_yellow=$'\033[33m' c_blue=$'\033[34m' c_bold=$'\033[1m' c_reset=$'\033[0m'
  fi
  info() { [ "$quiet" = 1 ] || printf '%s==>%s %s\n' "$c_blue" "$c_reset" "$*"; }
  ok() { printf '%s✓%s %s\n' "$c_green" "$c_reset" "$*"; }
  warn() { printf '%s!%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
  die() {
    printf '%s✗ %s%s\n' "$c_red" "$*" "$c_reset" >&2
    exit 1
  }

  usage() {
    cat <<'USAGE'
GitClient installer for Linux

Usage: install.sh [--user] [--version vX.Y.Z] [--uninstall [--purge]] [--quiet]

  --user            Install into ~/.local without sudo (default on non-Debian systems)
  --version TAG     Install a specific release instead of the latest (env: GITCLIENT_VERSION)
  --uninstall       Remove GitClient; settings are kept
  --purge           With --uninstall, also delete settings (~/.config/GitClient)
  --quiet           Only print errors and the result (env: GITCLIENT_QUIET=1)
  --remote          In a repository clone: download a release instead of using the local build
  --rebuild         In a repository clone: rebuild dist/ even if it is up to date

Environment: GITHUB_TOKEN (optional: private forks, higher API rate limit), NO_COLOR.
Running the installer again upgrades GitClient.
Run from a clone of the repository, it installs the local build from dist/ (building it if needed).
USAGE
  }

  # ---------------------------------------------------------------------------
  # Arguments
  # ---------------------------------------------------------------------------
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) mode=user ;;
      --version)
        [ $# -ge 2 ] || die "--version needs a value, e.g. --version v1.2.0"
        version="$2"
        shift
        ;;
      --version=*) version="${1#*=}" ;;
      --uninstall) action=uninstall ;;
      --purge) purge=1 ;;
      --quiet | -q) quiet=1 ;;
      --remote) force_remote=1 ;;
      --rebuild) rebuild=1 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "Unknown option: $1 (see --help)" ;;
    esac
    shift
  done
  if [ -n "$version" ] && [ "${version#v}" = "$version" ]; then version="v$version"; fi
  if [ "$purge" = 1 ] && [ "$action" != uninstall ]; then die "--purge only makes sense with --uninstall"; fi
  if [ "$rebuild" = 1 ] && [ "$force_remote" = 1 ]; then die "--rebuild and --remote cannot be combined"; fi

  # ---------------------------------------------------------------------------
  # Local checkout? (bash ./install.sh inside a clone; never when piped from curl)
  # ---------------------------------------------------------------------------
  local LOCAL_ROOT='' source=remote
  local script_path="${BASH_SOURCE[0]:-}"
  if [ -n "$script_path" ] && [ -f "$script_path" ]; then
    local script_dir
    script_dir=$(cd "$(dirname "$script_path")" && pwd)
    if [ -f "$script_dir/package.json" ] && [ -f "$script_dir/electron-builder.yml" ] &&
      grep -q '"name": *"gitclient"' "$script_dir/package.json"; then
      LOCAL_ROOT="$script_dir"
    fi
  fi
  # A pinned --version only exists as a published release.
  if [ -n "$LOCAL_ROOT" ] && [ "$force_remote" = 0 ] && [ -z "$version" ]; then source=local; fi
  if [ "$rebuild" = 1 ] && [ "$source" != local ]; then die "--rebuild only works when running install.sh from a repository clone (without --version)"; fi

  # ---------------------------------------------------------------------------
  # Platform
  # ---------------------------------------------------------------------------
  [ "$(uname -s)" = Linux ] || die "This installer is for Linux. On Windows use install.ps1: irm https://raw.githubusercontent.com/${REPO}/main/install.ps1 | iex"

  local arch
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "Unsupported architecture: $(uname -m) (supported: x86_64, aarch64)" ;;
  esac

  local is_debian=0
  if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then is_debian=1; fi

  local SUDO=''
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then SUDO=sudo; else SUDO=none; fi
  fi

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------
  # Global on purpose: the EXIT trap runs after main() has returned.
  GITCLIENT_TMP=''
  cleanup() { if [ -n "$GITCLIENT_TMP" ] && [ -d "$GITCLIENT_TMP" ]; then rm -rf "$GITCLIENT_TMP"; fi; }
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  run_root() {
    if [ -z "$SUDO" ]; then "$@"; else sudo "$@"; fi
  }

  require_tools() {
    local missing=() t
    for t in "$@"; do command -v "$t" >/dev/null 2>&1 || missing+=("$t"); done
    if [ ${#missing[@]} -gt 0 ]; then
      die "Missing required tools: ${missing[*]}. Install them first (Debian/Ubuntu: sudo apt install ${missing[*]/sha256sum/coreutils})."
    fi
  }

  check_git() {
    if ! command -v git >/dev/null 2>&1; then
      warn "git is not installed. GitClient needs it: sudo apt install git"
    fi
  }

  curl_get() { # url output
    if [ "$quiet" != 1 ] && [ -t 2 ]; then
      curl -fSL --progress-bar --retry 3 --connect-timeout 15 -o "$2" "$1"
    else
      curl -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"
    fi
  }

  # Private repositories: /releases/latest/download/... does not accept tokens,
  # so resolve the asset through the API and download it with the token.
  asset_api_url() { # tag-or-empty asset-name
    local rel_url json asset_url='' line cur=''
    if [ -n "$1" ]; then rel_url="$API_URL/releases/tags/$1"; else rel_url="$API_URL/releases/latest"; fi
    json=$(curl -fsSL -H "Authorization: Bearer $token" -H 'Accept: application/vnd.github+json' "$rel_url") ||
      die "Could not read the release from the GitHub API (check GITHUB_TOKEN and the version)."
    # Each asset object lists "url" (…/releases/assets/<id>) before its "name".
    while IFS= read -r line; do
      case "$line" in
        '"url"'*/releases/assets/*)
          cur="${line#*: *\"}"
          cur="${cur%\"}"
          ;;
        '"name"'*)
          if [ -n "$cur" ]; then
            local n="${line#*: *\"}"
            n="${n%\"}"
            if [ "$n" = "$2" ]; then
              asset_url="$cur"
              break
            fi
            cur=''
          fi
          ;;
      esac
    done < <(printf '%s' "$json" | grep -oE '"(url|name)": *"[^"]*"')
    [ -n "$asset_url" ] || die "Release has no asset named $2."
    printf '%s' "$asset_url"
  }

  download_asset() { # asset-name output
    if [ -n "$token" ]; then
      local url
      url=$(asset_api_url "$version" "$1")
      curl -fsSL --retry 3 -H "Authorization: Bearer $token" -H 'Accept: application/octet-stream' -o "$2" "$url" ||
        die "Download failed: $1"
    else
      local url
      if [ -n "$version" ]; then url="$RELEASES_URL/download/$version/$1"; else url="$RELEASES_URL/latest/download/$1"; fi
      curl_get "$url" "$2" || die "Download failed: $url
  (Does the release exist and include $1? Linux arm64 builds may not be published for every release.)"
    fi
  }

  verify_checksum() { # dir asset-name
    local sums="$1/SHA256SUMS" expected actual
    download_asset SHA256SUMS "$sums"
    expected=$(awk -v f="$2" '{ n = $2; sub(/^\*/, "", n); if (n == f) { print $1; exit } }' "$sums")
    [ -n "$expected" ] || die "SHA256SUMS has no entry for $2."
    actual=$(sha256sum "$1/$2" | awk '{ print $1 }')
    [ "$expected" = "$actual" ] || die "Checksum mismatch for $2 (expected $expected, got $actual). Aborting."
    info "Checksum verified"
  }

  local_version() {
    local v
    v=$(grep -m1 -oE '"version": *"[^"]*"' "$LOCAL_ROOT/package.json" | sed 's/.*"\([^"]*\)"$/\1/' || true)
    printf 'v%s-local' "${v:-0.0.0}"
  }

  # Builds one package target from the checkout, as the invoking user.
  build_local() { # asset reason
    local target
    case "$1" in
      *.deb) target=deb ;;
      *.tar.gz) target=tar.gz ;;
      *) die "Cannot build $1 locally." ;;
    esac
    if [ "$(id -u)" -eq 0 ]; then
      die "Refusing to build as root (it would leave root-owned files in $LOCAL_ROOT). Run install.sh as your normal user; it asks for sudo only for apt."
    fi
    local overrides=()
    if [ "$arch" = arm64 ]; then overrides=(-c.deb.artifactName=gitclient-linux-arm64.deb); fi
    info "Building $1 from this checkout ($2). This can take a few minutes."
    local log="$GITCLIENT_TMP/build.log"
    (
      cd "$LOCAL_ROOT"
      if [ ! -d node_modules ]; then
        if [ -f package-lock.json ]; then npm ci; else npm install; fi
      fi
      npm run build
      npm exec --no -- electron-builder --linux "$target" "--$arch" --publish never "${overrides[@]}"
    ) >"$log" 2>&1 || {
      tail -n 40 "$log" >&2
      die "Local build failed (full log above: last 40 lines). Fix the build or use --remote."
    }
    if [ "$quiet" != 1 ]; then info "Build finished"; fi
    [ -f "$LOCAL_ROOT/dist/$1" ] || die "The build did not produce dist/$1."
  }

  # Makes sure dist/<asset> exists and is newer than the sources.
  ensure_local_package() { # asset
    local f="$LOCAL_ROOT/dist/$1" reason='' newer=''
    if [ "$rebuild" = 1 ]; then
      reason='--rebuild requested'
    elif [ ! -f "$f" ]; then
      reason="dist/$1 has not been built yet"
    else
      newer=$(find "$LOCAL_ROOT/src" "$LOCAL_ROOT/build" "$LOCAL_ROOT/package.json" "$LOCAL_ROOT/package-lock.json" \
        "$LOCAL_ROOT/electron-builder.yml" "$LOCAL_ROOT/electron.vite.config.ts" -newer "$f" -print -quit 2>/dev/null || true)
      if [ -n "$newer" ]; then reason="sources changed since dist/$1 was built (${newer#"$LOCAL_ROOT"/})"; fi
    fi
    [ -n "$reason" ] || return 0
    if command -v npm >/dev/null 2>&1; then
      build_local "$1" "$reason"
    elif [ -f "$f" ]; then
      warn "$reason, but npm is not available to rebuild; installing the existing dist/$1."
    else
      die "No local package to install ($reason) and npm is not installed. Install Node.js 22.12+ to build it, or use --remote to download a release."
    fi
  }

  # Puts <asset> into <dir>: from the local checkout, or downloaded + verified.
  fetch_package() { # asset dir label
    if [ "$source" = local ]; then
      ensure_local_package "$1"
      cp "$LOCAL_ROOT/dist/$1" "$2/$1"
      info "Using the local build $LOCAL_ROOT/dist/$1 ($3; built from this checkout, no release checksum to verify)"
    else
      info "Downloading $1 ($3)"
      download_asset "$1" "$2/$1"
      verify_checksum "$2" "$1"
    fi
  }

  # Resolves "latest" to a tag without the API: /releases/latest redirects to /releases/tag/<tag>.
  resolve_version() {
    if [ -n "$version" ]; then
      printf '%s' "$version"
    elif [ -n "$token" ]; then
      local tag
      tag=$(curl -fsSL -H "Authorization: Bearer $token" "$API_URL/releases/latest" 2>/dev/null |
        grep -oE '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
      printf '%s' "${tag:-unknown}"
    else
      local final
      final=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$RELEASES_URL/latest" 2>/dev/null || true)
      case "$final" in */tag/*) printf '%s' "${final##*/tag/}" ;; *) printf 'unknown' ;; esac
    fi
  }

  # Ubuntu 23.10+ restricts unprivileged user namespaces via AppArmor, which
  # the Chromium sandbox needs. The .deb ships an AppArmor profile; a --user
  # install cannot, so we detect the problem and print the exact fix.
  sandbox_restricted() {
    local v
    v=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)
    [ "$v" = 1 ] || return 1
    # Already fixed by our profile, or by a setuid chrome-sandbox?
    [ -f "$APPARMOR_PROFILE" ] && return 1
    [ -u "$USER_DIR/chrome-sandbox" ] && return 1
    return 0
  }

  print_sandbox_fix() {
    local exe="$USER_DIR/$APP"
    warn "This system restricts unprivileged user namespaces (Ubuntu 23.10+ AppArmor)."
    warn "Depending on the Ubuntu and Electron versions, the Chromium sandbox may then fail to start."
    warn "If GitClient does not open (sandbox error when run from a terminal), apply one of these fixes:"
    # The \n sequences stay literal here; the user's printf expands them.
    local cmd="printf 'abi <abi/4.0>,\\ninclude <tunables/global>\\nprofile gitclient-user \"$exe\" flags=(unconfined) {\\n  userns,\\n}\\n' | sudo tee $APPARMOR_PROFILE >/dev/null && sudo apparmor_parser -r $APPARMOR_PROFILE"
    printf '\n  Fix (recommended, same approach as the .deb) — allow it with an AppArmor profile:\n\n'
    printf '    %s\n' "$cmd"
    printf '\n  Alternative — make the sandbox helper setuid root:\n\n'
    printf '    sudo chown root:root "%s/chrome-sandbox" && sudo chmod 4755 "%s/chrome-sandbox"\n\n' "$USER_DIR" "$USER_DIR"
    warn "GitClient is never started with --no-sandbox."
  }

  # ---------------------------------------------------------------------------
  # Install: .deb (Debian/Ubuntu)
  # ---------------------------------------------------------------------------
  install_deb() {
    local asset="gitclient-linux-$arch.deb" label
    if [ "$source" = local ]; then require_tools cp; else require_tools curl sha256sum; fi
    GITCLIENT_TMP=$(mktemp -d)
    local tmp="$GITCLIENT_TMP"
    # apt runs as the _apt user when installing a local file; make it readable.
    chmod 755 "$tmp"
    if [ "$source" = local ]; then label=$(local_version); else label="${version:-latest}"; fi
    fetch_package "$asset" "$tmp" "$label"
    chmod 644 "$tmp/$asset"
    if [ -n "$SUDO" ]; then
      info "Installing with apt. sudo is needed to install a system package (/opt/GitClient, the gitclient"
      info "command, the menu entry and the sandbox/AppArmor setup); you may be asked for your password."
    fi
    local apt_args=(install -y)
    if [ "$quiet" = 1 ]; then apt_args+=(-qq); fi
    # DEBIAN_FRONTEND via env(1) so it survives sudo.
    run_root env DEBIAN_FRONTEND=noninteractive apt-get "${apt_args[@]}" "$tmp/$asset" >&2 ||
      die "apt-get failed to install $asset."
    local installed
    installed=$(dpkg-query -W -f='${Version}' "$PKG" 2>/dev/null || echo unknown)
    ok "GitClient $installed installed"
    check_git
    printf '\n  Start it from your applications menu, or run: %sgitclient%s  (or: gitclient /path/to/repo)\n' "$c_bold" "$c_reset"
  }

  # ---------------------------------------------------------------------------
  # Install: --user (tar.gz into ~/.local)
  # ---------------------------------------------------------------------------
  install_user() {
    local asset="gitclient-linux-$arch.tar.gz" resolved
    if [ "$source" = local ]; then require_tools tar; else require_tools curl sha256sum tar; fi
    GITCLIENT_TMP=$(mktemp -d)
    local tmp="$GITCLIENT_TMP"
    if [ "$source" = local ]; then resolved=$(local_version); else resolved=$(resolve_version); fi
    fetch_package "$asset" "$tmp" "$resolved"

    info "Installing into $USER_DIR"
    mkdir -p "$tmp/app" "$(dirname "$USER_DIR")" "$BIN_DIR" "$APPS_DIR" "$ICON_DIR"
    tar -xzf "$tmp/$asset" -C "$tmp/app" --strip-components=1 || die "Could not extract $asset."
    [ -x "$tmp/app/$APP" ] || die "Archive does not contain the $APP executable."
    printf '%s\n' "$resolved" >"$tmp/app/.installed-version"

    # Swap directories so an upgrade never leaves a half-extracted install.
    # A setuid chrome-sandbox from a previous "fix" is preserved.
    local had_setuid=0
    [ -u "$USER_DIR/chrome-sandbox" ] && had_setuid=1
    if [ -d "$USER_DIR" ]; then
      rm -rf "$USER_DIR.old"
      mv "$USER_DIR" "$USER_DIR.old"
    fi
    mv "$tmp/app" "$USER_DIR"
    rm -rf "$USER_DIR.old"
    if [ "$had_setuid" = 1 ]; then warn "The sandbox helper was replaced; re-run the setuid fix below if GitClient fails to start."; fi

    ln -sfn "$USER_DIR/$APP" "$BIN_DIR/$APP"
    if [ -f "$USER_DIR/resources/icon.png" ]; then cp "$USER_DIR/resources/icon.png" "$ICON_DIR/gitclient.png"; fi
    cat >"$APPS_DIR/gitclient.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=GitClient
Comment=Git client with IDE-style Git tooling
Exec="$USER_DIR/$APP" %U
Icon=gitclient
Terminal=false
Categories=Development;RevisionControl;
Keywords=git;vcs;version control;
StartupWMClass=gitclient
EOF
    if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true; fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q "${ICON_DIR%/512x512/apps}" >/dev/null 2>&1 || true; fi

    ok "GitClient $resolved installed in $USER_DIR"
    check_git
    case ":$PATH:" in
      *":$BIN_DIR:"*) ;;
      *) warn "$BIN_DIR is not on your PATH. Add it: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc" ;;
    esac
    if sandbox_restricted; then print_sandbox_fix; fi
    printf '\n  Start it from your applications menu, or run: %sgitclient%s  (or: gitclient /path/to/repo)\n' "$c_bold" "$c_reset"
    printf '  Update later by running this installer again with --user.\n'
  }

  # ---------------------------------------------------------------------------
  # Uninstall
  # ---------------------------------------------------------------------------
  uninstall() {
    local removed=0
    if [ "$is_debian" = 1 ] && dpkg-query -W -f='${Status}' "$PKG" 2>/dev/null | grep -q 'install ok installed'; then
      if [ "$mode" = user ]; then
        info "Note: the system package is installed too; run --uninstall without --user to remove it."
      else
        if [ "$SUDO" = none ]; then die "Removing the system package needs root, and sudo is not available."; fi
        if [ -n "$SUDO" ]; then info "Removing the system package (sudo is needed to remove a system package)"; fi
        local apt_args=(remove -y)
        if [ "$quiet" = 1 ]; then apt_args+=(-qq); fi
        run_root env DEBIAN_FRONTEND=noninteractive apt-get "${apt_args[@]}" "$PKG" >&2
        removed=1
      fi
    fi
    if [ -e "$USER_DIR" ] || [ -L "$BIN_DIR/$APP" ] || [ -f "$APPS_DIR/gitclient.desktop" ]; then
      info "Removing the user install"
      rm -rf "$USER_DIR" "$USER_DIR.old"
      if [ -L "$BIN_DIR/$APP" ]; then rm -f "$BIN_DIR/$APP"; fi
      rm -f "$APPS_DIR/gitclient.desktop" "$ICON_DIR/gitclient.png"
      if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true; fi
      removed=1
      if [ -f "$APPARMOR_PROFILE" ]; then
        warn "An AppArmor profile for the user install exists; remove it with: sudo rm $APPARMOR_PROFILE && sudo systemctl reload apparmor"
      fi
    fi
    if [ "$purge" = 1 ]; then
      if [ -d "$CONFIG_DIR" ]; then
        rm -rf "$CONFIG_DIR"
        ok "Settings removed ($CONFIG_DIR)"
      fi
    elif [ -d "$CONFIG_DIR" ]; then
      info "Settings kept in $CONFIG_DIR (use --uninstall --purge to delete them)"
    fi
    if [ "$removed" = 1 ]; then ok "GitClient uninstalled"; else ok "GitClient is not installed"; fi
  }

  # ---------------------------------------------------------------------------
  # Dispatch
  # ---------------------------------------------------------------------------
  if [ "$action" = uninstall ]; then
    uninstall
    return
  fi

  if [ -z "$mode" ]; then
    if [ "$is_debian" = 0 ]; then
      info "Not a Debian/Ubuntu system (no apt-get): using a user install in ~/.local."
      mode=user
    elif [ "$SUDO" = none ]; then
      info "sudo is not available: using a user install in ~/.local."
      mode=user
    else
      mode=deb
    fi
  fi
  if [ "$mode" = deb ]; then install_deb; else install_user; fi
}

main "$@"
