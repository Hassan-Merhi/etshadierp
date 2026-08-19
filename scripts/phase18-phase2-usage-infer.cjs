const ts=require('typescript'),fs=require('fs'),path=require('path');
const root=process.cwd();
const cp=ts.findConfigFile(root,ts.sys.fileExists,'tsconfig.json');
const cf=ts.readConfigFile(cp,ts.sys.readFile);
const pc=ts.parseJsonConfigFileContent(cf.config,ts.sys,path.dirname(cp));
const program=ts.createProgram(pc.fileNames,pc.options);
const checker=program.getTypeChecker();
const fmt=ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope|ts.TypeFormatFlags.UseFullyQualifiedType;
const targets=new Map(),byDecl=new Map(),editsByFile=new Map();
const sourceOk=sf=>{const rel=path.relative(root,sf.fileName).replaceAll('\\','/');return !sf.isDeclarationFile&&!rel.startsWith('node_modules/')&&(/^(client\/src|server|shared)\//).test(rel)&&/\.(ts|tsx)$/.test(rel)};
const hasAny=n=>{let found=false;const v=x=>{if(x.kind===ts.SyntaxKind.AnyKeyword)found=true;else if(!found)ts.forEachChild(x,v)};if(n)v(n);return found};
const key=n=>n&&n.getSourceFile?n.getSourceFile().fileName+':'+n.pos:'';
const resolve=s=>s&&(s.flags&ts.SymbolFlags.Alias)?checker.getAliasedSymbol(s):s;
function targetForFunction(fn){const arr=[];for(let i=0;i<(fn.parameters?.length||0);i++){const p=fn.parameters[i];if(!p.type||!hasAny(p.type))continue;const t={node:p,typeNode:p.type,candidates:[],index:i,owner:fn};targets.set(key(p),t);arr[i]=t;}if(arr.some(Boolean))byDecl.set(key(fn),arr)}
for(const sf of program.getSourceFiles())if(sourceOk(sf)){const walk=n=>{if(ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n)||ts.isArrowFunction(n)||ts.isMethodDeclaration(n)||ts.isConstructorDeclaration(n)||ts.isGetAccessor(n)||ts.isSetAccessor(n))targetForFunction(n);ts.forEachChild(n,walk)};walk(sf)}
function actualType(n){if(!n)return null;let t=checker.getTypeAtLocation(n);if(t&&t.isLiteral?.())t=checker.getBaseTypeOfLiteralType(t);return t}
function safeText(t,ctx){if(!t)return null;const bad=ts.TypeFlags.Any|ts.TypeFlags.Unknown|ts.TypeFlags.Never;if(t.flags&bad)return null;if(t.isLiteral?.())t=checker.getBaseTypeOfLiteralType(t);let s;try{s=checker.typeToString(t,ctx,fmt)}catch{return null}if(!s||s.length>500||/(^|\W)any(\W|$)/.test(s)||s.includes('__type')||s.includes('/home/runner/'))return null;return s}
function add(trg,type,ctx){if(!trg||!type)return;const s=safeText(type,ctx||trg.node);if(s&&!trg.candidates.includes(s))trg.candidates.push(s)}
function declOfFunctionExpr(expr){if(!expr)return null;if(ts.isArrowFunction(expr)||ts.isFunctionExpression(expr))return expr;let sym=resolve(checker.getSymbolAtLocation(expr));if(!sym)return null;for(const d of sym.declarations||[]){if(ts.isFunctionDeclaration(d)||ts.isMethodDeclaration(d))return d;if(ts.isVariableDeclaration(d)&&d.initializer&&(ts.isArrowFunction(d.initializer)||ts.isFunctionExpression(d.initializer)))return d.initializer;if(ts.isPropertyDeclaration(d)&&d.initializer&&(ts.isArrowFunction(d.initializer)||ts.isFunctionExpression(d.initializer)))return d.initializer}return null}
function signatures(t){if(!t)return[];let out=[...t.getCallSignatures()];if(t.isUnionOrIntersection?.())for(const x of t.types)out.push(...x.getCallSignatures());return out}
function feedExpectedCallback(expr,expected){if(!expr||!expected)return;const fn=declOfFunctionExpr(expr);if(!fn)return;const arr=byDecl.get(key(fn));if(!arr)return;for(const sig of signatures(expected)){const ps=sig.getParameters();for(let i=0;i<arr.length;i++){const trg=arr[i];if(!trg)continue;const p=ps[Math.min(i,ps.length-1)];if(p)add(trg,checker.getTypeOfSymbolAtLocation(p,expr),trg.node)}}}
for(const sf of program.getSourceFiles())if(sourceOk(sf)){const walk=n=>{
 if(ts.isCallExpression(n)||ts.isNewExpression(n)){const sig=checker.getResolvedSignature(n),args=n.arguments||[];if(sig){const d=sig.declaration,arr=d&&byDecl.get(key(d));if(arr)for(let i=0;i<args.length;i++){const trg=arr[Math.min(i,arr.length-1)];if(trg)add(trg,actualType(args[i]),trg.node)}const ps=sig.getParameters();for(let i=0;i<args.length;i++){const p=ps[Math.min(i,ps.length-1)];if(!p)continue;feedExpectedCallback(args[i],checker.getTypeOfSymbolAtLocation(p,args[i]))}}}
 ts.forEachChild(n,walk)};walk(sf)}
let edits=0;
for(const trg of targets.values()){const uniq=[...new Set(trg.candidates)].filter(Boolean);if(!uniq.length||uniq.length>6)continue;let text=uniq.length===1?uniq[0]:uniq.map(x=>x.includes('|')?`(${x})`:x).join(' | ');if(!text||/(^|\W)any(\W|$)/.test(text))continue;const sf=trg.node.getSourceFile(),rel=path.relative(root,sf.fileName).replaceAll('\\','/');const list=editsByFile.get(rel)||[];list.push({start:trg.typeNode.getStart(sf),end:trg.typeNode.end,replacement:text});editsByFile.set(rel,list);edits++}
for(const [rel,list] of editsByFile){const file=path.join(root,rel),sf=program.getSourceFile(file);let text=sf.text;list.sort((a,b)=>b.start-a.start);for(const e of list)text=text.slice(0,e.start)+e.replacement+text.slice(e.end);fs.writeFileSync(file,text)}
fs.writeFileSync('.phase18-phase2.files',[...editsByFile.keys()].sort().join('\n')+(editsByFile.size?'\n':''));
console.log(`PHASE2_TARGETS=${targets.size} EDITS=${edits} FILES=${editsByFile.size}`);
