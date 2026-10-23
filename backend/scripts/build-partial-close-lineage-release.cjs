const fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript'),cp=require('child_process');
const [base,out]=process.argv.slice(2);if(!base||!out||fs.existsSync(out))throw Error('BASE NEW_PACKAGE');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function inventory(root){return Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const f=path.join(e.parentPath||e.path,e.name);return[path.relative(root,f),sha(fs.readFileSync(f))];}).sort(([a],[b])=>a.localeCompare(b)));}
const before=inventory(base);fs.mkdirSync(out,{recursive:true});for(const dir of ['baseline','release'])fs.cpSync(base,path.join(out,dir),{recursive:true});
const reversals=[],sourceHashes={};
function patch(rel,old,next){const p=path.join(out,'release',rel),text=fs.readFileSync(p,'utf8');if(text.split(old).length!==2)throw Error('nonunique patch '+rel);fs.writeFileSync(p,text.replace(old,next));reversals.push({rel,old,next});}
const helpers=[['close-round-match','selectCloseExchangeRound'],['close-account-update','buildCloseAccountUpdate'],['recorded-close-account','replayRecordedCloseAccount'],['recorded-close-round','replayRecordedCloseRound']];
const aliases={selectCloseExchangeRound:'close_round_match_1.selectCloseExchangeRound',buildCloseAccountUpdate:'close_account_update_1.buildCloseAccountUpdate',shouldUpdateClosedAccount:'close_account_update_1.shouldUpdateClosedAccount',reconstructExchangeRounds:'exchange_rounds_1.reconstructExchangeRounds'};
for(const [name,fn]of helpers){const sourcePath=path.join(__dirname,'../src/utils',name+'.ts'),source=fs.readFileSync(sourcePath,'utf8'),rel='utils/'+name+'.js',js=fs.readFileSync(path.join(base,rel),'utf8');sourceHashes[sourcePath]=sha(source);
 const find=(text,kind)=>{const ast=ts.createSourceFile('fragment.'+(kind===ts.ScriptKind.TS?'ts':'js'),text,ts.ScriptTarget.Latest,true,kind);return ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===fn)?.getText(ast);};
 const old=find(js,ts.ScriptKind.JS),src=find(source,ts.ScriptKind.TS);if(!old||!src)throw Error('missing function '+fn);
 let next=ts.transpileModule(src.replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText.trimEnd();
 for(const [key,value]of Object.entries(aliases))if(key!==fn)next=next.replace(new RegExp('\\b'+key+'(?=\\()','g'),'(0, '+value+')');patch(rel,old,next);
}
patch('services/binance-fill-pnl.service.js','size_qty: params.sizeQty,','size_qty: params.sizeQty, partial_reduction: params.partialReduction === true,');
patch('services/binance-fill-pnl.service.js','params.entryOrderId, params.sizeQty);','params.entryOrderId, params.sizeQty, params.partialReduction === true);');
patch('services/position-close.service.js','sizeQty: position.size_qty,','sizeQty: position.size_qty,\n            partialReduction: position.partial_closed === 1,');
patch('services/position-close.service.js','const accountUpdate = (0, close_account_update_1.buildCloseAccountUpdate)({ balance:','const walletAuthoritative = position.partial_closed === 1 && process.env.BINANCE_ENABLED === \'true\';\n        const accountUpdate = (0, close_account_update_1.buildCloseAccountUpdate)({ walletAuthoritative, balance:');
patch('services/position-close.service.js',"binance_enabled: process.env.BINANCE_ENABLED === 'true',","binance_enabled: process.env.BINANCE_ENABLED === 'true', wallet_authoritative: walletAuthoritative,");
for(const rel of new Set(reversals.map(r=>r.rel))){let result=fs.readFileSync(path.join(out,'release',rel),'utf8');for(const r of reversals.filter(r=>r.rel===rel).reverse())result=result.replace(r.next,r.old);if(result!==fs.readFileSync(path.join(base,rel),'utf8'))throw Error('outside patch bytes '+rel);cp.execFileSync(process.execPath,['--check',path.join(out,'release',rel)]);}
for(const name of ['binance-fill-pnl','position-close']){const p=path.join(__dirname,'../src/services',name+'.service.ts');sourceHashes[p]=sha(fs.readFileSync(p));}
const after=inventory(path.join(out,'release')),changedFiles=Object.keys(after).filter(p=>before[p]!==after[p]);if(changedFiles.length!==6)throw Error('expected six files');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles,sourceHashes,outsidePatchByteParity:true,runtimeDeployed:false,environmentChanges:false,behaviorChange:'explicit verified partial-close round lineage and wallet-authoritative account update'},null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({changedFiles,outsidePatchByteParity:true}));
