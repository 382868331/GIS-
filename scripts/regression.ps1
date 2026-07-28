param(
    [switch]$Live,
    [string]$Sample = "$PSScriptRoot\..\NEONDSSampleLiDARPointCloud.las"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot\..").Path

Write-Host "Running backend unit tests..."
Push-Location "$Root\api"
try {
    & "$Root\api\.venv\Scripts\python.exe" -m pytest
    if ($LASTEXITCODE -ne 0) {
        throw "Backend unit tests failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

Write-Host "Building and linting frontend..."
Push-Location "$Root\web"
try {
    npx --yes pnpm@11 build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE."
    }
    npx --yes pnpm@11 lint
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend lint failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

if ($Live) {
    Write-Host "Running live resumable-upload regression..."
    & "$Root\api\.venv\Scripts\python.exe" "$Root\scripts\run_regression.py" --sample $Sample
    if ($LASTEXITCODE -ne 0) {
        throw "Live regression failed with exit code $LASTEXITCODE."
    }
}

Write-Host "Regression suite passed."
