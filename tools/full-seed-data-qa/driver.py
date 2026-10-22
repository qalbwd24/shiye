"""Dedicated 5582 QA driver. No emulator start, generic adb, retry, reset, or formal API."""
import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
SERIAL = 'emulator-5582'
PACKAGE = 'dev.shiye.dataqa.fullseed'
ADB = 'D:/codex-tools/android-sdk/platform-tools/adb.exe'
JAVA = 'D:/codex-tools/android-build/jdk/jdk-17.0.20.1+1'
SIGNER = 'D:/codex-tools/android-sdk/build-tools/36.0.0/apksigner.bat'
AAPT = 'D:/codex-tools/android-sdk/build-tools/36.0.0/aapt.exe'
ENV_GUARD = pathlib.Path('D:/拾页/tmp/full-seed-data-qa/guard.py')
REMOTE = '/sdcard/Download/shiye-fullseed-import.syseed'
GIB = 1024**3
_install_permit = False
_push_permit = None
_tap_permit = None
_swipe_permit = None
PREFS_READ = 'if [ -f shared_prefs/backend_services_v1.xml ]; then cat shared_prefs/backend_services_v1.xml; fi'


def validate_serial(serial):
    if serial != SERIAL:
        raise ValueError('Only exact dedicated emulator-5582 is permitted')


def digest(file):
    h = hashlib.sha256()
    with pathlib.Path(file).open('rb') as source:
        while part := source.read(1024*1024):
            h.update(part)
    return h.hexdigest()


def read_policy():
    policy = json.loads((HERE / 'driver-policy.json').read_text(encoding='utf8'))
    if policy['packageId'] != PACKAGE or policy['serial'] != SERIAL:
        raise ValueError('Fixed package/serial mismatch')
    if policy['apkFile'] != 'Shiye-FullSeed-Data-QA.apk':
        raise ValueError('Fixed APK path mismatch')
    if pathlib.Path(policy['environmentGuard']).resolve() != ENV_GUARD.resolve():
        raise ValueError('Only original dedicated environment guard is permitted')
    if not re.fullmatch(r'full-seed-data-[0-9]{13}', policy['candidateId']):
        raise ValueError('Fixed candidate identity required')
    if digest(HERE / policy['apkFile']) != policy['apkSha256']:
        raise ValueError('APK SHA mismatch')
    if digest(policy['environmentGuard']) != policy['environmentGuardSha256']:
        raise ValueError('Original read-only environment guard changed')
    if digest(HERE / 'input-manifest.json') != policy['inputManifestSha256']:
        raise ValueError('Frozen input manifest changed')
    state = pathlib.Path(policy['privateState'])
    if state.resolve() != (pathlib.Path(policy['environmentGuard']).parent / 'private' / policy['candidateId']).resolve():
        raise ValueError('Private QA state outside dedicated environment')
    return policy


def approval(policy):
    state = pathlib.Path(policy['privateState'])
    value = json.loads((state / 'approval.json').read_text(encoding='utf8'))
    manifest_sha = digest(HERE / 'candidate-manifest.json')
    if value.get('approved') is not True or value.get('candidateManifestSha256') != manifest_sha or value.get('apkSha256') != policy['apkSha256'] or not value.get('reviewer'):
        raise ValueError('Independent approval must bind this exact candidate and APK')
    validate_seed_descriptor(value.get('approvedSeed'))
    manifest = json.loads((HERE / 'candidate-manifest.json').read_text(encoding='utf8'))
    for file in manifest['artifacts']:
        if digest(HERE / file['file']) != file['sha256']:
            raise ValueError('Reviewed artifact drift: '+file['file'])
    return state


def resource_status():
    class Memory(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in ['totalPhys', 'availPhys', 'totalPage', 'availPage', 'totalVirtual', 'availVirtual', 'availExtended']]
    status = Memory()
    status.length = ctypes.sizeof(Memory)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise ValueError('Cannot verify host memory budget')
    return dict(diskFreeBytes=shutil.disk_usage('D:/').free, physicalAvailableBytes=status.availPhys, commitAvailableBytes=status.availPage)


