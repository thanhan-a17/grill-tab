#!/usr/bin/env python3
"""Black-box checks for grill-tab's distributable installer."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PYTHON = Path(os.environ.get("PYTHON_BIN", "/Users/agent/.hermes/hermes-agent/venv/bin/python"))


def make_hermes(directory: Path, version: str) -> Path:
    executable = directory / "hermes"
    executable.write_text(f"#!/usr/bin/env bash\necho 'Hermes Agent v{version}'\n", encoding="utf-8")
    executable.chmod(0o755)
    return executable


def copy_repo(directory: Path) -> Path:
    destination = directory / "grill-tab"
    shutil.copytree(REPO, destination, ignore=shutil.ignore_patterns(".git", "__pycache__", ".pytest_cache", "assets"))
    return destination


class InstallerTests(unittest.TestCase):
    def run_install(self, source: Path, home: Path, hermes: Path) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update({"PYTHON_BIN": str(PYTHON), "HERMES_BIN": str(hermes), "HERMES_HOME": str(home)})
        return subprocess.run(
            ["bash", "install.sh", "--home", str(home)], cwd=source, env=environment,
            text=True, capture_output=True, check=False,
        )

    def test_unsupported_hermes_fails_before_registration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "untouched-home"
            result = self.run_install(copy_repo(root), home, make_hermes(root, "0.19.9"))
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("[ERROR] Incompatible Hermes version: requires >=0.20.0, running 0.19.9", result.stderr)
            self.assertFalse(home.exists(), "pre-flight must not create target home")

    def test_malformed_manifest_fails_before_registration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = copy_repo(root)
            (source / "plugin.yaml").write_text("version: 0.1.0\ndescription: broken\n", encoding="utf-8")
            home = root / "untouched-home"
            result = self.run_install(source, home, make_hermes(root, "0.21.2"))
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("[ERROR] Invalid plugin manifest: missing 'name'", result.stderr)
            self.assertFalse(home.exists(), "invalid manifest must not create target home")

    def test_successful_install_creates_all_artifacts_and_config(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "tmp_home"
            result = self.run_install(copy_repo(root), home, make_hermes(root, "0.21.2"))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue((home / "plugins/grill-tab/plugin.yaml").is_file())
            self.assertTrue((home / "plugins/grill-tab/dashboard/plugin_api.py").is_file())
            self.assertTrue((home / "desktop-plugins/grill-tab/plugin.js").is_file())
            self.assertTrue((home / "desktop-plugins/grill-tab/.hermes-package.json").is_file())
            config = (home / "config.yaml").read_text(encoding="utf-8")
            self.assertIn("plugins:\n  enabled:\n    - grill-tab", config)
            self.assertIn("auxiliary:\n  grill:", config)

    def test_second_install_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "tmp_home"
            source = copy_repo(root)
            hermes = make_hermes(root, "0.21.2")
            first = self.run_install(source, home, hermes)
            second = self.run_install(source, home, hermes)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            config = (home / "config.yaml").read_text(encoding="utf-8")
            self.assertEqual(config.count("- grill-tab"), 1)
            self.assertEqual(config.count("  grill:\n"), 1)
            self.assertTrue((home / "desktop-plugins/grill-tab/.hermes-package.json").is_file())


if __name__ == "__main__":
    unittest.main(verbosity=2)
