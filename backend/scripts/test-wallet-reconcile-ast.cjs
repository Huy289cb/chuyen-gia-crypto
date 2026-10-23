const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');const pkg=path.resolve(process.argv[2]),printer=ts.createPrinter({removeComments:true}),prints=[];
for(const variant of ['baseline','release']){
 const sf=ts.createSourceFile('reconcile.js',fs.readFileSync(path.join(pkg,variant,'services/wallet-reconcile.service.js'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const counts={sum:0,update:0,journal:0};
 const transformed=ts.transform(sf,[ctx=>root=>{function visit(n){
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='sumClosedPositionPnl')return undefined;
 if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1){const d=n.declarationList.declarations[0],name=d.name.getText(sf);
 if(['__createBinding','__setModuleDefault','__importStar','wallet_reconcile_update_1','node_crypto_1','accountUpdate','recordedUpdate','appliedAt'].includes(name))return undefined;
 if(name==='positionRealizedSum'){counts.sum++;return ts.factory.updateVariableStatement(n,n.modifiers,ts.factory.createVariableDeclarationList([ts.factory.updateVariableDeclaration(d,d.name,d.exclamationToken,d.type,ts.factory.createIdentifier('verifiedRealizedSum'))],n.declarationList.flags));}
 }
 if(ts.isExpressionStatement(n)&&ts.isVoidExpression(n.expression)&&n.getText(sf).includes('persistAccountWalletObservation')){counts.journal++;return undefined;}
 if(ts.isCallExpression(n)&&n.expression.getText(sf)==='prisma_1.prisma.testnetAccount.update'){
 counts.update++;const a=n.arguments[0];assert.ok(ts.isObjectLiteralExpression(a));return ts.factory.updateCallExpression(n,n.expression,n.typeArguments,[ts.factory.updateObjectLiteralExpression(a,a.properties.map(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==='data'?ts.factory.updatePropertyAssignment(p,p.name,ts.factory.createIdentifier('verifiedAccountUpdate')):p))]);
 }
 return ts.visitEachChild(n,visit,ctx);}return ts.visitNode(root,visit);}]);
 assert.equal(counts.sum,1);assert.equal(counts.update,1);assert.equal(counts.journal,variant==='release'?1:0);prints.push(printer.printFile(transformed.transformed[0]));transformed.dispose();
}
assert.equal(prints[0],prints[1]);const report={wholeModuleOutsideSharedUpdateAndJournalMatches:true,limits:'Explicitly excluded shared update arithmetic is covered by separate full-service differential tests; source recording/persistence is separately tested.'};fs.writeFileSync(path.join(pkg,'compiled-ast-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