def validate_resources(value):
    if value['diskFreeBytes'] < 96*GIB or value['physicalAvailableBytes'] < 3*GIB or value['commitAvailableBytes'] < 4.5*GIB:
        raise ValueError('Host budget below D>=96GiB/physical>=3GiB/commit>=4.5GiB; nothing started')


def load_guard(policy):
    spec = importlib.util.spec_from_file_location('fullseed_original_guard', policy['environmentGuard'])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_process_set(processes, owned, guard):
    if isinstance(processes, dict):
        processes = [processes]
    matches = [p for p in processes if re.search(r'(?<!\d)5582(?!\d)', p.get('CommandLine', '')) or guard.AVD in p.get('CommandLine', '')]
    if len(matches) != 1 or matches[0]['ProcessId'] != owned['ProcessId']:
        raise ValueError('Duplicate or unowned dedicated emulator process')
    guard.validate_process(matches[0], owned['ProcessId'])


def adb(serial, *args, timeout=40, binary=False):
    global _install_permit, _push_permit, _tap_permit, _swipe_permit
    validate_serial(serial)
    fixed = [
        ('forward', '--list'), ('forward', '--remove', 'tcp:19482'), ('reverse', '--list'), ('shell', 'pm', 'path', PACKAGE),
        ('shell', 'sha256sum', REMOTE), ('shell', 'uiautomator', 'dump', '/sdcard/Download/.shiye-fullseed-qa-ui.xml'),
        ('shell', 'cat', '/sdcard/Download/.shiye-fullseed-qa-ui.xml'),
        ('shell', 'am', 'force-stop', PACKAGE), ('shell', 'am', 'start', '-n', PACKAGE+'/dev.shiye.app.MainActivity'),
        ('shell', 'pidof', PACKAGE), ('exec-out', 'screencap', '-p'),
        ('shell', 'run-as', PACKAGE, 'sh', '-c', PREFS_READ),
    ]
    allowed = args in fixed
    if args == ('install', str(HERE / 'Shiye-FullSeed-Data-QA.apk')) and _install_permit:
        _install_permit = False
        allowed = True
    elif _push_permit and args == ('push', *_push_permit):
        _push_permit = None
        allowed = True
    elif _tap_permit and args == ('shell', 'input', 'tap', *_tap_permit):
        _tap_permit = None
        allowed = True
    elif _swipe_permit and args == ('shell', 'input', 'swipe', *_swipe_permit):
        _swipe_permit = None
        allowed = True
    elif len(args) == 3 and args[:2] == ('forward', 'tcp:19482') and re.fullmatch(r'localabstract:webview_devtools_remote_[1-9][0-9]*', args[2]):
        allowed = True
    elif len(args) == 3 and args[0] == 'pull' and re.fullmatch(r'/data/app/[A-Za-z0-9_+./=~-]+/base.apk', args[1]):
        policy = json.loads((HERE / 'driver-policy.json').read_text(encoding='utf8'))
        allowed = pathlib.Path(args[2]).resolve() == (pathlib.Path(policy['privateState']) / 'installed-base.apk').resolve()
    if not allowed:
        raise ValueError('Arbitrary adb action/path/target forbidden')
    if args == ('shell', 'pm', 'path', PACKAGE) and not binary:
        command = [ADB, '-s', SERIAL, *args]
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout, check=False)
        if result.returncode == 0 and result.stderr == '':
            return result.stdout
        if result.returncode == 1 and result.stdout == '' and result.stderr == '':
            return ''  # Android PackageManager: exact package is absent; no install was sent.
        raise subprocess.CalledProcessError(result.returncode, command, output=result.stdout, stderr=result.stderr)
    return subprocess.check_output([ADB, '-s', SERIAL, *args], text=not binary, timeout=timeout)


