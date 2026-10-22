import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {collectNativeDrawables} from './full-seed-data-qa/native-resource-closure.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const base=path.join(root,'outputs/2026-10-19-android-shared-import-ui/candidate-v3.1');
const data=path.join(root,'outputs/2026-10-19-local-message-edits/client-1792450149596');
const support=path.join(root,'安装包/拾页-Android-0.23.0-测试版.apk');
const id=Date.now(),out=path.join(root,'outputs/2026-10-19-full-seed-data-qa','candidate-'+id),project=path.join(root,'tmp/full-seed-data-build-'+id);
const baseRaw=await fs.readFile(path.join(base,'manifest.json')),dataRaw=await fs.readFile(path.join(data,'data-manifest.json'));
assert.equal(sha(baseRaw),'c7659fe31510baf4f1c583941030af5af8e9e29fe744288cb92b4175d06176f7');
assert.equal(sha(dataRaw),'ddc740abf119fcd747c2e7c5e45cb82c1f115c22be87a9efc1d491483a05743e');
assert.equal(sha(await fs.readFile(support)),'f42a321552fc37b1d462d15a730415da1ab8fe07068eb26869d1c6bc32268fa1');
for(const row of JSON.parse(baseRaw).files)assert.equal(sha(await fs.readFile(path.join(base,row.file))),row.sha256,row.file);
for(const row of JSON.parse(dataRaw).files)assert.equal(sha(await fs.readFile(path.join(data,'sources',row.file))),row.sha256,row.file);
await fs.mkdir(out,{recursive:true});await fs.mkdir(project,{recursive:true});
const stage=path.join(out,'stage'),inputs=new Map();
async function put(file,bytes,origin){const target=path.join(stage,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);inputs.set(file,{file,sha256:sha(bytes),bytes:bytes.length,origin});}
const extract=String.raw`import zipfile,pathlib,hashlib,json,sys
apk,dest,receipt=sys.argv[1:]
rows=[]; seen=set()
with zipfile.ZipFile(apk) as z:
 for item in z.infolist():
  if not item.filename.startswith('assets/') or item.is_dir():continue
  p=pathlib.PurePosixPath(item.filename)
  if '..' in p.parts or '\\' in item.filename or p.is_absolute() or item.filename in seen:raise ValueError('Unsafe/duplicate frozen asset')
  seen.add(item.filename);target=pathlib.Path(dest).joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True)
  digest=hashlib.sha256();count=0
  with z.open(item) as source,target.open('xb') as output:
   while True:
    part=source.read(262144)
    if not part:break
    output.write(part);digest.update(part);count+=len(part)
  if count!=item.file_size:raise ValueError('Asset size')
  rows.append(dict(file=item.filename,sha256=digest.hexdigest(),bytes=count,origin='frozen-support-apk:f42a321552fc37b1d462d15a730415da1ab8fe07068eb26869d1c6bc32268fa1'))
pathlib.Path(receipt).write_text(json.dumps(rows,indent=2),encoding='utf8')
`;
await fs.writeFile(path.join(out,'extract-support-assets.py'),extract);
await exec('python',[path.join(out,'extract-support-assets.py'),support,stage,path.join(out,'support-assets.json')]);
for(const row of JSON.parse(await fs.readFile(path.join(out,'support-assets.json'))))inputs.set(row.file,row);
for(const row of JSON.parse(baseRaw).files.filter(r=>r.file.startsWith('native/')&&r.file.endsWith('.java')))
 await put('native/java/dev/shiye/app/'+path.basename(row.file),await fs.readFile(path.join(base,row.file)),'approved-import-ui-v3.1:'+row.file);
for(const row of JSON.parse(dataRaw).files.filter(r=>r.file.startsWith('android/app/src/main/java/')&&r.file.endsWith('.java')))
 await put('native/java/dev/shiye/app/'+path.basename(row.file),await fs.readFile(path.join(data,'sources',row.file)),'approved-client66:'+row.file);
for(const file of ['shared-import-ui.js','shared-offline-import-ui.js'])await put('assets/telegram/qq-chat/'+file,await fs.readFile(path.join(base,'assets/telegram/qq-chat',file)),'approved-import-ui-v3.1');
const bundle=await fs.readFile(path.join(data,'android-shared-runtime.js'));
assert.equal(sha(bundle),'095e3d978782557b34f66319947a900a370c5f7c59dce53d3575ccfa33c7e181');
await put('assets/telegram/qq-chat/shared-runtime.js',bundle,'approved-client66:android-bundle');
await put('assets/telegram/qq-chat/fullseed-data-qa.js',await fs.readFile(path.join(root,'tools/full-seed-data-qa/qa-page.js')),'QA-only-network-locked-data-view');
await put('native/AndroidManifest.xml',Buffer.from(`<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/><uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/><uses-permission android:name="android.permission.READ_MEDIA_IMAGES"/><uses-permission android:name="android.permission.READ_MEDIA_VIDEO"/><uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED"/><uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/><application android:label="拾页 · 完整资料 Data QA" android:allowBackup="false" android:theme="@style/AppTheme" android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml/qa_network_security"><activity android:name="dev.shiye.app.MainActivity" android:exported="true" android:windowSoftInputMode="adjustResize"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>\n`),'QA-only-generated-manifest');
await put('native/res/values/styles.xml',Buffer.from(`<resources><style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar"><item name="android:fontFamily">sans</item><item name="android:colorAccent">#327DB2</item><item name="android:windowLightStatusBar">true</item><item name="android:windowActionModeOverlay">true</item></style><style name="AppThemeDark" parent="android:style/Theme.Material.NoActionBar"><item name="android:fontFamily">sans</item><item name="android:colorAccent">#87D5FF</item><item name="android:windowActionModeOverlay">true</item></style></resources>\n`),'QA-only-generated-resources');
await put('native/res/xml/qa_network_security.xml',Buffer.from(`<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">localhost</domain><domain includeSubdomains="false">127.0.0.1</domain></domain-config></network-security-config>\n`),'QA-only-loopback-network-resources');
// MainActivity.Icon uses dynamic drawable names: Java/DEX compilation alone
// cannot detect omissions. Freeze the exact referenced vector closure as inputs.
for(const row of await collectNativeDrawables(root,await fs.readFile(path.join(stage,'native/java/dev/shiye/app/MainActivity.java'),'utf8')))
 await put(row.file,row.bytes,row.origin);
