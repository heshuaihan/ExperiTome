"""Refresh public metadata and the complete material index without private inputs."""
from pathlib import Path
from build_module_meta import main as build_meta
from build_materials import build
ROOT = Path(__file__).resolve().parents[1]
def main():
    build_meta()
    build(ROOT)
if __name__ == '__main__':
    main()
