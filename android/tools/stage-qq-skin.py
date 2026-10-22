"""Build an auditable UI-only overlay on the installed 0.14 baseline; no live data."""
from pathlib import Path
import base64
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'outputs/2026-10-18-android-media-014'
STAGE = ROOT / 'tmp/android-qq-016'
OUT = ROOT / 'outputs/2026-10-18-android-qq-016'
APK = BASE / 'Shiye-Android-0.14.0-29865bf4.apk'
OWNED = ['android-chat.js', 'android-qq-skin.js', 'android-qq-skin.css', 'android-qq-gestures.js']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_member(root, name, data):
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Archive path escapes owned stage')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def main():
    baseline = APK.read_bytes()
    assert digest(baseline) == '29865bf46b6616f2eb4a37261e12398f9b6df8d997a8338abddcd3725b58a184'
    OUT.mkdir(parents=True, exist_ok=True)
    native = {}
    with zipfile.ZipFile(BASE / 'Android-0.14-owned-sources.zip') as source:
        for name in source.namelist():
            prefix = 'android/app/src/main/'
            if name.startswith(prefix) and not name.startswith(prefix + 'assets/') and not name.endswith('/'):
                data = source.read(name)
                write_member(STAGE / 'source14', name[len(prefix):], data)
                native[name[len(prefix):]] = digest(data)
    original = {}
    with zipfile.ZipFile(APK) as apk:
        for name in apk.namelist():
            if name.startswith('assets/') and not name.endswith('/'):
                data = apk.read(name)
                write_member(STAGE / 'assets14', name[len('assets/'):], data)
                original[name[len('assets/'):]] = digest(data)
    assets = STAGE / 'assets14'
    changed = {}
    for name in OWNED:
        data = (ROOT / 'android/telegram-adapter' / name).read_bytes()
        write_member(assets, 'telegram/' + name, data)
        changed[name] = digest(data)
    index = assets / 'telegram/index.html'
    html = index.read_text(encoding='utf-8')
    match = re.search(r'(<script type="importmap" data-shiye-attachment-version="1">)(.*?)(</script>)', html)
    assert match
    old = match[2]
    mapping = json.loads(old)
    for name, sha in changed.items():
        mapping['imports']['/telegram/' + name] = '/telegram/' + name + '?v=' + sha[:24]
    new = json.dumps(mapping, ensure_ascii=False, separators=(',', ':'))
    csp_hash = lambda value: base64.b64encode(hashlib.sha256(value.encode()).digest()).decode()
    html = html[:match.start(2)] + new + html[match.end(2):]
    html = html.replace('sha256-' + csp_hash(old), 'sha256-' + csp_hash(new))
    html = re.sub(r'android-chat.js\?v=[a-f0-9]+', 'android-chat.js?v=' + changed['android-chat.js'][:24], html)
    html = html.replace('</head>', '<link rel="stylesheet" href="./android-qq-skin.css?v=' + changed['android-qq-skin.css'][:24] + '">\n</head>')
    index.write_bytes(html.encode('utf-8'))
    allowed = {'telegram/index.html', *['telegram/' + name for name in OWNED]}
    preserved = 0
    for name, sha in original.items():
        if name not in allowed:
            assert digest((assets / name).read_bytes()) == sha, name
            preserved += 1
    report = {'baselineApkSha256': digest(baseline), 'native': native, 'ownedOverlay': changed,
              'unchangedBaselineAssets': preserved, 'allBaselineAssets': len(original),
              'allowedOverlayPaths': sorted(allowed), 'importmapCspSha256': csp_hash(new)}
    (OUT / 'skin-stage-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'preservedAssets': preserved, 'nativeFiles': len(native), 'overlay': changed}))


if __name__ == '__main__':
    main()
