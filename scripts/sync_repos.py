#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Continuous & On-Demand Synchronization Script for Market HFT OS and ADRs.
Syncs changes with GitHub using the designated Personal Access Token (PAT).
"""

import os
import sys
import time
import argparse
import datetime
import subprocess
import signal

TOKEN_FILE = r"D:\Market HFT OS\GithubPersonalAccessTokenFORAG.env"

REPOSITORIES = [
    {
        "name": "Market-HFT-OS",
        "path": r"D:\Market HFT OS",
        "remote_repo": "Shrom-Main/Market-HFT-OS.git",
        "branch": "main",
    },
    {
        "name": "ADRs",
        "path": r"D:\ADRs",
        "remote_repo": "Shrom-Main/ADRs.git",
        "branch": "main",
    },
]

FORBIDDEN_FILES = [
    "GithubPersonalAccessTokenFORAG.env",
    "Alpaca_Key.env",
    "Alpaca_Secret.env",
    "Eulerpool.env",
    "Groq_Key.env",
    "TinyFish.env",
]


def load_pat(token_path=TOKEN_FILE) -> str:
    """Load and parse PAT safely from token file."""
    if not os.path.exists(token_path):
        raise FileNotFoundError(f"PAT token file not found at: {token_path}")
    with open(token_path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    if "=" in content:
        content = content.split("=", 1)[1].strip()
    token = content.strip("\"'")
    if not token:
        raise ValueError(f"Empty token found in: {token_path}")
    return token


def redact(text: str, token: str) -> str:
    """Ensure token is never displayed in any log or output."""
    if not token or not text:
        return text
    return text.replace(token, "[REDACTED_PAT]")


def run_git(args: list[str], cwd: str, token: str, timeout: int = 30) -> tuple[int, str, str]:
    """Execute git command safely, redacting token from output."""
    try:
        proc = subprocess.run(
            ["git", "-C", cwd] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        stdout = redact(proc.stdout.strip(), token)
        stderr = redact(proc.stderr.strip(), token)
        return proc.returncode, stdout, stderr
    except Exception as e:
        safe_err = redact(str(e), token)
        return 1, "", safe_err


def get_changed_files(repo_path: str, token: str) -> list[str]:
    """Return list of modified, added, or untracked non-ignored files."""
    code, stdout, _ = run_git(["status", "--porcelain"], repo_path, token)
    if code != 0 or not stdout:
        return []
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    changed = []
    for line in lines:
        # e.g., ' M src/foo.ts' or '?? newfile.md'
        parts = line.split(maxsplit=1)
        if len(parts) == 2:
            changed.append(parts[1])
    return changed


def has_unpushed_commits(repo_path: str, token: str) -> bool:
    """Check if local branch has commits not yet pushed to origin/main."""
    # Check if origin/main ref exists
    code, stdout, _ = run_git(["rev-parse", "--verify", "origin/main"], repo_path, token)
    if code != 0:
        # If no origin/main, assume we might need to push
        return True
    # Compare local HEAD with origin/main
    code, stdout, _ = run_git(["log", "origin/main..HEAD", "--oneline"], repo_path, token)
    return code == 0 and bool(stdout.strip())


def sync_repository(repo: dict, token: str, push_only: bool = False, force: bool = False) -> bool:
    """Synchronize a repository with GitHub using the PAT."""
    repo_name = repo["name"]
    repo_path = repo["path"]
    remote_repo = repo["remote_repo"]
    branch = repo["branch"]
    authenticated_remote = f"https://{token}@github.com/{remote_repo}"

    if not os.path.exists(repo_path):
        print(f"[{datetime.datetime.now().isoformat()}] [{repo_name}] Path does not exist: {repo_path}")
        return False

    changed_files = get_changed_files(repo_path, token)
    needs_commit = len(changed_files) > 0 and not push_only
    needs_push = has_unpushed_commits(repo_path, token)

    if not needs_commit and not needs_push and not force:
        return True

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1. Commit changes if working tree dirty
    if needs_commit:
        print(f"[{now_str}] [{repo_name}] Detected {len(changed_files)} changed files: {', '.join(changed_files[:5])}{'...' if len(changed_files) > 5 else ''}")

        # Safety: stage all non-ignored files
        run_git(["add", "-A"], repo_path, token)

        # Fail-safe: ensure no secrets are staged
        for forbidden in FORBIDDEN_FILES:
            run_git(["reset", "HEAD", forbidden], repo_path, token)
        run_git(["reset", "HEAD", "*.env"], repo_path, token)

        summary_files = ", ".join(os.path.basename(f) for f in changed_files[:3])
        if len(changed_files) > 3:
            summary_files += f" and {len(changed_files) - 3} others"
        commit_msg = f"chore(sync): automated sync of {summary_files} [{now_str}]"

        code, stdout, stderr = run_git(["commit", "-m", commit_msg], repo_path, token)
        if code != 0:
            if "nothing to commit" in (stdout + stderr):
                pass
            else:
                print(f"[{now_str}] [{repo_name}] Commit failed: {stderr or stdout}")
                return False
        else:
            print(f"[{now_str}] [{repo_name}] Committed: {commit_msg}")
        needs_push = True

    # 2. Push to GitHub using PAT
    if needs_push or force:
        print(f"[{now_str}] [{repo_name}] Pushing to https://github.com/{remote_repo} ({branch})...")
        push_args = ["push", authenticated_remote, f"HEAD:refs/heads/{branch}"]
        code, stdout, stderr = run_git(push_args, repo_path, token, timeout=60)
        if code != 0:
            print(f"[{now_str}] [{repo_name}] Git push failed:\nStdout: {stdout}\nStderr: {stderr}")
            return False
        print(f"[{now_str}] [{repo_name}] Successfully synced and pushed to GitHub!")

        # Update local tracking ref so git status remains clean
        run_git(["fetch", authenticated_remote, f"{branch}:refs/remotes/origin/{branch}"], repo_path, token, timeout=30)

    return True


def run_sync_all(push_only: bool = False, force: bool = False, target_repo: str = None) -> bool:
    """Run synchronization across configured repositories."""
    token = load_pat()
    success = True
    for repo in REPOSITORIES:
        if target_repo and repo["name"].lower() != target_repo.lower() and repo["path"].lower() != target_repo.lower():
            continue
        try:
            ok = sync_repository(repo, token, push_only=push_only, force=force)
            if not ok:
                success = False
        except Exception as e:
            print(f"[{datetime.datetime.now().isoformat()}] [{repo['name']}] Error during sync: {redact(str(e), token)}")
            success = False
    return success


def daemon_loop(interval: float = 3.0, debounce: float = 2.0, target_repo: str = None):
    """Continuously monitor and sync repositories when file changes occur."""
    token = load_pat()
    print("=" * 65)
    print(f"  Market HFT OS & ADRs Continuous Git Synchronization Daemon")
    print(f"  Monitoring: {', '.join(r['name'] for r in REPOSITORIES)}")
    print(f"  Poll interval: {interval}s | Debounce: {debounce}s")
    print(f"  Started at: {datetime.datetime.now().isoformat()}")
    print("=" * 65)

    running = True

    def handle_exit(signum, frame):
        nonlocal running
        print(f"\n[{datetime.datetime.now().isoformat()}] Daemon received shutdown signal ({signum}). Exiting cleanly.")
        running = False

    try:
        signal.signal(signal.SIGINT, handle_exit)
        signal.signal(signal.SIGTERM, handle_exit)
    except Exception:
        pass

    # Initial check & sync on startup
    run_sync_all(target_repo=target_repo)

    while running:
        try:
            changed_detected = False
            for repo in REPOSITORIES:
                if target_repo and repo["name"].lower() != target_repo.lower() and repo["path"].lower() != target_repo.lower():
                    continue
                path = repo["path"]
                if not os.path.exists(path):
                    continue
                changed = get_changed_files(path, token)
                unpushed = has_unpushed_commits(path, token)
                if changed or unpushed:
                    changed_detected = True
                    break

            if changed_detected:
                # Debounce to let active multi-file edits or builds settle
                time.sleep(debounce)
                # Reload token in case it was rotated
                token = load_pat()
                run_sync_all(target_repo=target_repo)

            time.sleep(interval)
        except Exception as e:
            print(f"[{datetime.datetime.now().isoformat()}] Daemon loop error: {redact(str(e), token)}")
            time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="Git synchronization tool for Market HFT OS and ADRs.")
    parser.add_argument("--daemon", action="store_true", help="Run continuously in the background.")
    parser.add_argument("--watch", action="store_true", help="Alias for --daemon.")
    parser.add_argument("--once", action="store_true", help="Run sync once and exit (default).")
    parser.add_argument("--push-only", action="store_true", help="Only push unpushed commits, do not auto-commit changes.")
    parser.add_argument("--force", action="store_true", help="Force push check even if working tree clean.")
    parser.add_argument("--repo", type=str, default=None, help="Specific repository to sync (Market-HFT-OS or ADRs).")
    parser.add_argument("--interval", type=float, default=3.0, help="Polling interval in seconds for daemon mode.")
    parser.add_argument("--debounce", type=float, default=2.0, help="Debounce duration in seconds.")

    args = parser.parse_args()

    if args.daemon or args.watch:
        daemon_loop(interval=args.interval, debounce=args.debounce, target_repo=args.repo)
    else:
        success = run_sync_all(push_only=args.push_only, force=args.force, target_repo=args.repo)
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
