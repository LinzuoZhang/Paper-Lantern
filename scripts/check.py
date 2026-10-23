"""Run the Python and JavaScript tests from any working directory."""

from pathlib import Path
import shutil
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parents[1]
    node = shutil.which("node")
    if not node:
        print("JavaScript tests require Node.js on PATH.", file=sys.stderr)
        return 1

    checks = [
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
        [node, "--test", *[str(path.relative_to(root)) for path in sorted((root / "tests").glob("*_test.mjs"))]],
    ]
    failed = False
    for command in checks:
        result = subprocess.run(command, cwd=root)
        failed = failed or result.returncode != 0
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
