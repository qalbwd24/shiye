import importlib.util,pathlib,subprocess,tempfile,unittest
from unittest.mock import patch
import driver

class PackageAbsentTests(unittest.TestCase):
 def test_original_preinstall_failure_is_reproduced_with_old_driver(self):
  file=pathlib.Path('D:/拾页/outputs/2026-10-19-full-seed-data-qa/driver-seedbound-1792453032478/driver.py');spec=importlib.util.spec_from_file_location('old_pm',file);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
  with patch.object(old.subprocess,'check_output',side_effect=subprocess.CalledProcessError(1,['fixed pm path'],output='')), self.assertRaises(subprocess.CalledProcessError):old.adb(old.SERIAL,'shell','pm','path',old.PACKAGE)
 def test_exact_absent_result_reaches_only_one_durable_install(self):
  with tempfile.TemporaryDirectory()as folder:
   state=pathlib.Path(folder);policy={'apkFile':'Shiye-FullSeed-Data-QA.apk','apkSha256':'a'*64};queries=[];installs=[]
   def run(command,**kwargs):queries.append(command);self.assertEqual(command,[driver.ADB,'-s',driver.SERIAL,'shell','pm','path',driver.PACKAGE]);self.assertTrue(kwargs['text']);return subprocess.CompletedProcess(command,1,'','')
   def install(command,**kwargs):installs.append(command);self.assertEqual(command,[driver.ADB,'-s',driver.SERIAL,'install',str(driver.HERE/policy['apkFile'])]);self.assertTrue((state/'install-attempt.json').exists());return'Success\n'
   with patch.object(driver,'verify_apk_signature'),patch.object(driver,'inspect'),patch.object(driver.subprocess,'run',side_effect=run),patch.object(driver.subprocess,'check_output',side_effect=install):
    self.assertTrue(driver.install_once(policy,state,driver.SERIAL)['success'])
    with self.assertRaisesRegex(ValueError,'already consumed'):driver.install_once(policy,state,driver.SERIAL)
   self.assertEqual(len(queries),1);self.assertEqual(len(installs),1);self.assertFalse(driver._install_permit)
 def test_real_error_or_present_package_never_consumes_install(self):
  for code,stdout,stderr in [(1,'','error: transport offline'),(1,'unexpected',''),(1,'\n',''),(2,'',''),(0,'','failure'),(0,'package:/data/app/x/base.apk\n','')]:
   with self.subTest(code=code,stdout=stdout,stderr=stderr),tempfile.TemporaryDirectory()as folder:
    state=pathlib.Path(folder)
    with patch.object(driver,'verify_apk_signature'),patch.object(driver,'inspect'),patch.object(driver.subprocess,'run',return_value=subprocess.CompletedProcess([],code,stdout,stderr)),patch.object(driver.subprocess,'check_output')as install:
     with self.assertRaises((ValueError,subprocess.CalledProcessError)):driver.install_once({'apkFile':'Shiye-FullSeed-Data-QA.apk'},state,driver.SERIAL)
     install.assert_not_called();self.assertFalse((state/'install-attempt.json').exists());self.assertFalse(driver._install_permit)
 def test_fixed_serial_and_arbitrary_path_still_rejected_before_subprocess(self):
  for serial,args in [('emulator-5554',('shell','pm','path',driver.PACKAGE)),(driver.SERIAL,('shell','pm','path','dev.shiye.app'))]:
   with patch.object(driver.subprocess,'run')as run,patch.object(driver.subprocess,'check_output')as call,self.assertRaises(ValueError):driver.adb(serial,*args)
   run.assert_not_called();call.assert_not_called()

if __name__=='__main__':unittest.main(verbosity=2)
