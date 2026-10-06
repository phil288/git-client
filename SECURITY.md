# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please report privately through GitHub:
[Security → Report a vulnerability](https://github.com/phil288/git-client/security/advisories/new).
Do not open a public issue for security problems.

Include the affected version, platform, a description of the impact and steps to reproduce.
You should get an acknowledgement within a week.

## Scope

In scope: anything that lets a repository, remote, file name, commit message or other git data
execute code or read files outside what the user asked for, escape the renderer sandbox, bypass the
IPC allowlists, or tamper with the installers and update check (`install.sh`, `install.ps1`,
release checksums).
