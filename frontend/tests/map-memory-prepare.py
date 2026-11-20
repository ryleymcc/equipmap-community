"""Prepare reproducible local browser fixtures without modifying database/uploads.
Run from the repository root; --baseline-ref chooses the old renderer revision.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--baseline-ref', default='HEAD')
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
subprocess.run([sys.executable,str(root/'frontend/tests/map-memory-fixtures.py')],check=True)
fixtures=root/'frontend/test-results/map-fixtures'
for name in ['CAD - Level 2.pdf','Wellness Entry level plan.pdf','sogh.jpg']:
    shutil.copyfile(root/'uploads'/name,fixtures/name)
source=subprocess.check_output(['git','show',f'{args.baseline_ref}:frontend/src/components/MapCanvas.jsx'],cwd=root,text=True)
source=source.replace("from '../api'", "from '../src/api'").replace("from '../floorplanLogger'", "from '../src/floorplanLogger'")
# Both harness renderers share PDF.js configuration; avoid the baseline module
# overriding the prototype's precached worker URL with its old version query.
source=source.replace("pdfjs.GlobalWorkerOptions.workerSrc = `${pdfWorkerUrl}?v=${encodeURIComponent(import.meta.env.VITE_APP_VERSION || 'dev')}`;",'pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;')
(root/'frontend/test-results/BaselineMapCanvas.jsx').write_text(source)
print('Prepared local comparison fixtures at', fixtures)
