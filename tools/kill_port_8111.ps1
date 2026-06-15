# Kill whatever process is listening on port 8111 (server cleanup).
$conns = Get-NetTCPConnection -LocalPort 8111 -State Listen -ErrorAction SilentlyContinue
if ($null -eq $conns) {
  Write-Output "no listener on 8111"
  return
}
$pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $pids) {
  try {
    Stop-Process -Id $procId -Force -ErrorAction Stop
    Write-Output "killed PID $procId"
  } catch {
    Write-Output "failed to kill PID $procId"
  }
}
