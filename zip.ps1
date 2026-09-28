param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination, [Parameter(Mandatory=$true)][string]$Report)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = (Resolve-Path -LiteralPath $Source).Path
$archive = [System.IO.Compression.ZipFile]::Open($Destination, 'Create')
try {
    Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
        $entryName = $_.FullName.Substring($root.Length + 1).Replace([char]92, [char]47)
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName) | Out-Null
    }
} finally { $archive.Dispose() }
$archive = [System.IO.Compression.ZipFile]::OpenRead($Destination)
try {
    $entries = @(foreach ($entry in $archive.Entries) {
        $stream = $entry.Open()
        $hash = [System.Security.Cryptography.SHA256]::Create()
        try {
            [pscustomobject]@{ path = $entry.FullName; size = $entry.Length; sha256 = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        } finally { $stream.Dispose(); $hash.Dispose() }
    })
    ConvertTo-Json -InputObject $entries -Depth 4 | Set-Content -LiteralPath $Report -Encoding UTF8
} finally { $archive.Dispose() }
