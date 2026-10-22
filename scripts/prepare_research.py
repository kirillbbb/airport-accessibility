"""Unpack captured PUBLIC evidence for offline reproduction and Python tests."""
from pathlib import Path
import zipfile

root=Path(__file__).resolve().parents[1]
with zipfile.ZipFile(root/'dist/data/evidence.zip') as archive:
    for member in archive.infolist():
        target=(root/member.filename).resolve()
        if not target.is_relative_to((root/'research').resolve()):
            raise ValueError('Unexpected archive path: '+member.filename)
    archive.extractall(root)
print('Public evidence unpacked to research/')
