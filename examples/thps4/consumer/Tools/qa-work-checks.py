"""Owned-workspace QA checks; never advances an original-game session or signs a build."""
import hashlib
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".qa-output"
SETTINGS = json.loads((ROOT / ".qa-tracker.json").read_text())["toolchain"]
UNITY = Path(SETTINGS["unity"])


class ValidationFailure(Exception):
    pass


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    operation = sys.argv[1]
    if operation == "probe-unity":
        if not UNITY.is_file():
            raise RuntimeError("Unity 6000.3.10f1 is unavailable; configure the local toolchain")
        print(json.dumps({"editor": str(UNITY), "project": str(ROOT / "Unity"), "license": "not-probed"}))
        return
    if operation == "device":
        raise RuntimeError("Signing/install and physical-device acceptance require an explicitly configured same-build device wrapper")
    if operation == "capture":
        raise RuntimeError("Native capture requires an owned-session producer; this adapter replays existing admitted captures only")
    OUT.mkdir(exist_ok=True)
    if operation == "tracker":
        result = subprocess.run(["npm", "test", "--prefix", "Tracker"], cwd=ROOT, capture_output=True, text=True, timeout=300)
        (OUT / "tracker.tap").write_text(result.stdout + result.stderr)
        if result.returncode:
            raise ValidationFailure("Tracker suite failed; inspect .qa-output/tracker.tap")
        print(result.stdout[-4000:])
        return
    if operation not in {"edit", "play"}:
        raise RuntimeError("Unknown validation operation")
    project = ROOT / "Unity"
    if not UNITY.is_file():
        raise RuntimeError("Configured Unity editor is unavailable")
    recovered = project / "Assets/Recovered"
    inputs = ROOT / "Research/local/qa-recovered-source"
    if not recovered.exists() and inputs.exists():
        shutil.copytree(inputs, recovered)  # Private writable imports; original inputs stay read-only.
    archive = OUT / (operation + "-" + str(time.time_ns()))
    archive.mkdir()
    # These historical comparison reports are outputs of existing tests. Preserve
    # newly produced bytes, then restore the owned worktree's previous evidence.
    snapshots = {}
    for report in (ROOT / "Research/evidence").glob("*comparison*.json"):
        if report.is_symlink():
            continue
        copy = archive / ("before-" + report.name)
        shutil.copy2(report, copy)
        snapshots[report] = copy
    xml, log = OUT / (operation + ".xml"), OUT / (operation + ".log")
    xml.unlink(missing_ok=True)
    log.unlink(missing_ok=True)
    try:
        result = subprocess.run([str(UNITY), "-batchmode", "-projectPath", str(project), "-runTests",
                                 "-testPlatform", "EditMode" if operation == "edit" else "PlayMode",
                                 "-testResults", str(xml), "-logFile", str(log)], cwd=ROOT, timeout=3300)
        if not xml.exists():
            raise RuntimeError("Unity did not produce a successful test run")
        values = ET.parse(xml).getroot().attrib
        gates = SETTINGS[operation]
        if result.returncode or int(values.get("failed", 1)) or int(values.get("passed", 0)) < gates["minimumPassed"] or int(values.get("skipped", 0)) > gates["maximumSkipped"]:
            raise ValidationFailure("Unity regression gates failed: " + json.dumps(values))
        print(json.dumps({"platform": operation, "results": values, "source": "actual Unity XML"}))
    finally:
        changed, reports = [], []
        for report, original in snapshots.items():
            if report.is_symlink():
                raise RuntimeError("Comparison output became a symlink")
            if not report.exists() or sha(report) != sha(original):
                generated = report.read_bytes() if report.exists() else None
                if generated is not None:
                    (archive / ("generated-" + report.name)).write_bytes(generated)
                reports.append({"path": str(report.relative_to(ROOT)), "beforeSha256": sha(original),
                                "generatedBytesBase64": base64.b64encode(generated).decode() if generated is not None else None})
                shutil.copy2(original, report)
                changed.append(str(report.relative_to(ROOT)))
        for report in (ROOT / "Research/evidence").glob("*comparison*.json"):
            if report not in snapshots and report.is_file() and not report.is_symlink():
                shutil.copy2(report, archive / ("generated-" + report.name))
                reports.append({"path": str(report.relative_to(ROOT)), "beforeSha256": None,
                                "generatedBytesBase64": base64.b64encode(report.read_bytes()).decode()})
                report.unlink()  # Newly produced owned-workspace output, retained in the archive.
                changed.append(str(report.relative_to(ROOT)))
        (OUT / (operation + "-history.json")).write_text(json.dumps({"restored": changed, "reports": reports,
                                                                   "archive": str(archive.relative_to(ROOT))}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except ValidationFailure as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