def inspect(policy, serial):
    validate_serial(serial)
    validate_resources(resource_status())
    guard = load_guard(policy)
    owned = guard.owned_process(serial)
    command = "Get-CimInstance Win32_Process -Filter \"Name='qemu-system-x86_64-headless.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
    processes = json.loads(subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', command], text=True, timeout=30))
    validate_process_set(processes, owned, guard)
    if guard.adb(serial, 'get-state') != 'device' or guard.adb(serial, 'emu', 'avd', 'name').splitlines()[0].strip() != guard.AVD or guard.adb(serial, 'shell', 'getprop', 'sys.boot_completed') != '1':
        raise ValueError('Dedicated console/device identity mismatch')
    available = int(guard.adb(serial, 'shell', 'df', '-k', '/data').splitlines()[-1].split()[3])*1024
    if available < 24*GIB:
        raise ValueError('Dedicated /data below 24GiB available')
    forwards = adb(serial, 'forward', '--list')
    if any(line.split()[:1] == [SERIAL] and 'tcp:18765' in line.split()[1:] for line in forwards.splitlines()) or 'tcp:18765' in adb(serial, 'reverse', '--list').split():
        raise ValueError('Formal API forwarding present on this QA serial; writes forbidden')
    return dict(serial=SERIAL, avd=guard.AVD, dataAvailableBytes=available)


def verify_apk_signature(policy):
    env = dict(os.environ, JAVA_HOME=JAVA)
    output = subprocess.check_output([SIGNER, 'verify', '--verbose', '--print-certs', str(HERE / policy['apkFile'])], text=True, timeout=60, env=env)
    certs = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})', output)
    if len(certs) != 1 or certs[0].lower() != policy['certificateSha256']:
        raise ValueError('APK certificate mismatch')


def reserve(state, phase):
    state.mkdir(parents=True, exist_ok=True)
    with (state / (phase+'-attempt.json')).open('x', encoding='utf8') as out:
        json.dump(dict(phase=phase, serial=SERIAL, packageId=PACKAGE, attemptedAt=time.time(), automaticRetry=False), out)
        out.flush()
        os.fsync(out.fileno())


def installed(policy, state, serial):
    receipt = json.loads((state / 'install-result.json').read_text(encoding='utf8'))
    if not receipt.get('success') or receipt['apkSha256'] != policy['apkSha256']:
        recovery = json.loads((state / 'install-readonly-verification.json').read_text(encoding='utf8')) if (state / 'install-readonly-verification.json').exists() else {}
        if recovery.get('verification') != 'exact-installed-base-sha256' or recovery.get('apkSha256') != policy['apkSha256'] or recovery.get('installedBaseSha256') != policy['apkSha256'] or recovery.get('certificateSha256') != policy['certificateSha256'] or type(recovery.get('versionCode')) is not int or recovery.get('versionCode') != 1 or recovery.get('noInstallInvoked') is not True or recovery.get('versionName') != '0.1.0-fullseed-dataqa-ddc74' or recovery.get('serial') != SERIAL or recovery.get('packageId') != PACKAGE or recovery.get('attemptSha256') != digest(state / 'install-attempt.json') or recovery.get('resultSha256') != digest(state / 'install-result.json'):
            raise ValueError('No successful matching guarded install or exact read-only verification')
    verify_installed_bytes(policy, state, serial)


def verify_installed_bytes(policy, state, serial, verify_identity=False):
    paths = adb(serial, 'shell', 'pm', 'path', PACKAGE).strip().splitlines()
    if len(paths) != 1 or not re.fullmatch(r'package:/data/app/[A-Za-z0-9_+./=~-]+/base.apk', paths[0]):
        raise ValueError('Unexpected installed APK location/splits')
    target = state / 'installed-base.apk'
    adb(serial, 'pull', paths[0][8:], str(target), timeout=120)
    identity = None
    try:
        if digest(target) != policy['apkSha256']:
            raise ValueError('Installed APK bytes differ from reviewed candidate')
        if verify_identity:
            identity = verify_pulled_apk_identity(policy, state)
    finally:
        target.unlink(missing_ok=True)
    config = adb(serial, 'shell', 'run-as', PACKAGE, 'sh', '-c', PREFS_READ).strip()
    validate_private_locator(config)
    return identity


