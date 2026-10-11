#!/usr/bin/env bash
# Overnight watchdog: every 10 minutes, relaunch a learning loop (with --resume) if its process is gone or its log
# has been silent for 35 minutes, until the deadline. Logs to data/watchdog.log.
#   bash scripts/watchdog.sh 0730
cd "$(dirname "$0")/.." || exit 1
DEADLINE=${1:-0730}
log() { echo "$(date +%T) $*" >> data/watchdog.log; }
launch() {  # $1 tag, $2 track, $3 fixed build
  powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','scripts\\overnight.ps1','-Track','$2','-Tag','$1','-FixedBuild','$3','-Workers','24','-Gens','16','-Resume' -WindowStyle Minimized -WorkingDirectory '$(pwd -W)'"
}
alive() {  # number of python processes running this tag
  powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | Where-Object { \$_.CommandLine -match 'harness.evolve' -and \$_.CommandLine -match '--tag $1' }).Count" | tr -d '\r'
}
kill_tag() {
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | Where-Object { \$_.CommandLine -match 'harness.evolve' -and \$_.CommandLine -match '--tag $1' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
}
log "watchdog started (deadline $DEADLINE)"
until [ "$(date +%H%M)" -ge "$DEADLINE" ] && [ "$(date +%H)" -lt 12 ]; do
  for spec in "evoA A map" "evoB B none"; do
    set -- $spec
    f="data/evolve_$1.log"
    if tail -c 3000 "$f" | grep -q "##### finished ok"; then continue; fi
    age=$(( $(date +%s) - $(stat -c %Y "$f") ))
    n=$(alive "$1")
    if [ "${n:-0}" -eq 0 ]; then
      log "$1: no process (log silent ${age}s) -> relaunch"; launch "$1" "$2" "$3"
    elif [ "$age" -gt 2100 ]; then
      log "$1: log silent ${age}s with $n process(es) -> kill + relaunch"; kill_tag "$1"; sleep 5; launch "$1" "$2" "$3"
    fi
  done
  sleep 600
done
log "watchdog stopped"
