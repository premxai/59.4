# Overnight learning run for one track, relaunched with --resume if the process dies.
#   powershell -ExecutionPolicy Bypass -File scripts\overnight.ps1 -Track A -Tag evoA -FixedBuild map
#   powershell -ExecutionPolicy Bypass -File scripts\overnight.ps1 -Track B -Tag evoB
param(
    [string]$Track = "B",
    [string]$Tag = "evoB",
    [string]$FixedBuild = "none",
    [int]$Workers = 16,
    [string]$TrainSeeds = "0,1",
    [string]$HeldSeeds = "0,1,2",
    [int]$HeldEvery = 2,
    [int]$DeepEvery = 2,
    [string]$Deadline = "07:30",
    [int]$Gens = 12,
    [string]$RedteamNight = "",
    [switch]$Resume
)
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:FOUR37_LOCAL_STORE = "1"
$env:PYTHONIOENCODING = "utf-8"
$log = "data\evolve_$Tag.log"
for ($i = 0; $i -lt 6; $i++) {
    $a = @("-u", "-m", "harness.evolve", "--track", $Track, "--tag", $Tag, "--gens", "$Gens", "--workers", "$Workers",
           "--train-seeds", $TrainSeeds, "--held-seeds", $HeldSeeds, "--held-every", "$HeldEvery",
           "--deep-every", "$DeepEvery", "--deadline", $Deadline, "--night0", "--fixed-build", $FixedBuild)
    if ($RedteamNight -ne "") { $a += @("--redteam-night", $RedteamNight) }
    if ($i -gt 0 -or $Resume) { $a += "--resume" }
    Add-Content $log "`n##### launch $i at $(Get-Date -Format s)" -Encoding UTF8
    # cmd does the redirection so the log stays UTF-8 (PowerShell 5.1 redirection writes UTF-16)
    cmd /c ".venv\Scripts\python.exe $($a -join ' ') >> $log 2>&1"
    if ($LASTEXITCODE -eq 0) { Add-Content $log "##### finished ok at $(Get-Date -Format s)" -Encoding UTF8; exit 0 }
    Start-Sleep -Seconds 20
}
Add-Content $log "##### gave up at $(Get-Date -Format s) (the watchdog will relaunch)" -Encoding UTF8
