$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$package = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'package.json') | ConvertFrom-Json
$config = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'src-tauri/tauri.conf.json') | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+$' -or $version -ne $config.version -or $config.productName -ne 'Finance Widget') { throw 'Release metadata is inconsistent.' }
$releaseRoot = Join-Path $repoRoot 'src-tauri/target/release'
$binary = Get-Item -LiteralPath (Join-Path $releaseRoot 'finance-widget.exe')
if ($binary.VersionInfo.ProductVersion -ne $version) { throw 'Build the current native version before staging.' }
$filename = "Finance Widget_${version}_x64-setup.exe"
$installer = Get-Item -LiteralPath (Join-Path $releaseRoot "bundle/nsis/$filename")
# Tauri finalizes bundle metadata on the executable immediately after NSIS exits.
# Allow only that short finalization/filesystem timestamp margin, not a prior build.
if ($installer.LastWriteTimeUtc.AddSeconds(2) -lt $binary.LastWriteTimeUtc) { throw 'Installer is older than the application binary. Rebuild before staging.' }
$output = Join-Path $repoRoot "src-tauri/target/release-candidate/$version"
New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $output $filename) -Force
$stream = [IO.File]::OpenRead((Join-Path $output $filename))
$sha256 = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $sha256.Dispose() }
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'), "$hash  $filename`n", [Text.UTF8Encoding]::new($false))
Write-Output "Staged Finance Widget $version and fresh SHA-256 checksum. No release published."
Write-Output $output
