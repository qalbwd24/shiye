import copy
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import driver


class DriverTests(unittest.TestCase):
    def setUp(self):
        driver._install_permit = False
        driver._push_permit = None
        driver._tap_permit = None

    def test_foreign_or_default_serial_before_any_call(self):
        for serial in ['', None, 'emulator-5554', 'emulator-5580', 'DEVICE-SERIAL-0001', 'emulator-5582 ']:
            with self.subTest(serial=serial), patch.object(driver.subprocess, 'check_output') as run:
                with self.assertRaises(ValueError):
                    driver.adb(serial, 'install', 'anything.apk')
                run.assert_not_called()

    def test_cli_wrong_serial_before_policy_or_resources(self):
        with patch('sys.argv', ['driver.py', 'install-once', '--serial', 'emulator-5554']), patch.object(driver, 'read_policy') as policy, patch.object(driver, 'resource_status') as resource:
            with self.assertRaises(ValueError):
                driver.main()
            policy.assert_not_called()
            resource.assert_not_called()

    def test_budget_exact_edges_and_no_generic_writes(self):
        baseline = dict(diskFreeBytes=96*driver.GIB, physicalAvailableBytes=3*driver.GIB, commitAvailableBytes=int(4.5*driver.GIB))
        driver.validate_resources(baseline)
        for field in baseline:
            low = dict(baseline)
            low[field] -= 1
            with self.assertRaises(ValueError):
                driver.validate_resources(low)
        forbidden = [('shell', 'pm', 'clear', driver.PACKAGE), ('reboot',), ('uninstall', driver.PACKAGE), ('install', 'other.apk'), ('install', str(driver.HERE/'Shiye-FullSeed-Data-QA.apk')), ('reverse', 'tcp:18765', 'tcp:18765'), ('forward', 'tcp:19483', 'tcp:18765'), ('shell', 'rm', '/sdcard/a'), ('shell', 'input', 'text', 'arbitrary')]
        with patch.object(driver.subprocess, 'check_output') as run:
            for command in forbidden:
                with self.subTest(command=command), self.assertRaises(ValueError):
                    driver.adb(driver.SERIAL, *command)
            run.assert_not_called()

    def test_installer_permit_is_consumed_before_subprocess(self):
        with patch.object(driver.subprocess, 'check_output', return_value='Success') as run:
            driver._install_permit = True
            driver.adb(driver.SERIAL, 'install', str(driver.HERE/'Shiye-FullSeed-Data-QA.apk'))
            with self.assertRaises(ValueError):
                driver.adb(driver.SERIAL, 'install', str(driver.HERE/'Shiye-FullSeed-Data-QA.apk'))
            self.assertEqual(run.call_count, 1)

    def test_install_timeout_consumes_durable_attempt_and_cannot_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            state = pathlib.Path(directory)
            policy = dict(apkFile='Shiye-FullSeed-Data-QA.apk', apkSha256='a'*64)
            calls = []
            def adb(serial, *args, **kwargs):
                calls.append(args)
                if args[0] == 'install':
                    raise subprocess.TimeoutExpired('fixed install', 180)
                return ''
            with patch.object(driver, 'inspect'), patch.object(driver, 'verify_apk_signature'), patch.object(driver, 'adb', side_effect=adb):
                with self.assertRaises(subprocess.TimeoutExpired):
                    driver.install_once(policy, state, driver.SERIAL)
                with self.assertRaisesRegex(ValueError, 'already consumed'):
                    driver.install_once(policy, state, driver.SERIAL)
            self.assertEqual(sum(c[0] == 'install' for c in calls), 1)
            self.assertFalse(json.loads((state/'install-result.json').read_text())['success'])

    def test_existing_package_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            state = pathlib.Path(directory)
            with patch.object(driver, 'inspect'), patch.object(driver, 'verify_apk_signature'), patch.object(driver, 'adb', return_value='package:/data/app/existing/base.apk') as adb:
                with self.assertRaisesRegex(ValueError, 'already exists'):
                    driver.install_once(dict(apkFile='Shiye-FullSeed-Data-QA.apk'), state, driver.SERIAL)
                self.assertEqual(adb.call_count, 1)
                self.assertFalse((state/'install-attempt.json').exists())

    def test_certificate_must_be_unique_exact(self):
        policy = dict(apkFile='Shiye-FullSeed-Data-QA.apk', certificateSha256='a'*64)
        for value in ['', 'Signer #1 certificate SHA-256 digest: '+'b'*64, 'Signer #1 certificate SHA-256 digest: '+'a'*64+'\nSigner #2 certificate SHA-256 digest: '+'a'*64]:
            with patch.object(driver.subprocess, 'check_output', return_value=value), self.assertRaises(ValueError):
                driver.verify_apk_signature(policy)
        with patch.object(driver.subprocess, 'check_output', return_value='Signer #1 certificate SHA-256 digest: '+'a'*64):
            driver.verify_apk_signature(policy)

    def test_locator_forbids_formal_and_unbounded_urls(self):
        for value in ['', 'http://127.0.0.1:19483']:
            driver.validate_private_locator('<map><string name="baseUrl">'+value+'</string></map>')
        for value in ['http://127.0.0.1:18765', 'https://formal.example', 'http://127.0.0.1:19484', 'http://127.0.0.1:19483/path', 'http://100.77.215.104:18765']:
            with self.assertRaises(ValueError):
                driver.validate_private_locator('<map><string name="baseUrl">'+value+'</string></map>')

    def test_no_blind_or_ambiguous_trust_click(self):
        with tempfile.TemporaryDirectory() as directory:
            state = pathlib.Path(directory)
            tree = driver.ET.fromstring('<hierarchy><node enabled="true" text="确认指纹并导入" bounds="[1,1][10,10]"/></hierarchy>')
            with patch.object(driver, 'inspect'), patch.object(driver, 'installed'), patch.object(driver, 'seed_binding', return_value=dict(libraryId='expected-lib', epoch='expected-epoch', packageId='expected-package', keyFingerprintSha256='a'*64)), patch.object(driver, 'screen_xml', return_value=tree), patch.object(driver, 'click_label') as click:
                with self.assertRaisesRegex(ValueError, 'not visible'):
                    driver.ui_step({}, state, driver.SERIAL, 'confirm-pin')
                click.assert_not_called()
            duplicate = driver.ET.fromstring('<hierarchy><node enabled="true" text="设置" bounds="[1,1][10,10]"/><node enabled="true" text="设置" bounds="[1,1][10,10]"/></hierarchy>')
            with patch.object(driver, 'screen_xml', return_value=duplicate), patch.object(driver, 'adb') as adb, self.assertRaisesRegex(ValueError, 'Ambiguous'):
                driver.click_label(state, driver.SERIAL, ['设置'])
            adb.assert_not_called()

    def test_no_review_approval_before_any_device_action(self):
        with patch('sys.argv', ['driver.py', 'install-once', '--serial', driver.SERIAL]), patch.object(driver, 'read_policy', return_value={}), patch.object(driver, 'approval', side_effect=ValueError('not approved')), patch.object(driver.subprocess, 'check_output') as run:
            with self.assertRaisesRegex(ValueError, 'not approved'):
                driver.main()
            run.assert_not_called()

    def test_policy_hash_and_package_are_pinned_without_subprocess(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            (root/'Shiye-FullSeed-Data-QA.apk').write_bytes(b'synthetic reviewed APK')
            (root/'guard.py').write_text('original guard')
            (root/'input-manifest.json').write_text('{}')
            policy=dict(packageId=driver.PACKAGE,serial=driver.SERIAL,apkFile='Shiye-FullSeed-Data-QA.apk',apkSha256=driver.digest(root/'Shiye-FullSeed-Data-QA.apk'),environmentGuard=str(root/'guard.py'),environmentGuardSha256=driver.digest(root/'guard.py'),inputManifestSha256=driver.digest(root/'input-manifest.json'),candidateId='full-seed-data-1792451236003',privateState=str(root/'private/full-seed-data-1792451236003'))
            def write(value): (root/'driver-policy.json').write_text(json.dumps(value))
            write(policy)
            with patch.object(driver,'HERE',root),patch.object(driver,'ENV_GUARD',root/'guard.py'),patch.object(driver.subprocess,'check_output') as run:
                driver.read_policy()
                for field,value in [('packageId','dev.shiye.app'),('apkFile','ordinary.apk'),('apkSha256','0'*64),('environmentGuardSha256','0'*64),('inputManifestSha256','0'*64),('privateState','D:/elsewhere')]:
                    changed=dict(policy);changed[field]=value;write(changed)
                    with self.assertRaises(ValueError): driver.read_policy()
                run.assert_not_called()

    def test_process_duplicate_target_sdk_and_marker_still_fixed(self):
        path = pathlib.Path(__file__).resolve().parents[2] / 'tmp/full-seed-data-qa/guard.py'
        if not path.exists():
            path = pathlib.Path('D:/拾页/tmp/full-seed-data-qa/guard.py')
        spec = importlib.util.spec_from_file_location('original_guard_test', path)
        guard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(guard)
        good = dict(ProcessId=123, ExecutablePath=guard.QEMU, CommandLine=f'"{guard.QEMU}" -avd {guard.AVD} -port 5582 -no-window')
        driver.validate_process_set([good], good, guard)
        for values in [[good, dict(good, ProcessId=456)], [dict(good, ExecutablePath='D:/wrong.exe')], [dict(good, CommandLine=good['CommandLine']+' -data other')]]:
            with self.assertRaises(ValueError):
                driver.validate_process_set(values, good, guard)
        marker = json.loads((guard.ROOT/'owner-marker.json').read_text())
        for field, value in [('owner', 'other'), ('serial', 'emulator-5554'), ('installEnabled', True)]:
            changed = copy.deepcopy(marker)
            changed[field] = value
            with self.assertRaises(ValueError):
                guard.validate_marker(changed)


if __name__ == '__main__':
    unittest.main()