def verify_pulled_apk_identity(policy, state):
    target = state / 'installed-base.apk'
    env = dict(os.environ, JAVA_HOME=JAVA)
    signature = subprocess.check_output([SIGNER, 'verify', '--verbose', '--print-certs', str(target)], text=True, timeout=60, env=env)
    (state / 'install-readonly-apksigner.log').write_text(signature, encoding='utf8')
    certs = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})', signature)
    if len(certs) != 1 or certs[0].lower() != policy['certificateSha256']:
        raise ValueError('Pulled installed APK certificate mismatch')
    badging = subprocess.check_output([AAPT, 'dump', 'badging', str(target)], text=True, timeout=60)
    (state / 'install-readonly-badging.log').write_text(badging, encoding='utf8')
    header = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.MULTILINE)
    if not header or header.groups() != (PACKAGE, '1', '0.1.0-fullseed-dataqa-ddc74'):
        raise ValueError('Pulled installed APK package/version mismatch')
    if digest(target) != policy['apkSha256']:
        raise ValueError('Pulled installed APK changed during identity verification')
    return dict(installedBaseSha256=policy['apkSha256'], certificateSha256=certs[0].lower(), versionCode=1, versionName='0.1.0-fullseed-dataqa-ddc74')


def verify_install_readonly(policy, state, serial):
    validate_serial(serial)
    target = state / 'install-readonly-verification.json'
    if target.exists():
        raise ValueError('Read-only install verification already recorded; no repeated recovery')
    attempt = json.loads((state / 'install-attempt.json').read_text(encoding='utf8'))
    result = json.loads((state / 'install-result.json').read_text(encoding='utf8'))
    if attempt.get('phase') != 'install' or attempt.get('serial') != SERIAL or attempt.get('packageId') != PACKAGE or attempt.get('automaticRetry') is not False or result.get('success') is not False or result.get('apkSha256') != policy['apkSha256'] or result.get('serial') != SERIAL or result.get('packageId') != PACKAGE:
        raise ValueError('Original consumed exact installation attempt/result required; never reinstall')
    before = (digest(state / 'install-attempt.json'), digest(state / 'install-result.json'))
    verify_apk_signature(policy)
    inspect(policy, serial)
    identity = verify_installed_bytes(policy, state, serial, verify_identity=True)
    if before != (digest(state / 'install-attempt.json'), digest(state / 'install-result.json')):
        raise ValueError('Original install evidence changed during read-only verification')
    receipt = dict(verification='exact-installed-base-sha256', apkSha256=policy['apkSha256'], serial=SERIAL, packageId=PACKAGE, attemptSha256=before[0], resultSha256=before[1], noInstallInvoked=True, **identity)
    with target.open('x', encoding='utf8') as out:
        json.dump(receipt, out, indent=2)
        out.flush()
        os.fsync(out.fileno())
    return receipt


def validate_private_locator(config):
    if not config:
        return
    values = ET.fromstring(config)
    base = next((n.text or '' for n in values if n.tag == 'string' and n.get('name') == 'baseUrl'), '')
    if base not in ['', 'http://127.0.0.1:19483']:
        raise ValueError('QA server locator must be empty/offline or fixed private clone port19483; formal forbidden')


