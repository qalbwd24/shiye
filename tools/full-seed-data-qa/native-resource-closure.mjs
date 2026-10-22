import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const VENDOR_MANIFEST_SHA='028081dcea82fef380fa17b2fc0b203fe25f5acc625a772561267b9a27699506';

// This is the exact frozen MainActivity.Icon mapping, not a generic Java parser.
// Unknown lookup shapes fail the build instead of producing an incomplete APK.
export function requiredNativeDrawableNames(source) {
  assert.equal((source.match(/getIdentifier\(/g)||[]).length,1,'Unexpected native resource lookup surface');
  assert.ok(source.includes('getIdentifier("ms_"+symbol,"drawable",getPackageName())'),'Unknown native drawable lookup');
  const expressions=[...source.matchAll(/String symbol=([^;]+);/g)];
  assert.equal(expressions.length,1,'Exact Icon symbol mapping required');
  const symbols=[...expressions[0][1].matchAll(/[?:]\s*"([a-z_]+)"/g)].map(match=>match[1]);
  assert.equal(symbols.length,10,'Complete ten-symbol Icon mapping required');
  assert.equal(new Set(symbols).size,10,'Distinct native symbols required');
  return symbols.map(symbol=>'ms_'+symbol).sort();
}

export async function collectNativeDrawables(root,source) {
  const names=requiredNativeDrawableNames(source),vendor=path.join(root,'vendor/material-symbols-20261017');
  const raw=await fs.readFile(path.join(vendor,'manifest.json'));
  assert.equal(sha(raw),VENDOR_MANIFEST_SHA,'Frozen icon provenance changed');
  const manifest=JSON.parse(raw),records=new Map(manifest.files.map(row=>['ms_'+row.name,row]));
  return Promise.all(names.map(async name=>{
    const row=records.get(name);assert.ok(row,'Missing required vector provenance: '+name);
    const bytes=await fs.readFile(path.join(vendor,name+'.xml'));
    assert.equal(sha(bytes),row.vectorSha256,'Required drawable bytes changed: '+name);
    const xml=bytes.toString('utf8');
    assert.ok(/<vector\s/.test(xml)&&!/@|<!DOCTYPE|<!ENTITY/.test(xml),'Drawable must have no unresolved resource/external dependencies');
    return {name,bytes,sha256:sha(bytes),file:'native/res/drawable/'+name+'.xml',origin:'frozen-material-symbols:'+manifest.commit};
  }));
}
