"""Freeze released 021 native/assets and apply only reviewed Android UI sources."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[2]
stage = root / 'tmp/android-ui-continuation/stage'
out = root / 'outputs/2026-10-19-android-ui-continuation'
baseline = root / 'outputs/2026-10-19-android-sync021'
release = json.loads((baseline / 'release.json').read_text(encoding='utf-8-sig'))
assert release['sha256'] == '274478dff571f7cb63435cb6efc6e47bfabcceb160a03332232f3467a3c8a954'
sha = lambda b: hashlib.sha256(b).hexdigest()
apk = root / release['apk']
assert sha(apk.read_bytes()) == release['sha256'], 'Released 021 APK changed'
original = json.loads((baseline / 'stage-manifest.json').read_text(encoding='utf-8-sig'))
stage.mkdir(parents=True, exist_ok=True)
out.mkdir(parents=True, exist_ok=True)

def write(relative, data):
    target = (stage / relative).resolve()
    assert target.is_relative_to(stage.resolve()), 'Stage path escape'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)

native = {}
for name, expected in original['stageHashes'].items():
    if not name.startswith('native/'):
        continue
    data = (root / 'tmp/android-sync021/stage' / name).read_bytes()
    assert sha(data) == expected, '021 native source stage changed: ' + name
    native[name] = expected
    write(name, data)
assert native and 'native/AndroidManifest.xml' in native

assets = {}
with zipfile.ZipFile(apk) as archive:
    for item in archive.infolist():
        if item.is_dir() or not item.filename.startswith('assets/'):
            continue
        assert '\\' not in item.filename and '..' not in Path(item.filename).parts
        assert item.filename not in assets, 'Duplicate baseline asset'
        data = archive.read(item)
        assets[item.filename] = sha(data)
        write(item.filename, data)

overlays = {
    'android/qq-chat/view.js': 'assets/telegram/qq-chat/view.js',
    'android/qq-chat/reading-position.js': 'assets/telegram/qq-chat/reading-position.js',
    'android/ui-refinement-019/editor.css': 'assets/editor019.css',
    'android/app/src/main/assets/editor.css': 'assets/editor.css',
    'android/app/src/main/assets/editor.html': 'assets/editor.html',
    'android/app/src/main/assets/editor.js': 'assets/editor.js',
    'android/app/src/main/assets/desktop-entry-adapter.js': 'assets/desktop-entry-adapter.js',
    'android/app/src/main/AndroidManifest.xml': 'native/AndroidManifest.xml',
    'android/app/src/main/java/dev/shiye/app/MainActivity.java': 'native/java/dev/shiye/app/MainActivity.java',
    'android/app/src/main/java/dev/shiye/app/LocalStore.java': 'native/java/dev/shiye/app/LocalStore.java',
    'android/app/src/main/java/dev/shiye/app/AttachmentPicker.java': 'native/java/dev/shiye/app/AttachmentPicker.java',
    'android/app/src/main/java/dev/shiye/app/DiaryListPage.java': 'native/java/dev/shiye/app/DiaryListPage.java',
    'android/app/src/main/java/dev/shiye/app/DiaryImageImport.java': 'native/java/dev/shiye/app/DiaryImageImport.java',
    'android/app/src/main/java/dev/shiye/app/DiaryLocation.java': 'native/java/dev/shiye/app/DiaryLocation.java',
    'android/app/src/main/java/dev/shiye/app/DiaryScrollCapture.java': 'native/java/dev/shiye/app/DiaryScrollCapture.java',
    'android/app/src/main/java/dev/shiye/app/DiaryImageViewer.java': 'native/java/dev/shiye/app/DiaryImageViewer.java',
}
sources = {}
for source, destination in overlays.items():
    data = (root / source).read_bytes()
    sources[source] = sha(data)
    if source.endswith('/editor.html'):
        text = data.decode('utf-8')
        if '/editor019.css' not in text:
            text = text.replace('<script src="/editor.js"', '<link rel="stylesheet" href="/editor019.css" /><script src="/editor.js"')
        data = text.encode('utf-8')
    write(destination, data)

stage_hashes = {str(p.relative_to(stage)).replace('\\', '/'): sha(p.read_bytes())
                for p in sorted(stage.rglob('*')) if p.is_file()}
expected_names = set(native) | set(assets) | set(overlays.values())
assert set(stage_hashes) == expected_names, 'Unexpected files in isolated UI stage'
for source, expected in sources.items():
    assert sha((root / source).read_bytes()) == expected, 'Source changed while staging'
receipt = {
    'version': '0.22.0-ui', 'versionCode': 24,
    'baselineApk': release['apk'], 'baselineSha256': release['sha256'],
    'nativeBaselineFiles': len(native),
    'preservedNativeFiles': len(set(native) - set(overlays.values())),
    'sources': sources, 'overlays': overlays, 'stageHashes': stage_hashes,
    'scope': 'Explicit Android UI/editor/gallery seams only; Repository/sync preserved from released 021',
}
(out / 'stage-manifest.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps({'staged': len(stage_hashes), 'native': len(native), 'uiSources': len(sources)}))
