$ErrorActionPreference = 'Stop'
Set-Location 'c:\Users\User\axiom'
$results = @()

$commands = @(
  [pscustomobject]@{ Label = '1) npm.cmd run build'; File = 'npm.cmd'; Args = @('run','build') },
  [pscustomobject]@{ Label = '2) node --test test/quality-loop.test.mjs --test-name-pattern "string-trio|serializeQueuedJob"'; File = 'node'; Args = @('--test','test/quality-loop.test.mjs','--test-name-pattern','string-trio|serializeQueuedJob') },
  [pscustomobject]@{ Label = '3) node --test test/multimodel-execution.test.mjs --test-name-pattern "serializeQueuedJob exposes qualityControl history at top level"'; File = 'node'; Args = @('--test','test/multimodel-execution.test.mjs','--test-name-pattern','serializeQueuedJob exposes qualityControl history at top level') },
  [pscustomobject]@{ Label = '4) node --test test/mcp-transport.test.mjs --test-name-pattern "operator summary tool smoke test"'; File = 'node'; Args = @('--test','test/mcp-transport.test.mjs','--test-name-pattern','operator summary tool smoke test') },
  [pscustomobject]@{ Label = '5) node --test test/mcp-bridge-scripts.test.mjs --test-name-pattern "print-operator-summary emits canonical operator summary|project-operator-summary writes latest artifacts and daily history|incident-draft|shared operator pickup"'; File = 'node'; Args = @('--test','test/mcp-bridge-scripts.test.mjs','--test-name-pattern','print-operator-summary emits canonical operator summary|project-operator-summary writes latest artifacts and daily history|incident-draft|shared operator pickup') }
)

for ($i = 0; $i -lt $commands.Count; $i++) {
  $cmd = $commands[$i]
  $outFile = Join-Path $env:TEMP ("axiom-run-{0}.log" -f $i)
  if (Test-Path $outFile) { Remove-Item $outFile -Force }
  & $cmd.File @($cmd.Args) *> $outFile
  $exitCode = $LASTEXITCODE
  $tail = @()
  if ($exitCode -ne 0 -and (Test-Path $outFile)) {
    $tail = Get-Content $outFile -Tail 40
  }
  $results += [pscustomobject]@{
    command = $cmd.Label
    exitCode = $exitCode
    status = if ($exitCode -eq 0) { 'PASS' } else { 'FAIL' }
    failingExcerpt = $tail
  }
}

$results | ConvertTo-Json -Depth 6