const manifest={version:1,candidateId:'full-seed-data-'+id,packageId:'dev.shiye.dataqa.fullseed',versionCode:1,versionName:'0.1.0-fullseed-dataqa-ddc74',namespace:'dev.shiye.app',minSdk:26,targetSdk:35,compileSdk:36,baseImportManifestSha256:sha(baseRaw),dataManifestSha256:sha(dataRaw),supportApkSha256:'f42a321552fc37b1d462d15a730415da1ab8fe07068eb26869d1c6bc32268fa1',files:[...inputs.values()].sort((a,b)=>a.file.localeCompare(b.file)),deviceStarted:false,installed:false};
await fs.writeFile(path.join(out,'input-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(project,'settings.gradle'),`pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name = 'ShiyeFullSeedDataQa'\n`);
await fs.writeFile(path.join(project,'gradle.properties'),'android.useAndroidX=false\norg.gradle.daemon=false\norg.gradle.workers.max=1\nandroid.overridePathCheck=true\norg.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8\n');
await fs.writeFile(path.join(project,'local.properties'),'sdk.dir=D:/codex-tools/android-sdk\n');
const key=path.join(project,'qa-signing.jks');
await exec('D:/codex-tools/android-studio/jbr/bin/keytool.exe',['-genkeypair','-keystore',key,'-storepass','android','-alias','fullseed-data-qa','-keypass','android','-keyalg','RSA','-keysize','2048','-validity','3650','-dname','CN=Shiye FullSeed Data QA, O=Isolated Test, C=CN']);
const slash=p=>p.replaceAll('\\','/');
await fs.writeFile(path.join(project,'build.gradle'),`plugins { id 'com.android.application' version '8.13.2' }\ndef stage=file('${slash(stage)}')\nandroid { namespace 'dev.shiye.app'; compileSdk 36; buildToolsVersion '36.0.0'\n defaultConfig { applicationId '${manifest.packageId}'; minSdk 26; targetSdk 35; versionCode 1; versionName '${manifest.versionName}' }\n compileOptions { sourceCompatibility JavaVersion.VERSION_1_8; targetCompatibility JavaVersion.VERSION_1_8 }\n sourceSets { main { manifest.srcFile new File(stage,'native/AndroidManifest.xml'); java.srcDirs=[new File(stage,'native/java')]; res.srcDirs=[new File(stage,'native/res')]; assets.srcDirs=[new File(stage,'assets')] } }\n signingConfigs { debug { storeFile file('${slash(key)}'); storePassword 'android'; keyAlias 'fullseed-data-qa'; keyPassword 'android' } }\n}\ntasks.register('verifyFrozenInputs') { doLast { def m=new groovy.json.JsonSlurper().parse(file('${slash(path.join(out,'input-manifest.json'))}'));m.files.each { row -> if(java.security.MessageDigest.getInstance('SHA-256').digest(new File(stage,row.file).bytes).encodeHex().toString()!=row.sha256)throw new GradleException('Frozen input drift: '+row.file) } } }\ntasks.named('preBuild').configure { dependsOn tasks.named('verifyFrozenInputs') }\n`);
await fs.mkdir(path.join(out,'build-recipe'),{recursive:true});
for(const file of ['settings.gradle','build.gradle','gradle.properties','local.properties'])await fs.copyFile(path.join(project,file),path.join(out,'build-recipe',file));
await fs.copyFile(import.meta.filename,path.join(out,'build-full-seed-data-qa.mjs'));
await fs.copyFile(path.join(root,'tools/full-seed-data-qa/native-resource-closure.mjs'),path.join(out,'native-resource-closure.mjs'));
await fs.writeFile(path.join(out,'build-locator.json'),JSON.stringify({project,out,stage,gradle:'C:/Users/<用户名>/.gradle/wrapper/dists/gradle-8.13-bin/5xuhj0ry160q40clulazy9h7d/gradle-8.13/bin/gradle.bat',javaHome:'D:/codex-tools/android-build/jdk/jdk-17.0.20.1+1',sourceFiles:inputs.size},null,2)+'\n');
assert.equal(sha(await fs.readFile(support)),manifest.supportApkSha256);
console.log(JSON.stringify({out,project,stage,sourceFiles:inputs.size,inputManifestSha256:sha(await fs.readFile(path.join(out,'input-manifest.json')))},null,2));
