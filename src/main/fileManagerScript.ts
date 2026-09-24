/**
 * Nautilus / Nemo "Open in GitClient" script. The file manager passes the
 * selection in <FM>_SCRIPT_SELECTED_FILE_PATHS (newline-separated) and the
 * current folder as a file:// URI in <FM>_SCRIPT_CURRENT_URI (percent-encoded).
 */
const AWK_DECODE =
  'function hex(h,  i, n) { n = 0; h = toupper(h); for (i = 1; i <= 2; i++) n = n * 16 + index("0123456789ABCDEF", substr(h, i, 1)) - 1; return n } ' +
  '{ s = $0; out = ""; while (match(s, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { out = out substr(s, 1, RSTART - 1) sprintf("%c", hex(substr(s, RSTART + 1, 2))); s = substr(s, RSTART + 3) } printf "%s", out s }'

export function fileManagerScript(fm: 'nautilus' | 'nemo', exe: string): string {
  const up = fm.toUpperCase()
  const q = `'${exe.replace(/'/g, `'\\''`)}'`
  return [
    '#!/bin/sh',
    '# Installed by GitClient (Settings > Integration). Opens the selected folder,',
    '# or the folder being viewed, in GitClient.',
    `target=$(printf '%s\\n' "$${up}_SCRIPT_SELECTED_FILE_PATHS" | head -n 1)`,
    'if [ -z "$target" ]; then',
    `  uri="$${up}_SCRIPT_CURRENT_URI"`,
    '  case "$uri" in',
    // Percent-decode with POSIX awk (dash's printf %b has no \\x escapes); LC_ALL=C keeps bytes as bytes.
    `    file://*) target=$(printf '%s' "\${uri#file://}" | LC_ALL=C awk '${AWK_DECODE}') ;;`,
    '  esac',
    'fi',
    '[ -n "$target" ] || exit 0',
    `exec ${q} "$target"`,
    ''
  ].join('\n')
}
