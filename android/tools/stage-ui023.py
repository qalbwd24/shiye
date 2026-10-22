from pathlib import Path
import hashlib,json,zipfile,subprocess
root=Path(__file__).resolve().parents[2];stage=root/'tmp/android-chat-ui023/stage';out=root/'outputs/2026-10-19-android-ui023';base=root/'outputs/2026-10-19-android-ui-continuation';m=json.loads((base/'qa-final-stage.json').read_text());release=json.loads((base/'release.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest();apk=root/release['normalApk'];assert release['normalSha256']=='6d5ddc2996e599210e3cf4d572a71de075b69b9df19076760b60f28a5fe2e385';assert sha(apk.read_bytes())==release['normalSha256'];stage.mkdir(parents=True,exist_ok=True);out.mkdir(parents=True,exist_ok=True)
def write(rel,data):
 p=(stage/rel).resolve();assert p.is_relative_to(stage.resolve());p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
for name,h in m['stageHashes'].items():
 if name.startswith('native/'):
  b=(root/'tmp/android-ui-continuation/stage'/name).read_bytes();assert sha(b)==h;write(name,b)
with zipfile.ZipFile(apk) as z:
 for name in z.namelist():
  if name.startswith('assets/') and not name.endswith('/'):write(name,z.read(name))
overlays={
 'android/app/src/main/java/dev/shiye/app/MainActivity.java':'native/java/dev/shiye/app/MainActivity.java',
 'android/app/src/main/java/dev/shiye/app/TelegramFrontend.java':'native/java/dev/shiye/app/TelegramFrontend.java',
 'android/app/src/main/assets/editor.js':'assets/editor.js',
 'android/app/src/main/assets/editor.html':'assets/editor.html',
 'android/app/src/main/assets/editor.css':'assets/editor.css',
 'android/ui-refinement-019/editor.css':'assets/editor019.css',
 'android/telegram-adapter/android-chat.js':'assets/telegram/android-chat.js',
 'android/telegram-adapter/android-chat.css':'assets/telegram/android-chat.css',
 'public/shared/sticker-suggestions.js':'assets/telegram/shared/sticker-suggestions.js',
}
for name in ['view.js','view.css','panels.js','panels.css','recommendations.js','recommendations.css','install.js','sticker-ranking.js','compact-preferences.js','touch-range.js']:
 overlays['android/qq-chat/'+name]='assets/telegram/qq-chat/'+name
sources={}
qa7=root/'outputs/2026-10-19-android-ui023/info-placement/v3'
qa7_manifest=json.loads((qa7/'candidate-manifest.json').read_text(encoding='utf-8'))
assert qa7_manifest['qa6StageManifestSha256']=='fb1ad1d4b82127d939ecbf6517f3e669c024162556c4c34c4e0a7dc4ca01c576'
qa7_files={row['file']:row for row in qa7_manifest['files']}
qa8=root/'outputs/2026-10-19-android-ui023/info-placement/v4'
qa8_manifest=json.loads((qa8/'candidate-manifest.json').read_text(encoding='utf-8'))
assert sha((out/'freeze-pass7/stage-manifest.json').read_bytes())==qa8_manifest['qa7StageManifestSha256']
qa8_css=next(row for row in qa8_manifest['files'] if row['changed'])
assert qa8_css['source']=='android/ui-refinement-019/editor.css'
for source,dest in overlays.items():
 b=(root/source).read_bytes();sources[source]=sha(b)
 if source==qa8_css['source']:
  assert sha(b)==qa8_css['candidateSourceSha256'],f'QA8 source drift: {source}'
  b=(qa8/'qa7-delta'/qa8_css['asset']).read_bytes()
  assert sha(b)==qa8_css['v4DeltaSha256'],f'QA8 delta drift: {source}'
 elif source in qa7_files:
  row=qa7_files[source]
  assert sha(b)==row['candidateSha256'],f'QA7 source drift: {source}'
  b=(qa7/'qa6-delta'/row['qa6Asset']).read_bytes()
  assert sha(b)==row['qa6DeltaSha256'],f'QA7 delta drift: {source}'
 write(dest,b)
qa6_apk=out/'Shiye-UI023-localqa-pass6.apk'
assert sha(qa6_apk.read_bytes())==qa7_manifest['qa6ApkSha256']
dormant=json.loads((out/'freeze-pass6/dormant-runtime-manifest.json').read_text(encoding='utf-8'))
with zipfile.ZipFile(qa6_apk) as z:
 for name,h in dormant['outputs'].items():
  b=z.read(name);assert sha(b)==h,f'QA6 dormant asset drift: {name}';write(name,b)
(out/'dormant-runtime-manifest.json').write_text(json.dumps(dormant,indent=2),encoding='utf-8')
hashes={str(p.relative_to(stage)).replace('\\','/'):sha(p.read_bytes()) for p in sorted(stage.rglob('*')) if p.is_file()};expected=set(m['stageHashes'])|set(overlays.values())|set(dormant['outputs']);assert set(hashes)==expected,'Unexpected files in UI023 isolated stage'
for source,h in sources.items():
 b=(root/source).read_bytes();assert sha(b)==h,'UI source changed during stage';p=out/'source-snapshot'/source;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
receipt={'version':'0.23.0-ui-localqa','versionCode':25,'applicationId':'dev.shiye.uiqa','baselineApk':release['normalApk'],'baselineSha256':release['normalSha256'],'scope':'Local UI QA8: 017 reading right-slot CSS v4 only; sharedMode disabled, no new backend native APIs','sources':sources,'overlays':overlays,'qa8DeltaSha256':{qa8_css['asset']:qa8_css['v4DeltaSha256']},'dormantSources':dormant['sources'],'dormantReuse':{'source':'QA6 APK and freeze-pass6/dormant-runtime-manifest.json, not current workspace backend inputs','qa6ApkSha256':qa7_manifest['qa6ApkSha256'],'outputs':dormant['outputs']},'stageHashes':hashes,'sharedNativeBaselinePreserved':True};(out/'stage-manifest.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps({'files':len(hashes),'activeSources':len(sources),'scope':receipt['scope']}))