def install_once(policy, state, serial):
    global _install_permit
    validate_serial(serial)
    if (state / 'install-attempt.json').exists():
        raise ValueError('One install attempt already consumed; no retry is permitted')
    verify_apk_signature(policy)
    inspect(policy, serial)
    if adb(serial, 'shell', 'pm', 'path', PACKAGE).strip():
        raise ValueError('QA package already exists; no overwrite/update/clear')
    reserve(state, 'install')  # durable before the only install call, even on timeout/failure
    result = dict(success=False, apkSha256=policy['apkSha256'], serial=SERIAL, packageId=PACKAGE)
    try:
        _install_permit = True
        value = adb(serial, 'install', str(HERE / policy['apkFile']), timeout=180)
        if value.strip() != 'Success':
            raise ValueError('Install did not return exact Success')
        result['success'] = True
        return result
    finally:
        _install_permit = False
        (state / 'install-result.json').write_text(json.dumps(result, indent=2), encoding='utf8')


SEED_FIELDS = ('path', 'bytes', 'sha256', 'libraryId', 'epoch', 'packageId', 'keyFingerprintSha256')


def validate_seed_descriptor(value):
    if not isinstance(value, dict) or set(value) != set(SEED_FIELDS):
        raise ValueError('Exact privately approved seed binding required')
    if any(not isinstance(value[key], str) or not re.fullmatch('[a-f0-9]{64}', value[key]) for key in ['sha256', 'keyFingerprintSha256']):
        raise ValueError('Real signed seed binding/hash missing')
    if type(value['bytes']) is not int or value['bytes'] <= 0:
        raise ValueError('Seed size missing')
    for key in ['libraryId', 'epoch', 'packageId']:
        if not isinstance(value[key], str) or not re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', value[key]):
            raise ValueError('Seed identity missing')
    if not isinstance(value['path'], str) or not pathlib.Path(value['path']).is_absolute() or pathlib.Path(value['path']).suffix.lower() not in ['.syseed', '.zip']:
        raise ValueError('Absolute privately approved seed file required')
    return value


def seed_binding(state):
    try:
        value = validate_seed_descriptor(json.loads((state / 'seed-input.json').read_text(encoding='utf8')))
        approval_value = json.loads((state / 'approval.json').read_text(encoding='utf8'))
        if not isinstance(approval_value, dict):
            raise ValueError('Private reviewed seed approval unavailable')
        approved = validate_seed_descriptor(approval_value.get('approvedSeed'))
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError('Private reviewed seed binding unavailable') from error
    if approval_value.get('approved') is not True or any(value[key] != approved[key] for key in SEED_FIELDS):
        raise ValueError('Seed differs from independent approval')
    file = pathlib.Path(value['path'])
    try:
        before = file.stat()
        if not file.is_file() or before.st_size != value['bytes'] or digest(file) != value['sha256']:
            raise ValueError('Privately approved seed bytes/hash mismatch')
        after = file.stat()
    except OSError as error:
        raise ValueError('Privately approved seed file unavailable') from error
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise ValueError('Privately approved seed changed during verification')
    return value


def push_seed(policy, state, serial):
    global _push_permit
    value = seed_binding(state)
    file = pathlib.Path(value['path'])
    budget = inspect(policy, serial)
    if budget['dataAvailableBytes'] < 4*value['bytes']+2*GIB:
        raise ValueError('Insufficient disk for download/container/originals/IDB fallback +2GiB')
    installed(policy, state, serial)
    reserve(state, 'push-seed')
    _push_permit = (str(file), REMOTE)
    adb(serial, 'push', str(file), REMOTE, timeout=1800)
    checksum = adb(serial, 'shell', 'sha256sum', REMOTE, timeout=1800).split()[0]
    if checksum != value['sha256']:
        raise ValueError('Device seed hash mismatch; never import')
    result = dict(staged=True, bytes=value['bytes'], sha256=checksum, maxEstimatedBytes=4*value['bytes']+2*GIB)
    (state / 'push-seed-result.json').write_text(json.dumps(result), encoding='utf8')
    return result


def screen_xml(state, serial):
    # Any title/body/picker filename stays under the private QA root.
    adb(serial, 'shell', 'uiautomator', 'dump', '/sdcard/Download/.shiye-fullseed-qa-ui.xml')
    raw = adb(serial, 'shell', 'cat', '/sdcard/Download/.shiye-fullseed-qa-ui.xml')
    (state / 'last-ui.xml').write_text(raw, encoding='utf8')
    return ET.fromstring(raw)


