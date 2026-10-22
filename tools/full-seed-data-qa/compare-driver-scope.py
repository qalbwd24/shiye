import ast,hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parent
old=pathlib.Path('D:/拾页/outputs/2026-10-19-full-seed-data-qa/candidate-1792451236003/driver.py');new=root/'driver.py'
a,b=ast.parse(old.read_text(encoding='utf-8-sig')),ast.parse(new.read_text(encoding='utf-8-sig'))
functions=lambda tree:{n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
x,y=functions(a),functions(b);changed=sorted(k for k in x if x[k]!=y.get(k));added=sorted(set(y)-set(x));assert changed==['approval','push_seed','seed_binding','ui_step'],changed;assert added==['validate_seed_descriptor'],added
constants=lambda tree:{n.targets[0].id:ast.dump(n.value,include_attributes=False)for n in tree.body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)}
c,d=constants(a),constants(b);assert all(d[k]==v for k,v in c.items());assert set(d)-set(c)=={'SEED_FIELDS'}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();report={'oldDriverSha256':sha(old),'newDriverSha256':sha(new),'changedFunctions':changed,'addedFunctions':added,'unchangedFunctions':sorted(k for k in x if k not in changed),'allOldTopLevelConstantsUnchanged':True,'installAndAdbPermitFunctionsUnchanged':True,'reusedEvidence':['fullseed-qa-driver12.log','independent-fullseed-driver.log'],'notRerunUnchangedScope':True}
(root/'driver-scope.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps({'changed':changed,'new':added,'unchangedFunctions':len(report['unchangedFunctions'])}))
