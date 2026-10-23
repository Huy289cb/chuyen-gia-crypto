// Read-only static coverage audit. No database access or environment import.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const out=process.argv[2];if(!out||fs.existsSync(out))throw Error('Usage: NEW_REPORT');
const root=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const rows=[];
for(const variant of ['src','dist']){
 const base=path.join(root,variant);
 for(const file of fs.readdirSync(base,{recursive:true,withFileTypes:true}).filter(e=>e.isFile())){
  const absolute=path.join(file.parentPath||file.path,file.name);
  if(!/\.(ts|js)$/.test(file.name)||file.name.endsWith('.d.ts'))continue;
  const bytes=fs.readFileSync(absolute),text=bytes.toString(),sf=ts.createSourceFile(absolute,text,ts.ScriptTarget.Latest,true);
  function visit(node){
   if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['create','update','updateMany','upsert','delete','deleteMany'].includes(node.expression.name.text)&&ts.isPropertyAccessExpression(node.expression.expression)&&node.expression.expression.name.text==='testnetAccount'){
    const arg=node.arguments[0],data=arg&&ts.isObjectLiteralExpression(arg)?arg.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==='data'):undefined;
    const fields=data&&ts.isObjectLiteralExpression(data.initializer)?data.initializer.properties.map(p=>ts.isPropertyAssignment(p)||ts.isShorthandPropertyAssignment(p)?p.name.getText(sf):'unknown_spread'):null;
    let parent=node.parent,owner='top_level';while(parent){if((ts.isFunctionDeclaration(parent)||ts.isMethodDeclaration(parent))&&parent.name){owner=parent.name.getText(sf);break;}parent=parent.parent;}
    rows.push({variant,file:path.relative(base,absolute),line:sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1,owner,operation:node.expression.name.text,data_fields:fields,static_data_shape:fields?'explicit_fields':'requires_runtime_evidence',module_sha256:hash(bytes),call_sha256:hash(node.getText(sf)),runtime_reachability:'not_established',journal_coverage:'not_established'});
   }ts.forEachChild(node,visit);
  }visit(sf);
 }
}
const report={schema:'account-write-static-inventory-v1',created_at:new Date().toISOString(),rows,counts:Object.fromEntries(['src','dist'].map(v=>[v,rows.filter(r=>r.variant===v).length])),limits:'Static named Prisma account calls only. Aliases, raw SQL, indirect helpers, dynamic shapes, runtime reachability and journal coverage are not proven. Source and deployed module hashes are separate; no balance, ROI or ledger completeness inferred.'};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({counts:report.counts,report:out}));
