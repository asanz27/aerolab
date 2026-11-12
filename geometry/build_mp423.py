"""mp423 CFD geometry: see build_glb.py (shrink-wrapped visual model, CC BY 4.0 source)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_glb import cli  # noqa: E402

if __name__ == "__main__":
    cli("mp423")
