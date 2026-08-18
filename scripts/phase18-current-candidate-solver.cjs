const ts=require('typescript'),fs=require('fs'),path=require('path');
const root=process.cwd();
const cp=ts.findConfigFile(root,ts.sys.fileExists,'tsconfig.json');
const cf=ts.readConfigFile(cp,ts.sys.readFile);
const pc=ts.parseJsonConfigFileContent(cf.config,ts.sys,path.dirname(cp));
const files=pc.fileNames.filter(f=>{const r=path.relative(root,f).replaceAll('\\','/');return /^(client\/src|server|shared)\//.test(r)&&/\.(ts|tsx)$/.test(r)&&!r.endsWith('.d.ts')&&fs.existsSync(f)});
const state=new Map(pc.fileNames.filter(fs.existsSync).map(f=>[path.resolve(f),{text:fs.readFileSync(f,'utf8'),version:0}]));
const host={getCompilationSettings:()=>pc.options,getScriptFileNames:()=>pc.fileNames,getScriptVersion:f=>String(state.get(path.resolve(f))?.version??0),getScriptSnapshot:f=>{const e=state.get(path.resolve(f));if(e)return ts.ScriptSnapshot.fromString(e.text);if(fs.existsSync(f))return ts.ScriptSnapshot.fromString(fs.readFileSync(f,'utf8'))},getCurrentDirectory:()=>root,getDefaultLibFileName:o=>ts.getDefaultLibFilePath(o),fileExists:ts.sys.fileExists,readFile:ts.sys.readFile,readDirectory:ts.sys.readDirectory,directoryExists:ts.sys.directoryExists,getDirectories:ts.sys.getDirectories,realpath:ts.sys.realpath};
const ls=ts.createLanguageService(host,ts.createDocumentRegistry());
const set=(f,t)=>{const k=path.resolve(f),e=state.get(k)||{text:fs.readFileSync(f,'utf8'),version:0};e.text=t;e.version++;state.set(k,e)};
const diags=f=>[...ls.getSyntacticDiagnostics(f),...ls.getSemanticDiagnostics(f)];
const apply=(text,e)=>text.slice(0,e.start)+e.repl+text.slice(e.end);
function candidates(node,sf){
  const p=node.parent,pp=p?.parent,out=[];
  const add=(start,end,repl,label)=>out.push({start,end,repl,label});
  add(node.getStart(sf),node.end,'unknown','unknown');
  if((ts.isAsExpression(p)||ts.isTypeAssertionExpression(p))&&p.type===node)add(p.getStart(sf),p.end,`(${p.expression.getText(sf)})`,'remove-cast');
  if((ts.isVariableDeclaration(p)||ts.isParameter(p)||ts.isPropertyDeclaration(p))&&p.type===node&&p.initializer)add(p.name.end,p.type.end,'','infer-annotation');
  if(ts.isTypeReferenceNode(p)&&p.typeArguments?.length===1&&p.typeArguments[0]===node&&p.typeName.getText(sf)==='Promise')add(node.getStart(sf),node.end,'unknown','promise-unknown');
  return out;
}
let seen=0,accepted=0,changed=0,labels={};
for(const file of files){
  let text=fs.readFileSync(file,'utf8'),fileAccepted=0;
  for(let round=0;round<200;round++){
    const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS),nodes=[];
    const v=n=>{if(n.kind===ts.SyntaxKind.AnyKeyword)nodes.push(n);ts.forEachChild(n,v)};v(sf);
    let progressed=false;
    for(const n of nodes){
      seen++;
      for(const e of candidates(n,sf)){
        const trial=apply(text,e);set(file,trial);
        if(diags(file).length===0){text=trial;accepted++;fileAccepted++;labels[e.label]=(labels[e.label]||0)+1;progressed=true;break}
        set(file,text);
      }
      if(progressed)break;
    }
    if(!progressed)break;
  }
  if(fileAccepted){set(file,text);if(diags(file).length===0){fs.writeFileSync(file,text);changed++;console.log(`SOLVED ${path.relative(root,file).replaceAll('\\','/')} ${fileAccepted}`)}}
}
console.log(`SOLVER seen=${seen} accepted=${accepted} files=${changed} labels=${JSON.stringify(labels)}`);
