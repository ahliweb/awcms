#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
from pathlib import Path


def parse_env_file(path: Path) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            parsed[key] = value
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Resolve runtime env vars from existing workspace env files and/or process env."
    )
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--export-file", required=True)
    parser.add_argument("--require", action="append", default=[])
    args = parser.parse_args()

    repo_root = Path(args.repo_root)
    candidate_relpaths = [
        "awcms/.env.production",
        "awcms/.env.remote",
        "awcms/.env.local",
        "awcms/.env",
        "awcms-edge/.env.production",
        "awcms-edge/.env.remote",
        "awcms-edge/.env.local",
        "awcms-edge/.env",
        "awcms-edge/.dev.vars",
    ]

    found_files: list[Path] = []
    missing_files: list[Path] = []
    parsed_by_file: list[tuple[Path, dict[str, str]]] = []

    for relpath in candidate_relpaths:
        abs_path = repo_root / relpath
        if abs_path.exists():
            found_files.append(abs_path)
            parsed_by_file.append((abs_path, parse_env_file(abs_path)))
        else:
            missing_files.append(abs_path)

    resolved: dict[str, str] = {}
    resolved_sources: dict[str, str] = {}

    for key in args.require:
        env_value = (os.environ.get(key) or "").strip()
        if env_value:
            resolved[key] = env_value
            resolved_sources[key] = "process_env"
            continue

        for path, parsed in parsed_by_file:
            value = (parsed.get(key) or "").strip()
            if value:
                resolved[key] = value
                resolved_sources[key] = str(path.relative_to(repo_root))
                break

    unresolved = [key for key in args.require if key not in resolved]

    print("[env-resolve] Found env files:")
    if found_files:
        for path in found_files:
            print(f"[env-resolve]   - {path.relative_to(repo_root)}")
    else:
        print("[env-resolve]   - none")

    print("[env-resolve] Missing candidate env files:")
    if missing_files:
        for path in missing_files:
            print(f"[env-resolve]   - {path.relative_to(repo_root)}")
    else:
        print("[env-resolve]   - none")

    print("[env-resolve] Resolved variable sources:")
    if resolved_sources:
        for key in args.require:
            if key in resolved_sources:
                print(f"[env-resolve]   - {key}: {resolved_sources[key]}")
    else:
        print("[env-resolve]   - none")

    print("[env-resolve] Unresolved required variables:")
    if unresolved:
        for key in unresolved:
            print(f"[env-resolve]   - {key}")
    else:
        print("[env-resolve]   - none")

    export_path = Path(args.export_file)
    export_path.write_text(
        "".join(f"export {key}={resolved[key]!r}\n" for key in args.require if key in resolved),
        encoding="utf-8",
    )

    if unresolved:
        missing_list = ", ".join(unresolved)
        raise SystemExit(
            f"Failed to resolve required runtime env variables: {missing_list}. "
            "Provide them via existing workspace env files or the shell environment."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
