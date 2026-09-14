"""Offline, strict staging reader for 1Diary 1.96.55 / Windows 1.30.0.

Keeps every original byte; does not claim to produce a finished diary migration.
Usage: backup_reader.py android-backup INPUT.zip NEW_OUTPUT_DIR
       backup_reader.py windows-data INPUT NEW_OUTPUT_DIR
Dependency: cryptography. No network access, no credentials required.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import re
import shutil
import stat
import sys
import zipfile
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

KEYS = {'source.json':'wxaj19sd', 'category.json':'usdfi8op',
        'tag.json':'91knu3nj', 'model.json':'ssd00dsd', 'version':'uqwjhd0l'}
WINDOWS_KEY = '2909246C549D656546C40576393A78802F787959012E551EADE697707B4579C0'
MEDIA_FIELDS = ('images','localImages','audio','localAudio','draw','localDraw')

def sha(path):
    with path.open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()

def unique_object(pairs):
    result = {}
    for key,value in pairs:
        if key in result: raise ValueError('Duplicate JSON property')
        result[key] = value
    return result

def parse_json(raw):
    def invalid(_): raise ValueError('Non-finite JSON number')
    return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=unique_object,
                      parse_constant=invalid)

def decrypt(raw, key, mode):
    if not raw or len(raw)%16: raise ValueError('Invalid AES ciphertext length')
    dec = Cipher(algorithms.AES(key),mode).decryptor()
    padded = dec.update(raw)+dec.finalize()
    unpad = PKCS7(128).unpadder()
    return unpad.update(padded)+unpad.finalize()

def android_decode(raw, name):
    text = raw.decode('utf-8-sig').strip()
    # The app's simple automatic backup writes unencrypted JSON / version.
    if text.startswith(('[','{')) or (name=='version' and text.isdecimal()):
        plain,encoding = raw,'plaintext'
    else:
        cipher = base64.b64decode(''.join(text.split()), validate=True)
        plain = decrypt(cipher, hashlib.sha256(KEYS[name].encode()).digest(), modes.CBC(bytes(16)))
        encoding = 'aes-256-cbc-sha256-zero-iv-base64-pkcs7'
    obj = parse_json(plain)
    if name=='version':
        if type(obj) is not int or obj not in (0,1,2,3):
            raise ValueError('Unsupported backup version')
    elif not isinstance(obj,list) or any(not isinstance(x,dict) for x in obj):
        raise ValueError('Expected array of objects: '+name)
    return plain,obj,encoding

def safe_member(name):
    if '\\' in name or name.startswith('/') or re.match(r'^[a-zA-Z]:',name):
        raise ValueError('Unsafe ZIP member path')
    p = pathlib.PurePosixPath(name)
    if not p.parts or any(part in ('.','..') or part.endswith((' ','.')) or
        re.search(r'[<>:"|?*\x00-\x1f]',part) or
        re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)',part,re.I)
        for part in p.parts): raise ValueError('Unsafe ZIP member name')
    return p

def media_inventory(diaries, members):
    by_name = {}
    for item in members:
        if item['name'] not in KEYS:
            by_name.setdefault(pathlib.PurePosixPath(item['name']).name,[]).append(item['name'])
    refs = []
    for index,entry in enumerate(diaries):
        for field in MEDIA_FIELDS:
            value = entry.get(field)
            if value is None or value=='': continue
            if not isinstance(value,str): raise ValueError('Unknown media field type')
            for position,ref in enumerate(x for x in value.split('|') if x):
                # Exact original Android xb.c.c behavior; do not guess signed URL mappings.
                basename = re.split(r'[/\\]',ref)[-1]
                matches = by_name.get(basename,[])
                refs.append({'entry_index':index,'entry_uuid':entry.get('uuid'),
                    'field':field,'position':position,'original_reference':ref,
                    'candidates':matches,'status': 'candidate_exact_basename' if len(matches)==1
                    else 'ambiguous' if matches else 'unresolved'})
    return refs

def write_json(path,obj):
    path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def stage(mode,src,out):
    src=src.resolve(strict=True); out=out.resolve()
    if not src.is_file(): raise ValueError('Input must be a file')
    if out.exists(): raise FileExistsError('Output directory already exists')
    out.mkdir(parents=True)
    report={'stage_status':'incomplete','input_name':src.name,'input_sha256':sha(src),
            'mode':mode,'scope':'decoded staging only; formatted migration is not verified',
            'real_user_data_verified':False,'members':[],'decoded':{},'warnings':[]}
    try:
        original=out/'original'; original.mkdir()
        copy=original/src.name; shutil.copy2(src,copy)
        if sha(copy)!=report['input_sha256']: raise ValueError('Copy hash mismatch')
        decoded=out/'decoded'; decoded.mkdir()
        if mode=='android-backup':
            with zipfile.ZipFile(copy) as z:
                seen=set(); total=0
                for item in z.infolist():
                    p=safe_member(item.filename); norm=str(p).casefold()
                    if norm in seen: raise ValueError('Duplicate or case-colliding ZIP member')
                    seen.add(norm); total+=item.file_size
                    if stat.S_ISLNK(item.external_attr>>16): raise ValueError('ZIP symlink unsupported')
                if len(seen)>100000 or total>100*1024**3: raise ValueError('Archive exceeds staging limit')
                sources=[i for i in z.infolist() if pathlib.PurePosixPath(i.filename).name=='source.json']
                if len(sources)!=1: raise ValueError('Expected exactly one source.json')
                prefix=pathlib.PurePosixPath(sources[0].filename).parent
                arrays={}
                for item in z.infolist():
                    if item.is_dir(): continue
                    rel=pathlib.PurePosixPath(item.filename)
                    dest=out/'payload'/pathlib.Path(*rel.parts)
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    with z.open(item) as inp,dest.open('xb') as target:
                        shutil.copyfileobj(inp,target,1024*1024)
                    report['members'].append({'name':item.filename,'bytes':item.file_size,'sha256':sha(dest)})
                    if rel.parent==prefix and rel.name in KEYS:
                        if item.file_size>512*1024**2: raise ValueError('Metadata exceeds 512 MiB limit')
                        plain,obj,encoding=android_decode(dest.read_bytes(),rel.name)
                        (decoded/rel.name).write_bytes(plain)
                        arrays[rel.name]=obj
                        report['decoded'][rel.name]={'encoding':encoding,'count':len(obj) if isinstance(obj,list) else obj}
                report['media_references']=media_inventory(arrays['source.json'],report['members'])
                report['unresolved_media_references']=sum(r['status']!='candidate_exact_basename' for r in report['media_references'])
                for key in ('category.json','tag.json','model.json','version'):
                    if key not in arrays: report['warnings'].append('Backup does not contain '+key)
                report['warnings'].append('Media matching is provisional. Body links, background images, cloud-only media and visual fidelity require separate validation.')
        else:
            raw=bytes.fromhex(copy.read_text(encoding='utf-8-sig').strip())
            plain=decrypt(raw,bytes.fromhex(WINDOWS_KEY),modes.ECB())
            obj=parse_json(plain)
            if not isinstance(obj,dict): raise ValueError('Unexpected Windows JSON root')
            for table in ('diaryList','categoryList','modelList','tagList'):
                if not isinstance(obj.get(table),list) or any(not isinstance(x,dict) for x in obj[table]):
                    raise ValueError('Unexpected Windows backup table')
            (decoded/'windows_data.json').write_bytes(plain)
            report['decoded']['windows_data.json']={'encoding':'aes-256-ecb-hex-pkcs7',
                'counts':{k:len(obj[k]) for k in ('diaryList','categoryList','modelList','tagList')}}
            report['warnings'].append('Windows data backup is not a media archive; images/audio require a separate source.')
        report['stage_status']='decoded'
    except Exception as e:
        report['stage_status']='failed'
        report['error_type']=type(e).__name__
        write_json(out/'manifest.json',report)
        raise
    write_json(out/'manifest.json',report)
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=('android-backup','windows-data'))
    p.add_argument('input',type=pathlib.Path); p.add_argument('output',type=pathlib.Path)
    a=p.parse_args()
    try:
        result=stage(a.mode,a.input,a.output)
    except Exception as e:
        print('FAILED: '+type(e).__name__+'. No migration success claimed.',file=sys.stderr)
        return 1
    print('Decoded staging written. Check manifest.json; this is not a completed migration.')
    print(json.dumps(result['decoded'],ensure_ascii=False))
    return 0
if __name__=='__main__': sys.exit(main())
