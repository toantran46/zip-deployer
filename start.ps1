$ErrorActionPreference = 'Stop'
try {
    $instanceFile = Join-Path $PSScriptRoot 'runtime\instance.json'
    if (Test-Path -LiteralPath $instanceFile) {
        try {
            $previous = Get-Content -LiteralPath $instanceFile -Raw | ConvertFrom-Json
            if ($previous.url -match '^http://127\.0\.0\.1:\d+$') {
                $health = Invoke-RestMethod -Uri ($previous.url + '/health') -TimeoutSec 2
                if ($health.app -eq 'zip-deployer' -and $health.instance -eq $previous.instance) {
                    $open = New-Object System.Diagnostics.ProcessStartInfo
                    $open.FileName = 'rundll32.exe'
                    $open.Arguments = 'url.dll,FileProtocolHandler ' + $previous.url
                    $open.UseShellExecute = $false
                    $open.CreateNoWindow = $true
                    [System.Diagnostics.Process]::Start($open) | Out-Null
                    exit 0
                }
            }
        } catch { }
    }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $runtime = Join-Path $PSScriptRoot 'runtime'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $server = Join-Path $PSScriptRoot 'server.js'
    # Inherit the native process environment without rebuilding its Path/PATH keys.
    $launch = New-Object System.Diagnostics.ProcessStartInfo
    $launch.FileName = $node
    $launch.Arguments = '"' + $server + '" --open'
    $launch.WorkingDirectory = $PSScriptRoot
    $launch.UseShellExecute = $false
    $launch.CreateNoWindow = $true
    $launch.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $process = [System.Diagnostics.Process]::Start($launch)
    if ($process.WaitForExit(1500)) { throw 'Server exited during startup. Run node server.js to inspect the error.' }
} catch {
    Write-Host ('Cannot start Zip Deployer: ' + $_.Exception.Message)
    Write-Host 'Requires Node.js, Git and Windows PowerShell on PATH.'
    exit 1
}
