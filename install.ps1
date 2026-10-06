# GitClient installer for Windows (Windows PowerShell 5.1 and PowerShell 7).
#
#   irm https://raw.githubusercontent.com/phil288/git-client/main/install.ps1 | iex
#
# "irm | iex" cannot pass parameters, so every option also has an environment
# variable (set it in the same PowerShell session first):
#
#   $env:GITCLIENT_VERSION = 'v1.2.0'   Install that release instead of the latest   (-Version v1.2.0)
#   $env:GITCLIENT_UNINSTALL = '1'      Remove GitClient; settings are kept          (-Uninstall)
#   $env:GITCLIENT_QUIET = '1'          Only print errors and the final result       (-Quiet)
#   $env:GITHUB_TOKEN = '...'           Optional token (private forks, higher API rate limit)
#   $env:GITCLIENT_REPO / $env:GITCLIENT_RELEASES_URL / $env:GITCLIENT_API_URL
#                                       Point at another repository or a mirror (file:// works)
#   $env:NO_COLOR = '1'                 Plain output
#
# Saved to a file, it takes parameters instead:
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Version v1.2.0
#   .\install.ps1 -Uninstall -Quiet
#
# Running it again upgrades to the latest (or the pinned) version.
#
# Everything lives in Install-GitClient, called on the last line, so a
# partially downloaded script never runs halfway. The script is ASCII-only on
# purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.

param(
    [string]$Version = '',
    [switch]$Uninstall,
    [switch]$Quiet,
    [switch]$Help
)