def click_label(state, serial, labels, attempts=1, scroll=False):
    global _tap_permit, _swipe_permit
    for attempt in range(attempts):
        tree = screen_xml(state, serial)
        found = [n for n in tree.iter('node') if n.get('enabled') == 'true' and (n.get('text') in labels or n.get('content-desc') in labels)]
        if len(found) == 1:
            n = found[0]
            bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
            if not bounds:
                raise ValueError('No bounded native selector target')
            x1, y1, x2, y2 = map(int, bounds.groups())
            if x2 <= x1 or y2 <= y1:
                raise ValueError('Offscreen target; no guessed tap')
            _tap_permit = (str((x1+x2)//2), str((y1+y2)//2))
            adb(serial, 'shell', 'input', 'tap', *_tap_permit)
            return
        if len(found) > 1:
            raise ValueError('Ambiguous UI target; no guessed tap')
        if scroll and attempt < 3:
            containers = [n for n in tree.iter('node') if n.get('scrollable') == 'true' and n.get('package') == PACKAGE]
            if len(containers) == 1:
                bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', containers[0].get('bounds', ''))
                if bounds:
                    x1, y1, x2, y2 = map(int, bounds.groups())
                    if x2 > x1 and y2-y1 > 100:
                        _swipe_permit = (str((x1+x2)//2), str(y2-(y2-y1)//5), str((x1+x2)//2), str(y1+(y2-y1)//5), '350')
                        adb(serial, 'shell', 'input', 'swipe', *_swipe_permit)
        time.sleep(.5)
    raise ValueError('Expected native UI selector not visible; private XML retained')


def ui_step(policy, state, serial, action):
    binding = seed_binding(state) if action in ['select-seed', 'confirm-pin', 'cold-open-after-import', 'cold-open-after-edit'] else None
    inspect(policy, serial)
    installed(policy, state, serial)
    if action == 'launch' or action.startswith('cold-open-after-'):
        if action != 'launch':
            evidence = json.loads((state / 'last-qa-summary.json').read_text(encoding='utf8'))
            if time.time()-evidence['checkedAt'] > 300 or not evidence.get('initialized') or not evidence.get('pinned') or any(evidence.get(k) != binding[k] for k in ['libraryId', 'epoch', 'keyFingerprintSha256']):
                raise ValueError('Fresh committed same-identity/pin QA readback required before cold close')
            if action == 'cold-open-after-edit' and not evidence.get('pending', 0):
                raise ValueError('Durable local edit/outbox readback required before cold close')
            reserve(state, action)
            adb(serial, 'shell', 'am', 'force-stop', PACKAGE)
        adb(serial, 'shell', 'am', 'start', '-n', PACKAGE+'/dev.shiye.app.MainActivity')
    elif action == 'open-picker':
        click_label(state, serial, ['思绪阅读列表'], 20)
        click_label(state, serial, ['设置'], 20)
        click_label(state, serial, ['设置：数据与关于'], 8, scroll=True)
        click_label(state, serial, ['设置：导入电脑资料'], 8)
        click_label(state, serial, ['选择电脑资料包'], 40)
    elif action == 'open-downloads':
        tree = screen_xml(state, serial)
        packages = {n.get('package') for n in tree.iter('node') if n.get('package')}
        if not packages or not packages.issubset({'com.android.documentsui', 'com.google.android.documentsui', 'com.android.systemui'}):
            raise ValueError('Expected real system DocumentsUI picker; no alternate URI injection')
        click_label(state, serial, ['Show roots', '显示根目录', 'Open navigation drawer', '打开导航抽屉'])
        click_label(state, serial, ['Downloads', '下载'], 6)
    elif action == 'select-seed':
        value = binding
        if not (state / 'push-seed-result.json').exists():
            raise ValueError('Seed has not been guarded-staged')
        receipt = json.loads((state / 'push-seed-result.json').read_text())
        if not receipt.get('staged') or receipt.get('sha256') != value['sha256']:
            raise ValueError('Seed staging did not succeed with exact expected hash')
        # Only fixed filename; never pick arbitrary source documents.
        click_label(state, serial, ['shiye-fullseed-import.syseed'], 2)
        return dict(selected=True, expectedFingerprint=value['keyFingerprintSha256'])
    elif action == 'confirm-pin':
        value = binding
        raw = ET.tostring(screen_xml(state, serial), encoding='unicode')
        if not all(value[k] in raw for k in ['libraryId', 'epoch', 'packageId', 'keyFingerprintSha256']):
            raise ValueError('Full verified identity/fingerprint not visible; no trust click')
        click_label(state, serial, ['导入目标资料库'])
        click_label(state, serial, ['使用此已验证资料库（原库保留）', '使用当前同身份资料库'], 4)
        click_label(state, serial, ['明确确认公钥指纹'])
        click_label(state, serial, ['确认指纹并导入'])
    elif action == 'open-qa':
        pid = adb(serial, 'shell', 'pidof', PACKAGE).strip()
        if not re.fullmatch('[1-9][0-9]*', pid):
            raise ValueError('Unique reviewed QA process required')
        socket = 'localabstract:webview_devtools_remote_'+pid
        for line in adb(serial, 'forward', '--list').splitlines():
            columns = line.split()
            if len(columns) == 3 and columns[1] == 'tcp:19482' and columns != [SERIAL, 'tcp:19482', socket]:
                raise ValueError('Fixed CDP port is owned by another target')
        adb(serial, 'forward', 'tcp:19482', socket)
        try:
            result = subprocess.check_output(['node', str(HERE / 'qa-cdp.mjs')], text=True, timeout=30)
            summary = json.loads(result)
            if summary.get('networkLocked') is not True:
                raise ValueError('Only the local network-locked QA view is allowed')
            (state / 'last-qa-summary.json').write_text(json.dumps(dict(summary, checkedAt=time.time())), encoding='utf8')
            return summary
        finally:
            adb(serial, 'forward', '--remove', 'tcp:19482')
    elif action == 'observe':
        tree = screen_xml(state, serial)
        (state / 'last-screen.png').write_bytes(adb(serial, 'exec-out', 'screencap', '-p', binary=True))
        return dict(privateCapture=True, nodes=sum(1 for _ in tree.iter('node')), noPublicContent=True)
    else:
        raise ValueError('No arbitrary UI or adb action')
    return dict(requested=action, noRemoteWrite=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['plan', 'prelaunch-check', 'inspect', 'install-once', 'verify-install-readonly', 'push-seed', 'launch', 'open-picker', 'open-downloads', 'select-seed', 'confirm-pin', 'observe', 'open-qa', 'cold-open-after-import', 'cold-open-after-edit'])
    parser.add_argument('--serial', required=True)
    args = parser.parse_args()
    validate_serial(args.serial)  # precedes every subprocess / device operation
    policy = read_policy()
    if args.action in ['plan', 'prelaunch-check']:
        resource = resource_status()
        validate_resources(resource)
        guard = load_guard(policy)
        guard.validate_marker(json.loads((guard.ROOT / 'owner-marker.json').read_text(encoding='utf8')))
        result = dict(candidateOnly=True, emulatorStarted=False, installAttempted=False, resource=resource)
    else:
        state = approval(policy)
        if args.action == 'inspect':
            result = inspect(policy, args.serial)
        elif args.action == 'install-once':
            result = install_once(policy, state, args.serial)
        elif args.action == 'verify-install-readonly':
            result = verify_install_readonly(policy, state, args.serial)
        elif args.action == 'push-seed':
            result = push_seed(policy, state, args.serial)
        else:
            result = ui_step(policy, state, args.serial, args.action)
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
