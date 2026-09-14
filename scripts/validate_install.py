#!/usr/bin/env python3
"""Validate grill-tab's manifest and Hermes host compatibility before install."""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


class ValidationError(Exception):
    pass


def parse_yaml_mapping(path: Path) -> dict[str, object]:
    """Parse the deliberately small, flat plugin manifest without dependencies."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValidationError(f"cannot read plugin.yaml: {exc}") from exc

    values: dict[str, object] = {}
    for number, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw.startswith((" ", "\t")) or ":" not in raw:
            raise ValidationError(f"invalid YAML at line {number}")
        key, value = raw.split(":", 1)
        key, value = key.strip(), value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key) or not value:
            raise ValidationError(f"invalid YAML at line {number}")
        if key in values:
            raise ValidationError(f"duplicate manifest field '{key}'")
        if value in ("[]", "{}"):
            values[key] = [] if value == "[]" else {}
        elif value.startswith(("'", '"')):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValidationError(f"invalid YAML at line {number}")
            values[key] = value[1:-1]
        elif value.startswith(("[", "{")) or value.endswith(("]", "}")):
            raise ValidationError(f"invalid YAML at line {number}")
        else:
            values[key] = value
    return values


def validate_manifest(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise ValidationError("missing plugin.yaml")
    manifest = parse_yaml_mapping(path)
    for field in ("name", "version", "description"):
        if not isinstance(manifest.get(field), str) or not str(manifest[field]).strip():
            raise ValidationError(f"missing '{field}'")
    raw_version = manifest.get("manifest_version")
    if raw_version is None or not re.fullmatch(r"\d+", str(raw_version)):
        raise ValidationError("missing or invalid 'manifest_version'")
    if int(str(raw_version)) > 1:
        raise ValidationError(f"unsupported manifest_version {raw_version}")
    return manifest


def normalized_version(value: str) -> tuple[int, int, int]:
    match = re.search(r"\bv?(\d+)(?:\.(\d+))?(?:\.(\d+))?", value)
    if not match:
        raise ValidationError(f"could not parse Hermes version from {value!r}")
    return tuple(int(part or 0) for part in match.groups())


def host_version(hermes_bin: str) -> tuple[int, int, int]:
    executable = shutil.which(hermes_bin) if "/" not in hermes_bin else hermes_bin
    if not executable:
        raise ValidationError("Hermes CLI not found; install Hermes or set HERMES_BIN")
    try:
        result = subprocess.run(
            [executable, "--version"], text=True, capture_output=True, check=False, timeout=15
        )
    except OSError as exc:
        raise ValidationError(f"could not run Hermes CLI: {exc}") from exc
    if result.returncode:
        raise ValidationError("could not determine Hermes version")
    return normalized_version((result.stdout + result.stderr).strip())


def satisfies(running: tuple[int, int, int], requirement: str) -> bool:
    clauses = [item for item in re.split(r"\s*,\s*|\s+", requirement.strip()) if item]
    if not clauses:
        raise ValidationError("invalid empty requires_hermes")
    for clause in clauses:
        match = re.fullmatch(r"(>=|<=|==|!=|>|<|=)?v?(\d+(?:\.\d+){0,2})", clause)
        if not match:
            raise ValidationError(f"invalid requires_hermes clause '{clause}'")
        op, expected_raw = match.groups()
        expected = normalized_version(expected_raw)
        op = op or "=="
        if not {">=": running >= expected, "<=": running <= expected, ">": running > expected,
                "<": running < expected, "==": running == expected, "=": running == expected,
                "!=": running != expected}[op]:
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=Path(__file__).resolve().parents[1], type=Path)
    parser.add_argument("--hermes-bin", default=None)
    args = parser.parse_args()
    try:
        manifest = validate_manifest(args.source / "plugin.yaml")
        requirement = str(manifest.get("requires_hermes", ">=0.0.0"))
        running = host_version(args.hermes_bin or "hermes")
        if not satisfies(running, requirement):
            required = requirement
            actual = ".".join(map(str, running))
            raise ValidationError(f"Incompatible Hermes version: requires {required}, running {actual}")
    except ValidationError as exc:
        print(f"[ERROR] Invalid plugin manifest: {exc}" if not str(exc).startswith("Incompatible") else f"[ERROR] {exc}", file=sys.stderr)
        return 1
    print(f"Pre-flight passed: grill-tab {manifest['version']} is compatible with Hermes {'.'.join(map(str, running))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
