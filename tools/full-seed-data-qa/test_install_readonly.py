import hashlib,json,pathlib,subprocess,tempfile,unittest
from unittest.mock import patch
import driver

class ReadOnlyInstallTests(unittest.TestCase):
 def fixture(self,folder):
  state=pathlib.Path(folder);payload=b'synthetic exact reviewed APK';policy={'apkSha256':hashlib.sha256(payload).hexdigest(),'certificateSha256':'a'*64,'apkFile':'Shiye-FullSeed-Data-QA.apk'}
  (state/'install-attempt.json').write_text(json.dumps({'phase':'install','serial':driver.SERIAL,'packageId':driver.PACKAGE,'automaticRetry':False}))
  (state/'install-result.json').write_text(json.dumps({'success':False,'apkSha256':policy['apkSha256'],'serial':driver.SERIAL,'packageId':driver.PACKAGE}))
  (state/'driver-policy.json').write_text(json.dumps({**policy,'privateState':str(state)}));before={f:(state/f).read_bytes()for f in ['install-attempt.json','install-result.json']};return state,payload,policy,before
 def mock_reads(self,state,payload,policy,calls,package=None,cert=None,version=None,wrong_bytes=False):
  def run(command,**kwargs):
   self.assertEqual(command,[driver.ADB,'-s',driver.SERIAL,'shell','pm','path',driver.PACKAGE]);calls.append(command);return subprocess.CompletedProcess(command,0,'package:/data/app/qa/base.apk\n' if package is None else package,'')
  def output(command,**kwargs):
   calls.append(command);target=str(state/'installed-base.apk')
   if command==[driver.ADB,'-s',driver.SERIAL,'pull','/data/app/qa/base.apk',target]:pathlib.Path(target).write_bytes(b'wrong'if wrong_bytes else payload);return'pulled\n'
   if command==[driver.ADB,'-s',driver.SERIAL,'shell','run-as',driver.PACKAGE,'sh','-c',driver.PREFS_READ]:return''
   if command==[driver.SIGNER,'verify','--verbose','--print-certs',target]:return'Signer #1 certificate SHA-256 digest: '+(policy['certificateSha256']if cert is None else cert)+'\n'
   if command==[driver.AAPT,'dump','badging',target]:return"package: name='"+driver.PACKAGE+"' versionCode='1' versionName='"+('0.1.0-fullseed-dataqa-ddc74'if version is None else version)+"'\n"
   raise AssertionError('Unexpected subprocess command: '+repr(command))
  return patch.object(driver.subprocess,'run',side_effect=run),patch.object(driver.subprocess,'check_output',side_effect=output)
 def assert_originals(self,state,before):
  for file,value in before.items():self.assertEqual((state/file).read_bytes(),value)
  self.assertIs(json.loads((state/'install-result.json').read_text())['success'],False)
 def test_original_output_failure_is_preserved_and_install_cannot_repeat(self):
  with tempfile.TemporaryDirectory()as folder:
   state=pathlib.Path(folder);calls=[]
   def adb(serial,*args,**kwargs):calls.append(args);return''if args[0]=='shell'else'additional status\nSuccess\n'
   with patch.object(driver,'verify_apk_signature'),patch.object(driver,'inspect'),patch.object(driver,'adb',side_effect=adb):
    with self.assertRaisesRegex(ValueError,'exact Success'):driver.install_once({'apkFile':'Shiye-FullSeed-Data-QA.apk','apkSha256':'a'*64},state,driver.SERIAL)
    with self.assertRaisesRegex(ValueError,'already consumed'):driver.install_once({},state,driver.SERIAL)
   self.assertEqual(sum(c[0]=='install'for c in calls),1);self.assertFalse(json.loads((state/'install-result.json').read_text())['success']);self.assertFalse(driver._install_permit)
 def test_readonly_identity_chain_preserves_failed_result_and_never_installs(self):
  with tempfile.TemporaryDirectory()as folder:
   state,payload,policy,before=self.fixture(folder);calls=[];run,output=self.mock_reads(state,payload,policy,calls)
   with patch.object(driver,'HERE',state),patch.object(driver,'inspect'),patch.object(driver,'verify_apk_signature'),run,output:
    receipt=driver.verify_install_readonly(policy,state,driver.SERIAL);driver.installed(policy,state,driver.SERIAL)
   self.assertEqual(receipt['installedBaseSha256'],policy['apkSha256']);self.assertEqual(receipt['certificateSha256'],policy['certificateSha256']);self.assertEqual(receipt['versionCode'],1);self.assertEqual(receipt['attemptSha256'],hashlib.sha256(before['install-attempt.json']).hexdigest());self.assertTrue(receipt['noInstallInvoked']);self.assert_originals(state,before)
   self.assertTrue(all('install'not in c and 'clear'not in c and 'uninstall'not in c for c in calls));self.assertFalse(driver._install_permit)
   with patch.object(driver.subprocess,'check_output')as out,self.assertRaisesRegex(ValueError,'already recorded'):driver.verify_install_readonly(policy,state,driver.SERIAL)
   out.assert_not_called()
 def test_missing_package_and_splits_stop_without_verification(self):
  for package in ['', 'package:/data/app/qa/base.apk\npackage:/data/app/qa/split.apk\n']:
   with self.subTest(package=package),tempfile.TemporaryDirectory()as folder:
    state,payload,policy,before=self.fixture(folder);calls=[];run,output=self.mock_reads(state,payload,policy,calls,package=package)
    with patch.object(driver,'HERE',state),patch.object(driver,'inspect'),patch.object(driver,'verify_apk_signature'),run,output,self.assertRaisesRegex(ValueError,'location/splits'):driver.verify_install_readonly(policy,state,driver.SERIAL)
    self.assert_originals(state,before);self.assertFalse((state/'install-readonly-verification.json').exists());self.assertEqual(len(calls),1)
 def test_wrong_bytes_cert_or_package_version_never_yields_receipt(self):
  for options in [{'wrong_bytes':True},{'cert':'b'*64},{'version':'wrong'}]:
   with self.subTest(options=options),tempfile.TemporaryDirectory()as folder:
    state,payload,policy,before=self.fixture(folder);calls=[];run,output=self.mock_reads(state,payload,policy,calls,**options)
    with patch.object(driver,'HERE',state),patch.object(driver,'inspect'),patch.object(driver,'verify_apk_signature'),run,output,self.assertRaises(ValueError):driver.verify_install_readonly(policy,state,driver.SERIAL)
    self.assert_originals(state,before);self.assertFalse((state/'install-readonly-verification.json').exists());self.assertTrue(all('install'not in c for c in calls))
 def test_missing_or_wrong_original_receipts_rejected_before_subprocess(self):
  for file,field,value in [('install-attempt.json','serial','emulator-5554'),('install-attempt.json','automaticRetry',True),('install-result.json','apkSha256','b'*64),('install-result.json','success',True)]:
   with self.subTest(field=field),tempfile.TemporaryDirectory()as folder:
    state,payload,policy,before=self.fixture(folder);obj=json.loads((state/file).read_text());obj[field]=value;(state/file).write_text(json.dumps(obj))
    with patch.object(driver.subprocess,'check_output')as out,patch.object(driver.subprocess,'run')as run,self.assertRaises(ValueError):driver.verify_install_readonly(policy,state,driver.SERIAL)
    out.assert_not_called();run.assert_not_called()
  with tempfile.TemporaryDirectory()as folder,patch.object(driver.subprocess,'check_output')as out,self.assertRaises(FileNotFoundError):driver.verify_install_readonly({},pathlib.Path(folder),driver.SERIAL)
  out.assert_not_called()
 def test_invalid_verification_chain_cannot_authorize_reads(self):
  with tempfile.TemporaryDirectory()as folder:
   state,payload,policy,before=self.fixture(folder);calls=[];run,output=self.mock_reads(state,payload,policy,calls)
   with patch.object(driver,'HERE',state),patch.object(driver,'inspect'),patch.object(driver,'verify_apk_signature'),run,output:driver.verify_install_readonly(policy,state,driver.SERIAL)
   receipt=json.loads((state/'install-readonly-verification.json').read_text())
   for field,bad in [('attemptSha256','0'*64),('resultSha256','0'*64),('installedBaseSha256','0'*64),('certificateSha256','0'*64),('versionCode',2),('versionCode',True),('noInstallInvoked',False)]:
    (state/'install-readonly-verification.json').write_text(json.dumps({**receipt,field:bad}))
    with self.subTest(field=field),patch.object(driver,'adb')as adb,self.assertRaises(ValueError):driver.installed(policy,state,driver.SERIAL)
    adb.assert_not_called()
   (state/'install-readonly-verification.json').write_text(json.dumps(receipt));(state/'install-result.json').write_text(json.dumps({'success':False,'changed':True}))
   with patch.object(driver,'adb')as adb,self.assertRaises(ValueError):driver.installed(policy,state,driver.SERIAL)
   adb.assert_not_called()

if __name__=='__main__':unittest.main(verbosity=2)
