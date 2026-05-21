import subprocess
import sys

work_dir = r"C:\Users\seoje\OneDrive\문서\New project\Project-AXIOM"
out_file = r"C:\Users\seoje\OneDrive\문서\New project\Project-AXIOM\test-output.txt"
sentinel = r"C:\Users\seoje\OneDrive\문서\New project\Project-AXIOM\test-done.sentinel"

with open(out_file, "w", encoding="utf-8") as f:
    result = subprocess.run(
        ["node", "--test", "test/all.test.mjs"],
        cwd=work_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=600
    )
    f.write(result.stdout)

# Write sentinel so we know it's done
with open(sentinel, "w") as s:
    s.write(f"returncode={result.returncode}\n")

print("DONE")
sys.exit(0)