function Install-GitClient {
    param(
        [string]$Version = '',
        [switch]$Uninstall,
        [switch]$Quiet,
        [switch]$Help,
        # Set when run as a script file: failures then end with exit code 1.
        # Under "irm | iex", exit would close the user's PowerShell window.
        [switch]$ExitOnError
    )

    Set-StrictMode -Off
    $ErrorActionPreference = 'Stop'
    # Invoke-WebRequest's progress bar makes downloads many times slower on 5.1.
    $ProgressPreference = 'SilentlyContinue'

    # -------------------------------------------------------------------------
    # Configuration
    # -------------------------------------------------------------------------
    # Keep in sync with "repository" in package.json (a unit test checks this).
    $DefaultRepo = 'phil288/git-client'
    $Repo = $DefaultRepo
    if ($env:GITCLIENT_REPO) { $Repo = $env:GITCLIENT_REPO }
    # Overridable for testing against a local mirror (file:// works too).
    $ReleasesUrl = "https://github.com/$Repo/releases"
    if ($env:GITCLIENT_RELEASES_URL) { $ReleasesUrl = $env:GITCLIENT_RELEASES_URL.TrimEnd('/') }
    $ApiUrl = "https://api.github.com/repos/$Repo"
    if ($env:GITCLIENT_API_URL) { $ApiUrl = $env:GITCLIENT_API_URL.TrimEnd('/') }

    $Asset = 'gitclient-windows-x64-setup.exe'
    $UninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    $ConfigDir = Join-Path $env:APPDATA 'GitClient'
    $UserAgent = 'gitclient-installer'

    if (-not $Version -and $env:GITCLIENT_VERSION) { $Version = $env:GITCLIENT_VERSION }
    if ($env:GITCLIENT_UNINSTALL -eq '1') { $Uninstall = $true }
    if ($env:GITCLIENT_QUIET -eq '1') { $Quiet = $true }
    $Token = $env:GITHUB_TOKEN
    if ($Version -and -not $Version.StartsWith('v')) { $Version = "v$Version" }

    # -------------------------------------------------------------------------
    # Output
    # -------------------------------------------------------------------------
    $UseColor = -not $env:NO_COLOR
    function Write-Tagged([string]$Tag, [string]$Color, [string]$Message) {
        if ($UseColor) { Write-Host $Tag -ForegroundColor $Color -NoNewline } else { Write-Host $Tag -NoNewline }
        Write-Host " $Message"
    }
    function Write-Info([string]$Message) { if (-not $Quiet) { Write-Tagged '==>' 'Cyan' $Message } }
    function Write-Ok([string]$Message) { Write-Tagged 'OK' 'Green' $Message }
    function Write-Warn([string]$Message) { Write-Tagged '!' 'Yellow' $Message }
    function Write-Fail([string]$Message) { Write-Tagged 'ERROR' 'Red' $Message }

    if ($Help) {
        Write-Host @'
GitClient installer for Windows

Usage: install.ps1 [-Version vX.Y.Z] [-Uninstall] [-Quiet]

  -Version TAG   Install a specific release instead of the latest (env: GITCLIENT_VERSION)
  -Uninstall     Remove GitClient; settings in %APPDATA%\GitClient are kept (env: GITCLIENT_UNINSTALL=1)
  -Quiet         Only print errors and the result (env: GITCLIENT_QUIET=1)

Environment: GITHUB_TOKEN (optional: private forks, higher API rate limit), NO_COLOR.
Running the installer again upgrades GitClient.
'@
        return
    }

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------
    function Get-InstallEntry {
        # electron-builder writes a per-user uninstall key; DisplayName is "GitClient <version>".
        $keys = Get-ChildItem -Path $UninstallRoot -ErrorAction SilentlyContinue
        foreach ($key in $keys) {
            $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
            if ($props -and $props.DisplayName -and ($props.DisplayName -like 'GitClient*')) { return $props }
        }
        return $null
    }

    # Splits '"C:\path\Uninstall GitClient.exe" /currentuser' into exe + arguments.
    function Split-CommandLine([string]$CommandLine) {
        if ($CommandLine -match '^\s*"([^"]+)"\s*(.*)$') {
            return @($Matches[1], $Matches[2])
        }
        $exeEnd = $CommandLine.ToLowerInvariant().IndexOf('.exe')
        if ($exeEnd -ge 0) {
            return @($CommandLine.Substring(0, $exeEnd + 4).Trim(), $CommandLine.Substring($exeEnd + 4).Trim())
        }
        return @($CommandLine.Trim(), '')
    }

    function Invoke-Download([string]$Url, [string]$OutFile, [hashtable]$Headers) {
        if ($Url.StartsWith('file:')) {
            Copy-Item -LiteralPath ([Uri]$Url).LocalPath -Destination $OutFile -Force
            return
        }
        if (-not $Headers) { $Headers = @{} }
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers $Headers -UserAgent $UserAgent -UseBasicParsing
    }

    # Private repositories: /releases/latest/download/... does not accept tokens,
    # so resolve the asset through the API and download it with the token.
    function Get-AssetApiUrl([string]$Name) {
        if ($Version) { $relUrl = "$ApiUrl/releases/tags/$Version" } else { $relUrl = "$ApiUrl/releases/latest" }
        $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json' }
        try {
            $release = Invoke-RestMethod -Uri $relUrl -Headers $headers -UserAgent $UserAgent -UseBasicParsing
        } catch {
            throw "Could not read the release from the GitHub API (check GITHUB_TOKEN and the version): $($_.Exception.Message)"
        }
        $match = $release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
        if (-not $match) { throw "Release $($release.tag_name) has no asset named $Name." }
        return $match.url
    }

    function Get-ReleaseAsset([string]$Name, [string]$OutFile) {
        if ($Token) {
            $url = Get-AssetApiUrl $Name
            try {
                # The API redirects to a signed download URL; both PowerShell
                # editions drop the Authorization header on that redirect.
                Invoke-Download $url $OutFile @{ Authorization = "Bearer $Token"; Accept = 'application/octet-stream' }
            } catch {
                throw "Download failed: $Name ($($_.Exception.Message))"
            }
        } else {
            if ($Version) { $url = "$ReleasesUrl/download/$Version/$Name" } else { $url = "$ReleasesUrl/latest/download/$Name" }
            try {
                Invoke-Download $url $OutFile $null
            } catch {
                throw "Download failed: $url`n  (Does the release exist and include $Name?) $($_.Exception.Message)"
            }
        }
    }

    function Test-Checksum([string]$Dir, [string]$Name) {
        $sums = Join-Path $Dir 'SHA256SUMS'
        Get-ReleaseAsset 'SHA256SUMS' $sums
        $expected = $null
        foreach ($line in Get-Content -LiteralPath $sums) {
            $parts = $line.Trim() -split '\s+', 2
            if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $Name) {
                $expected = $parts[0].ToLowerInvariant()
                break
            }
        }
        if (-not $expected) { throw "SHA256SUMS has no entry for $Name." }
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Dir $Name)).Hash.ToLowerInvariant()
        if ($expected -ne $actual) { throw "Checksum mismatch for $Name (expected $expected, got $actual). Aborting." }
        Write-Info 'Checksum verified'
    }

    function Test-GitInstalled {
        if (Get-Command git -ErrorAction SilentlyContinue) { return }
        $candidates = @(
            (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
        )
        if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe') }
        foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return } }
        Write-Warn 'Git for Windows is not installed. GitClient needs it: winget install --id Git.Git -e'
    }

    # Runs an installer/uninstaller and waits. Start-Process -Wait also waits
    # for child processes (the NSIS uninstaller re-launches itself from %TEMP%).
    function Invoke-Setup([string]$Exe, [string]$Arguments) {
        $proc = Start-Process -FilePath $Exe -ArgumentList $Arguments -Wait -PassThru
        return $proc.ExitCode
    }

    # -------------------------------------------------------------------------
    # Install
    # -------------------------------------------------------------------------
    function Install-Release {
        $label = 'latest'
        if ($Version) { $label = $Version }
        $before = Get-InstallEntry
        if (Get-Process -Name 'gitclient' -ErrorAction SilentlyContinue) {
            Write-Warn 'GitClient is running; the installer will close it.'
        }

        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('gitclient-install-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmp | Out-Null
        try {
            Write-Info "Downloading $Asset ($label)"
            $setup = Join-Path $tmp $Asset
            Get-ReleaseAsset $Asset $setup
            Test-Checksum $tmp $Asset

            Write-Info 'Running the installer (per-user, no administrator rights needed)'
            $code = Invoke-Setup $setup '/S'
            if ($code -ne 0) { throw "The installer failed with exit code $code." }
        } finally {
            Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        }

        $after = Get-InstallEntry
        if (-not $after) { throw 'The installer finished, but GitClient is not registered as installed.' }
        $installed = $after.DisplayVersion
        if (-not $installed) { $installed = 'unknown' }
        if ($before -and $before.DisplayVersion -and $before.DisplayVersion -ne $installed) {
            Write-Ok "GitClient $installed installed (upgraded from $($before.DisplayVersion))"
        } else {
            Write-Ok "GitClient $installed installed"
        }
        Test-GitInstalled
        Write-Host ''
        Write-Host '  Start it from the Start menu (GitClient), or run ' -NoNewline
        if ($UseColor) { Write-Host 'gitclient' -ForegroundColor White -NoNewline } else { Write-Host 'gitclient' -NoNewline }
        Write-Host ' in a NEW terminal (or: gitclient C:\path\to\repo).'
        Write-Host '  The PATH change only reaches terminals opened after the install.'
        Write-Host '  Explorer: right-click a folder > Open in GitClient (Windows 11: Show more options).'
        Write-Host '  Update later by running this installer again.'
    }

    # -------------------------------------------------------------------------
    # Uninstall
    # -------------------------------------------------------------------------
    function Uninstall-Release {
        $entry = Get-InstallEntry
        if (-not $entry) {
            Write-Ok 'GitClient is not installed'
        } else {
            $commandLine = $entry.QuietUninstallString
            if (-not $commandLine) { $commandLine = $entry.UninstallString }
            if (-not $commandLine) { throw 'GitClient is registered, but has no uninstall command. Remove it from Settings > Apps.' }
            $parts = Split-CommandLine $commandLine
            $exe = $parts[0]
            $arguments = $parts[1]
            if (-not (Test-Path -LiteralPath $exe)) { throw "Uninstaller not found: $exe. Remove GitClient from Settings > Apps." }
            if ($arguments -notmatch '(^|\s)/currentuser(\s|$)') { $arguments = "$arguments /currentuser" }
            if ($arguments -notmatch '(^|\s)/S(\s|$)') { $arguments = "$arguments /S" }

            Write-Info "Removing GitClient $($entry.DisplayVersion)"
            $code = Invoke-Setup $exe $arguments.Trim()
            if ($code -ne 0) { throw "The uninstaller failed with exit code $code." }
            # Belt and braces: give a detached uninstaller copy time to finish.
            $deadline = (Get-Date).AddSeconds(60)
            while ((Get-InstallEntry) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 500 }
            if (Get-InstallEntry) { throw 'The uninstaller did not remove GitClient. Remove it from Settings > Apps.' }
            Write-Ok 'GitClient uninstalled'
        }
        if (Test-Path -LiteralPath $ConfigDir) {
            Write-Info "Settings kept in $ConfigDir (delete that folder to remove them)"
        }
    }

    # -------------------------------------------------------------------------
    # Dispatch
    # -------------------------------------------------------------------------
    try {
        if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) {
            throw "This installer is for Windows. On Linux use install.sh: curl -fsSL https://raw.githubusercontent.com/$Repo/main/install.sh | bash"
        }
        if (-not [Environment]::Is64BitOperatingSystem) {
            throw 'GitClient needs 64-bit Windows 10 or 11.'
        }
        if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
            Write-Warn 'Windows on ARM: installing the x64 build, which runs under emulation.'
        }
        # Windows PowerShell 5.1 may default to TLS 1.0/1.1, which GitHub rejects.
        if ($PSVersionTable.PSVersion.Major -lt 6) {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        }

        if ($Uninstall) { Uninstall-Release } else { Install-Release }
    } catch {
        Write-Fail $_.Exception.Message
        $global:LASTEXITCODE = 1
        if ($ExitOnError) { exit 1 }
    }
}

# $PSCommandPath is only set when run as a file (not under "irm | iex");
# Get-Variable keeps this safe if the caller's session uses Set-StrictMode.
Install-GitClient -Version $Version -Uninstall:$Uninstall -Quiet:$Quiet -Help:$Help -ExitOnError:([bool](Get-Variable -Name PSCommandPath -ValueOnly -ErrorAction SilentlyContinue))
