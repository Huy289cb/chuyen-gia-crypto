const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript');
const pkg=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
assert.deepEqual(manifest.changedFiles,['services/position-close.service.js','utils/recorded-close-account.js']);
for(const variant of ['baseline','release'])for(const [file,hash] of Object.entries(manifest[variant]))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(pkg,variant,file))).digest('hex'),hash);
const printer=ts.createPrinter({removeComments:true}),prints=[];
for(const variant of ['baseline','release']){
 const sf=ts.createSourceFile('close.js',fs.readFileSync(path.join(pkg,variant,'services/position-close.service.js'),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 let captured=0,tagged=0,applied=0;
 const result=ts.transform(sf,[ctx=>root=>{
 function visit(node){
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.length===1&&node.declarationList.declarations[0].name.getText(sf)==='accountAppliedAt'){
   assert.equal(node.declarationList.declarations[0].initializer.getText(sf),'new Date().toISOString()');captured++;return undefined;
  }
  if(ts.isPropertyAssignment(node)&&node.name.getText(sf)==='applied_clock_source'){assert.equal(node.initializer.text,'db_update_return');tagged++;return undefined;}
  if(ts.isPropertyAssignment(node)&&node.name.getText(sf)==='applied_at'){
   assert.equal(node.initializer.getText(sf),variant==='baseline'?'new Date().toISOString()':'accountAppliedAt');applied++;
   return ts.factory.updatePropertyAssignment(node,node.name,ts.factory.createIdentifier('verifiedApplicationClock'));
  }
  return ts.visitEachChild(node,visit,ctx);
 }return ts.visitNode(root,visit);
 }]);
 assert.equal(applied,1);assert.equal(captured,variant==='release'?1:0);assert.equal(tagged,variant==='release'?1:0);
 prints.push(printer.printFile(result.transformed[0]));result.dispose();
 if(variant==='release'){
  const text=sf.text,index=text.indexOf('const accountAppliedAt');
  assert.match(text.slice(0,index),/await prisma_1\.prisma\.testnetAccount\.update\([\s\S]*?\);\s*\/\/[^\n]*\n\s*$/);
  assert.ok(index<text.indexOf("'close_account_update_applied'"));
 }
}
assert.equal(prints[0],prints[1]);
const report={allPackageHashesVerified:true,wholeServiceOutsideClockCaptureMatches:true,clockCapturedAfterDbAwaitBeforeJournalScheduling:true,liveOrdersSent:0,limits:'AST and hash verification only; integration tests are separate, no actual close/ledger/ROI proof.'};
fs.writeFileSync(path.join(pkg,'compiled-clock-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
