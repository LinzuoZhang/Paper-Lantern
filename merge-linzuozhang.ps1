$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repo

function Stop-WithMessage([string]$message) {
    Write-Host ""
    Write-Host $message -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $repo ".git"))) {
        Stop-WithMessage "This script must stay in the Paper-Lantern repository."
    }

    $changes = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Unable to read Git status." }
    if ($changes.Count -gt 0) {
        Write-Host "Uncommitted changes were found:" -ForegroundColor Yellow
        $changes | ForEach-Object { Write-Host $_ }
        Stop-WithMessage "Commit or stash these changes before merging upstream."
    }

    $remoteUrl = "https://github.com/LinzuoZhang/Paper-Lantern.git"
    $existingRemote = git remote get-url linzuozhang 2>$null
    if ($LASTEXITCODE -ne 0) {
        git remote add linzuozhang $remoteUrl
    } elseif ($existingRemote.Trim() -ne $remoteUrl) {
        git remote set-url linzuozhang $remoteUrl
    }
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Unable to configure the linzuozhang remote." }

    Write-Host "Fetching the latest LinzuoZhang/Paper-Lantern..." -ForegroundColor Cyan
    git -c http.sslBackend=openssl fetch linzuozhang --prune
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Fetch failed. Check the network connection and try again." }

    $branch = (git branch --show-current).Trim()
    if (-not $branch) { Stop-WithMessage "Please switch to the branch that should receive the upstream changes." }
    Write-Host "Merging linzuozhang/main into $branch..." -ForegroundColor Cyan
    git merge --no-edit linzuozhang/main
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Git stopped because conflicts require a manual decision:" -ForegroundColor Yellow
        git diff --name-only --diff-filter=U
        Stop-WithMessage "Resolve the listed files, then commit the merge. No files were discarded."
    }

    Write-Host ""
    Write-Host "Upstream merge completed. Review and test before pushing." -ForegroundColor Green
    Read-Host "Press Enter to close"
} catch {
    Stop-WithMessage $_.Exception.Message
}
