"""Freeze the independent QQ view on 0.16 data/native owners; no live data."""
from pathlib import Path
import base64,hashlib,json,re,zipfile,subprocess
ROOT=Path(__file__).resolve().parents[2]
STAGE=ROOT/'tmp/android-qq-018'
OUT=ROOT/'outputs/2026-10-18-android-qq-018'
BASE=ROOT/'outputs/2026-10-18-android-qq-016/Shiye-Android-0.16.0-623f5665.apk'
NATIVE=ROOT/'outputs/2026-10-18-android-media-014/Android-0.14-owned-sources.zip'
def sha(data): return hashlib.sha256(data).hexdigest()
def write(folder,name,data):
    path=(folder/name).resolve()
    assert path.is_relative_to(folder.resolve())
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(data)
def main():
    OUT.mkdir(parents=True,exist_ok=True)
    subprocess.run(['node','android/tools/stage-qq-content.mjs'],cwd=ROOT,check=True)
    content=json.loads((OUT/'content/stage-manifest.json').read_text(encoding='utf-8'))
    assert sha(BASE.read_bytes())=='623f5665db8e9afeaf871ce0ab0e5aff4500390d5d568cf7daeb137919612752'
    native={}
    with zipfile.ZipFile(NATIVE) as z:
        prefix='android/app/src/main/'
        for name in z.namelist():
            if name.startswith(prefix) and not name.endswith('/') and not name.startswith(prefix+'assets/'):
                data=z.read(name);relative=name[len(prefix):]
                write(STAGE/'native',relative,data);native[relative]=sha(data)
    # This candidate deliberately retains the 0.16 native/storage authority.
    # Only exact chat system-bar color plumbing is added; no backend017 migration.
    mainjava=STAGE/'native/java/dev/shiye/app/MainActivity.java'
    text=mainjava.read_text(encoding='utf-8')
    needle='telegramConversationOpen, telegramDark;'
    assert needle in text
    text=text.replace(needle,'telegramConversationOpen, telegramDark, qqBlueChrome;')
    needle='screen.equals("telegram")?0xffeaf5fc:BG'
    assert needle in text
    text=text.replace(needle,'screen.equals("telegram")?(telegramConversationOpen?(qqBlueChrome?0xffeaf5fc:0xffffffff):0xffeaf5fc):BG')
    needle='  void applyTelegramChrome(String theme)'
    assert needle in text
    text=text.replace(needle,'  void applyQQChromeTone(String tone){boolean blue="blue".equals(tone);if(qqBlueChrome!=blue){qqBlueChrome=blue;updateSystemBars();}}\n'+needle)
    mainjava.write_text(text,encoding='utf-8')
    bridge=STAGE/'native/java/dev/shiye/app/TelegramFrontend.java'
    text=bridge.read_text(encoding='utf-8')
    needle="themeReady:Boolean(window.shiyeAndroidChat?.snapshot?.().preferencesReady),theme:"
    assert needle in text
    text=text.replace(needle,"themeReady:Boolean(window.shiyeAndroidChat?.snapshot?.().preferencesReady),qqChromeTone:document.body.dataset.shiyeQqChromeTone||'white',theme:")
    text=text.replace("attributeFilter:['data-shiye-chat-theme']","attributeFilter:['data-shiye-chat-theme','data-shiye-qq-chrome-tone']")
    needle='if(value.optBoolean("themeReady"))host.applyTelegramChrome(value.optString("theme"));'
    assert needle in text
    text=text.replace(needle,needle+'host.applyQQChromeTone(value.optString("qqChromeTone"));')
    bridge.write_text(text,encoding='utf-8')
    picker=STAGE/'native/java/dev/shiye/app/AttachmentPicker.java'
    text=picker.read_text(encoding='utf-8')
    assert text.count('PAPER = 0xfff2f9fe')==1
    picker.write_text(text.replace('PAPER = 0xfff2f9fe','PAPER = 0xffffffff'),encoding='utf-8')
    originals={}
    with zipfile.ZipFile(BASE) as z:
        for name in z.namelist():
            if name.startswith('assets/') and not name.endswith('/'):
                data=z.read(name);relative=name[7:]
                write(STAGE/'assets',relative,data);originals[relative]=sha(data)
    owned={}
    data=(ROOT/'android/telegram-adapter/android-chat.js').read_bytes()
    write(STAGE/'assets','telegram/android-chat.js',data);owned['android/telegram-adapter/android-chat.js']=sha(data)
    for prior in (STAGE/'assets/telegram/qq-chat').glob('*.test.mjs'):
        assert prior.resolve().is_relative_to((STAGE/'assets').resolve())
        prior.unlink()
    for file in (ROOT/'android/qq-chat').iterdir():
        if not file.is_file() or file.name.endswith('.test.mjs'):continue
        data=file.read_bytes();owned[str(file.relative_to(ROOT)).replace('\\','/')]=sha(data)
        if file.name=='content.js':
            data=(STAGE/'qq-content/content.js').read_bytes()
            assert sha(data)==content['sha256']
        write(STAGE/'assets','telegram/qq-chat/'+file.name,data)
    owned.update(content['sources'])
    # Content URLs in the view's separate same-origin frame are cache-versioned.
    for file in (STAGE/'assets/telegram/qq-chat').glob('*.js'):
        text=file.read_text(encoding='utf-8')
        for asset in ['view.css','panels.css','recommendations.css','shell.html']:
            path=STAGE/'assets/telegram/qq-chat'/asset
            if path.exists():text=text.replace("'./"+asset+"'","'./"+asset+'?v='+sha(path.read_bytes())[:24]+"'")
        file.write_text(text,encoding='utf-8')
    index=STAGE/'assets/telegram/index.html'
    html=index.read_text(encoding='utf-8')
    match=re.search(r'(<script type="importmap" data-shiye-attachment-version="1">)(.*?)(</script>)',html)
    assert match
    old=match[2];mapping=json.loads(old)
    for name in ['android-chat.js',*[str(p.relative_to(STAGE/'assets/telegram')).replace('\\','/') for p in (STAGE/'assets/telegram/qq-chat').glob('*.js')]]:
        digest=sha((STAGE/'assets/telegram'/name).read_bytes())
        mapping['imports']['/telegram/'+name]='/telegram/'+name+'?v='+digest[:24]
    owner=STAGE/'assets/telegram/assets/useConnectionStatus-Dy1kHT8L.js'
    original_owner=owner.read_bytes()
    owner_text=original_owner.decode('utf-8')
    gate='if(o||f||!d.current)return;let i=r?.blocks.length?r:void 0'
    assert owner_text.count(gate)==1, 'Frozen old draft hook changed; audit before patching'
    owner_text=owner_text.replace(gate,'if(o||f||!d.current||globalThis.window?.__shiyeQQDraftOwnerInstalled)return;let i=r?.blocks.length?r:void 0')
    for payload in ['text:void 0,richMessage:i','text:a']:
        before='ts(()=>{c({chatId:e.chatId??t,threadId:e.threadId??n,'+payload+'})})'
        after='ts(()=>{if(!globalThis.window?.__shiyeQQDraftOwnerInstalled)c({chatId:e.chatId??t,threadId:e.threadId??n,'+payload+'})})'
        assert owner_text.count(before)==1, 'Frozen deferred draft callback changed'
        owner_text=owner_text.replace(before,after)
    owner.write_bytes(owner_text.encode('utf-8'))
    mapping['imports']['/telegram/assets/useConnectionStatus-Dy1kHT8L.js']='/telegram/assets/useConnectionStatus-Dy1kHT8L.js?v='+sha(owner.read_bytes())[:24]
    new=json.dumps(mapping,separators=(',',':'))
    csp=lambda s:base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()
    html=html[:match.start(2)]+new+html[match.end(2):]
    html=html.replace('sha256-'+csp(old),'sha256-'+csp(new))
    assert "frame-src 'none'" in html
    html=html.replace("frame-src 'none'","frame-src 'self'")
    html=re.sub(r'android-chat.js\?v=[a-f0-9]+','android-chat.js?v='+sha((STAGE/'assets/telegram/android-chat.js').read_bytes())[:24],html)
    index.write_text(html,encoding='utf-8')
    changes=[name for name,digest in originals.items() if sha((STAGE/'assets'/name).read_bytes())!=digest]
    assert set(changes)=={'telegram/index.html','telegram/android-chat.js','telegram/assets/useConnectionStatus-Dy1kHT8L.js'},changes
    report={'baselineApk':str(BASE.relative_to(ROOT)).replace('\\','/'),'baselineApkSha256':sha(BASE.read_bytes()),'preservedAssets':len(originals)-len(changes),'changedBaselineAssets':changes,'ownedSources':owned,'nativeBaseline':native,'nativeChanges':['java/dev/shiye/app/MainActivity.java','java/dev/shiye/app/TelegramFrontend.java','java/dev/shiye/app/AttachmentPicker.java'],'nativeFinal':{str(p.relative_to(STAGE/'native')).replace('\\','/'):sha(p.read_bytes()) for p in (STAGE/'native').rglob('*') if p.is_file()},'stageHashes':{str(p.relative_to(STAGE/'assets/telegram')).replace('\\','/'):sha(p.read_bytes()) for p in (STAGE/'assets/telegram/qq-chat').glob('*') if p.is_file()},'dataMigration':False,'backend017Included':False}
    report['oldDraftHookGate']={'baselineSha256':sha(original_owner),'sha256':sha(owner.read_bytes()),'replacements':3,'disabledWhen':'independent QQ renderer installed, including room exit/cleanup; new source actions remain enabled'}
    report['patchedAssets']={name:sha((STAGE/'assets'/name).read_bytes()) for name in changes}
    (OUT/'stage-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'preservedAssets':report['preservedAssets'],'ownedFiles':len(owned),'nativeChanges':len(report['nativeChanges'])}))
if __name__=='__main__':main()
