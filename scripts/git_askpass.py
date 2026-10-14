#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Secure Git Askpass Credential Provider.
Outputs username or PAT token via pipe stdout when invoked by Git.
Ensures token is never passed in command-line arguments (argv).
"""
import sys
import os

TOKEN_FILE = r"D:\Market HFT OS\GithubPersonalAccessTokenFORAG.env"

def main():
    prompt = sys.argv[1].lower() if len(sys.argv) > 1 else ""
    
    if "username" in prompt:
        sys.stdout.write("x-access-token\n")
        sys.stdout.flush()
        return

    # For Password / Token prompts
    token = os.environ.get("GIT_PAT_SECRET", "")
    if not token and os.path.exists(TOKEN_FILE):
        try:
            with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if "=" in content:
                content = content.split("=", 1)[1].strip()
            token = content.strip("\"'")
        except Exception:
            token = ""

    sys.stdout.write(f"{token}\n")
    sys.stdout.flush()

if __name__ == "__main__":
    main()
