// Compare compiled function bodies after removing only the new journal and helper-call syntax.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript');
const pkg=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(manifest.changedFiles,['services/protective-order.service.js','utils/protective-action.js','utils/recorded-protective-action.js']);
for(const variant of ['baseline','release'])for(const[f,h]of Object.entries(manifest[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
const parse=(variant,file)=>ts.createSourceFile(file,fs.readFileSync(path.join(pkg,variant,file),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
const file='services/protective-order.service.js',base=parse('baseline',file),release=parse('release',file),helper=parse('release','utils/protective-action.js');
const extracted=new Set(['isPastStopLoss','isPastTakeProfit','tpInvalidForMark','slTpInvalidForMark','evaluateProtectiveAction']);
const functions=sf=>new Map(sf.statements.filter(ts.isFunctionDeclaration).map(node=>[node.name.text,node]));
const b=functions(base),r=functions(release),h=functions(helper),printer=ts.createPrinter({removeComments:true});
const removed={variables:0,assignments:0,markObserved:0,records:0};
const transformed=ts.transform(release,[ctx=>root=>{
 function visit(node){
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.length===1&&['markStatus','recordAction'].includes(node.declarationList.declarations[0].name.getText(release))){removed.variables++;return undefined;}
  if(ts.isIfStatement(node)&&node.thenStatement.getText(release).startsWith("markStatus = 'observed'")){removed.markObserved++;return undefined;}
  if(ts.isExpressionStatement(node)&&ts.isBinaryExpression(node.expression)&&node.expression.left.getText(release)==='markStatus'){removed.assignments++;return undefined;}
  if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(release)==='recordAction'){removed.records++;return undefined;}
  // TypeScript emits imported function calls as (0, module.function)(...).
  if(ts.isCallExpression(node)&&ts.isParenthesizedExpression(node.expression)&&ts.isBinaryExpression(node.expression.expression)){
   const target=node.expression.expression.right;
   if(ts.isPropertyAccessExpression(target)&&target.expression.getText(release)==='protective_action_1'&&extracted.has(target.name.text))
    return ts.factory.updateCallExpression(node,ts.factory.createIdentifier(target.name.text),node.typeArguments,node.arguments.map(arg=>ts.visitNode(arg,visit)));
  }
  return ts.visitEachChild(node,visit,ctx);
 }
 return ts.visitNode(root,visit);
}]);
const cleaned=functions(transformed.transformed[0]);
assert.deepEqual(removed,{variables:2,assignments:1,markObserved:1,records:2});
assert.deepEqual([...b.keys()].filter(k=>!extracted.has(k)),[...r.keys()]);
let checked=0;
for(const[name,node]of b){
 const other=extracted.has(name)?h.get(name):cleaned.get(name);assert.ok(other,name);
 const targetFile=extracted.has(name)?helper:transformed.transformed[0];
 assert.equal(printer.printNode(ts.EmitHint.Unspecified,other,targetFile),printer.printNode(ts.EmitHint.Unspecified,node,base),name);checked++;
}
transformed.dispose();
const report={allPackageHashesVerified:true,compiledFunctionsCompared:checked,nonJournalFunctionBodiesMatch:true,removedJournalNodes:removed,changedFiles:manifest.changedFiles,limits:'Function-body parity only; no runtime deployment, real event evidence or full portfolio parity.'};
fs.writeFileSync(path.join(pkg,'compiled-function-parity.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
