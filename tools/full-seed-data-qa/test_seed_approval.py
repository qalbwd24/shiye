import copy,hashlib,json,pathlib,tempfile,unittest
from unittest.mock import patch
import driver

class SeedApprovalTests(unittest.TestCase):
 def fixture(self,folder):
  state=pathlib.Path(folder);file=state/'approved.syseed';file.write_bytes(b'synthetic fixed signed-seed binding fixture')
  value={'path':str(file.resolve()),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'libraryId':'11111111-1111-4111-8111-111111111111','epoch':'22222222-2222-4222-8222-222222222222','packageId':'33333333-3333-4333-8333-333333333333','keyFingerprintSha256':'c'*64}
  self.write(state,value);return state,value
 def write(self,state,value,approved=None):
  (state/'seed-input.json').write_text(json.dumps(value),encoding='utf8');(state/'approval.json').write_text(json.dumps({'approved':True,'approvedSeed':value if approved is None else approved}),encoding='utf8')
 def test_matching_exact_file_hash_and_identity(self):
  with tempfile.TemporaryDirectory()as folder:
   state,value=self.fixture(folder)
   with patch.object(driver.subprocess,'check_output')as run:self.assertEqual(driver.seed_binding(state),value);run.assert_not_called()
 def test_original_independent_different_hash_library_counterexample(self):
  with tempfile.TemporaryDirectory()as folder:
   state,value=self.fixture(folder);changed={**value,'sha256':'b'*64,'libraryId':'44444444-4444-4444-8444-444444444444'};self.write(state,changed,value)
   with self.assertRaisesRegex(ValueError,'differs from independent approval'):driver.seed_binding(state)
 def test_each_field_change_rejected_before_any_adb_or_attempt_consumption(self):
  with tempfile.TemporaryDirectory()as folder:
   state,value=self.fixture(folder);other=state/'other.syseed';other.write_bytes(pathlib.Path(value['path']).read_bytes())
   variants={'path':str(other.resolve()),'bytes':value['bytes']+1,'sha256':'a'*64,'libraryId':'44444444-4444-4444-8444-444444444444','epoch':'55555555-5555-4555-8555-555555555555','packageId':'66666666-6666-4666-8666-666666666666','keyFingerprintSha256':'d'*64}
   for field,changed in variants.items():
    self.write(state,{**value,field:changed},value)
    for action in ['push-seed','select-seed','confirm-pin','cold-open-after-import','cold-open-after-edit']:
     with self.subTest(field=field,action=action),patch.object(driver,'adb')as adb,patch.object(driver,'inspect')as inspect,patch.object(driver,'installed')as installed,patch.object(driver,'reserve')as reserve:
      with self.assertRaises(ValueError):
       if action=='push-seed':driver.push_seed({},state,driver.SERIAL)
       else:driver.ui_step({},state,driver.SERIAL,action)
      adb.assert_not_called();inspect.assert_not_called();installed.assert_not_called();reserve.assert_not_called()
   self.assertFalse((state/'install-attempt.json').exists());self.assertFalse((state/'push-seed-attempt.json').exists())
 def test_missing_or_unapproved_or_malformed_descriptor(self):
  with tempfile.TemporaryDirectory()as folder:
   state,value=self.fixture(folder)
   for field in driver.SEED_FIELDS:
    changed=copy.deepcopy(value);del changed[field];self.write(state,changed,value)
    with self.subTest(missingInput=field),self.assertRaises(ValueError):driver.seed_binding(state)
    self.write(state,value,changed)
    with self.subTest(missingApproval=field),self.assertRaises(ValueError):driver.seed_binding(state)
   for approved in [{'approved':True},{'approved':False,'approvedSeed':value}]:
    (state/'approval.json').write_text(json.dumps(approved))
    with self.assertRaises(ValueError):driver.seed_binding(state)
   for changed in [{**value,'extra':'unknown'},{**value,'bytes':True},{**value,'path':'relative.syseed'}]:
    self.write(state,changed)
    with self.assertRaises(ValueError):driver.seed_binding(state)
 def test_actual_source_missing_tampered_and_same_size_changed(self):
  with tempfile.TemporaryDirectory()as folder:
   state,value=self.fixture(folder);file=pathlib.Path(value['path']);original=file.read_bytes()
   for content in [b'x',b'x'*len(original)]:
    file.write_bytes(content)
    with self.subTest(size=len(content)),self.assertRaisesRegex(ValueError,'bytes/hash mismatch'):driver.seed_binding(state)
   file.unlink()
   with self.assertRaisesRegex(ValueError,'file unavailable'):driver.seed_binding(state)
 def test_approval_itself_requires_approved_seed_without_any_device(self):
  with tempfile.TemporaryDirectory()as folder:
   state=pathlib.Path(folder);(state/'candidate-manifest.json').write_text('{"artifacts":[]}');policy={'privateState':folder,'apkSha256':'e'*64};(state/'approval.json').write_text(json.dumps({'approved':True,'candidateManifestSha256':driver.digest(state/'candidate-manifest.json'),'apkSha256':'e'*64,'reviewer':'synthetic independent'}))
   with patch.object(driver,'HERE',state),patch.object(driver.subprocess,'check_output')as run,self.assertRaises(ValueError):driver.approval(policy)
   run.assert_not_called()
 def test_source_change_during_hash_is_rejected(self):
  with tempfile.TemporaryDirectory()as folder:
   state,value=self.fixture(folder);file=pathlib.Path(value['path'])
   def changed(_):file.write_bytes(b'changed during verification');return value['sha256']
   with patch.object(driver,'digest',side_effect=changed),self.assertRaisesRegex(ValueError,'changed during verification'):driver.seed_binding(state)

if __name__=='__main__':unittest.main(verbosity=2)
