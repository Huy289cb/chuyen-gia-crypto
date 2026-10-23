const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),ts=require('typescript');
const pkg=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(manifest.changedFiles,['services/protective-order.service.js']);
for(const variant of ['baseline','release'])for(const[f,h]of Object.entries(manifest[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
const parse=variant=>ts.createSourceFile('module.js',fs.readFileSync(path.join(pkg,variant,'services/protective-order.service.js'),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
const baseline=parse('baseline'),release=parse('release');const removed={helper:0,clocks:0,records:0};
const stripped=ts.transform(release,[context=>root=>{
 function visit(node){
  if(ts.isFunctionDeclaration(node)&&node.name?.text==='recordProtectiveAcknowledgement'){removed.helper++;return undefined;}
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.length===1&&node.declarationList.declarations[0].name.getText(release)==='requestStartedAt'){removed.clocks++;return undefined;}
  if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='recordProtectiveAcknowledgement'){removed.records++;return undefined;}
  return ts.visitEachChild(node,visit,context);
 }
 return ts.visitNode(root,visit);
}]);
assert.deepEqual(removed,{helper:1,clocks:2,records:2});
const printer=ts.createPrinter({removeComments:true});assert.equal(printer.printFile(stripped.transformed[0]),printer.printFile(baseline));stripped.dispose();
const report={fullPackageHashesVerified:true,changedFiles:manifest.changedFiles,nonTelemetryAstExactlyMatchesBaseline:true,removedTelemetryNodes:removed,liveOrdersSent:0};
fs.writeFileSync(path.join(pkg,'protective-ack-tests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
