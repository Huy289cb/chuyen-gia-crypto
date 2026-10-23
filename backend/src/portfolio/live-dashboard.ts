/** Read-only, same-origin view of authenticated live observations. No order actions. */
export const PORTFOLIO_LIVE_DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Danh mục Futures giao dịch thật</title>
<style>
:root{color-scheme:dark;--bg:#0b111b;--panel:#141e2d;--line:#2b3b50;--text:#e8eef7;--muted:#a5b5c9;--good:#8ce4b0;--bad:#ffaaaa;--accent:#8ed9ff;--warn:#ffd48c}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,sans-serif}main{max-width:1200px;margin:auto;padding:28px 18px 54px}a{color:var(--accent)}h1{font-size:clamp(23px,4vw,32px);margin:12px 0 6px}h2{font-size:18px;margin:0 0 12px}p{margin:8px 0}.muted{color:var(--muted)}.small{font-size:12px}.panel{padding:20px;background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-top:18px}.badge{display:inline-block;font-size:13px;font-weight:700;border:1px solid currentColor;border-radius:6px;padding:5px 10px;color:var(--warn)}.badge.active{color:var(--good)}.badge.blocked,.error{color:var(--bad)}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px}.metric{padding:16px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.value{font-size:23px;font-weight:650;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.gain{color:var(--good)}.loss{color:var(--bad)}.details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:0}.details dt{color:var(--muted);font-size:12px}.details dd{margin:3px 0 0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap;font-size:13px}th,td{padding:10px 14px 10px 0;border-bottom:1px solid var(--line)}th{font-weight:600;color:var(--muted)}td{font-variant-numeric:tabular-nums}caption{text-align:left;color:var(--muted);font-size:12px;padding-bottom:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:var(--muted);margin:12px 0 0}summary{cursor:pointer}details+details{margin-top:14px}.error{border-color:#704747}[hidden]{display:none!important}a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}@media(max-width:760px){.metrics,.details{grid-template-columns:repeat(2,minmax(0,1fr))}.panel{padding:16px}.value{font-size:20px}}@media(max-width:380px){.metrics,.details{grid-template-columns:1fr}}
</style></head><body><main>
<a href="/">Về bảng điều khiển</a>
<h1>Danh mục Futures giao dịch thật</h1>
<p class="muted">Trang theo dõi chỉ đọc. Số dư, vị thế và khớp lệnh được lấy từ sổ đối soát tài khoản thật.</p>
<section class="panel" aria-label="Trạng thái giao dịch thật">
<span class="badge" id="activation" role="status">CHƯA XÁC NHẬN TRẠNG THÁI</span>
<p id="policy" class="small">Đang lấy chính sách…</p><p id="blocked" class="small"></p>
<p id="observed" class="muted small">Chưa có quan sát tài khoản.</p><p id="fetched" class="muted small"></p>
</section>
<div id="read-error" class="panel error" role="alert" hidden></div>
<section class="metrics" aria-label="Vốn và rủi ro đã cấu hình">
<div class="metric"><div class="muted small">Vốn phân bổ ban đầu</div><div class="value" id="initial">Chưa có dữ liệu</div></div>
<div class="metric"><div class="muted small">Ngân sách lỗ mỗi ngày ICT</div><div class="value" id="budget">Chưa có dữ liệu</div></div>
<div class="metric"><div class="muted small">Ngưỡng bắt đầu đóng có dự phòng</div><div class="value" id="soft">Chưa có dữ liệu</div></div>
<div class="metric"><div class="muted small">Dự phòng trước ngân sách ngày</div><div class="value" id="buffer">Chưa có dữ liệu</div></div>
</section>
<p class="muted small">Ngân sách ngày và ngưỡng bắt đầu bảo vệ được hiển thị theo cấu hình đang chạy ở trên. Đây là ngưỡng kiểm soát; gap, trượt giá hoặc gián đoạn có thể làm lỗ thực tế vượt ngân sách.</p>
<section class="metrics" aria-label="Kết quả tài khoản đã quan sát">
<div class="metric"><div class="muted small">Equity phần vốn chiến lược</div><div class="value" id="equity">Chưa có dữ liệu</div></div>
<div class="metric"><div class="muted small">Lãi/lỗ ngày hiện tại ICT</div><div class="value" id="day-pnl">Chưa có dữ liệu</div></div>
<div class="metric"><div class="muted small">Lãi/lỗ từ lúc khởi tạo live</div><div class="value" id="net-pnl">Chưa có dữ liệu</div></div>
<div class="metric"><div class="muted small">Khóa rủi ro trong ngày</div><div class="value" id="latch">Chưa có dữ liệu</div></div>
</section>
<section class="panel"><h2>Ví và chi phí thực tế</h2><dl id="wallet-details" class="details"></dl>
<p class="small muted">Không dùng lợi nhuận backtest để điền số liệu live. Funding có dấu; phí giao dịch đã ghi nhận từ khớp lệnh.</p></section>
<section class="panel"><h2>Vị thế thực tế</h2><div class="table-wrap" id="positions"></div></section>
<section class="panel"><h2>Khớp lệnh đã đối soát</h2><div class="table-wrap" id="fills"></div></section>
<section class="panel"><h2>Funding đã đối soát</h2><div class="table-wrap" id="funding"></div></section>
<section class="panel"><h2>Trạng thái vận hành</h2><dl id="worker-details" class="details"></dl>
<details style="margin-top:16px"><summary>Chi tiết worker và điều kiện sẵn sàng</summary><pre id="readiness">Chưa có dữ liệu</pre></details>
<details><summary>Chi tiết ví để đối chiếu</summary><pre id="wallet-json">Chưa có ví live</pre></details>
</section>
</main><script>
(function(){
'use strict';
var endpoint='/api/portfolio-paper/live',busy=false;
function el(id){return document.getElementById(id)}
function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:null}
function num(v){if((typeof v!=='number'&&typeof v!=='string')||v==='')return null;var n=Number(v);return Number.isFinite(n)?n:null}
function text(v,fallback){return typeof v==='string'||typeof v==='number'?String(v):(fallback===undefined?'Chưa có dữ liệu':fallback)}
function money(v,signed){var n=num(v);return n===null?'Chưa có dữ liệu':(signed&&n>0?'+':'')+n.toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:4})+' USDT'}
function qty(v){var n=num(v);return n===null?'—':n.toLocaleString('vi-VN',{maximumFractionDigits:8})}
function date(v){if(typeof v!=='number'&&typeof v!=='string')return'Chưa có dữ liệu';var d=new Date(v);return Number.isNaN(d.valueOf())?'Chưa có dữ liệu':d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}
function set(id,v){el(id).textContent=v}
function clear(n){while(n.firstChild)n.removeChild(n.firstChild)}
function node(tag,v){var n=document.createElement(tag);if(v!==undefined)n.textContent=v;return n}
function list(v){return Array.isArray(v)?v.filter(function(x){return obj(x)}):[]}
function first(){for(var i=0;i<arguments.length;i++)if(arguments[i]!==undefined&&arguments[i]!==null)return arguments[i];return null}
function detail(id,label,value){var n=node('div');n.appendChild(node('dt',label));n.appendChild(node('dd',value));el(id).appendChild(n)}
function pnl(id,v){set(id,money(v,true));var n=num(v);el(id).className='value'+(n===null?'':n<0?' loss':' gain')}
function table(id,headers,records,caption){var holder=el(id);clear(holder);if(!records.length){holder.appendChild(node('p','Chưa có bản ghi đã đối soát.'));return}var t=node('table'),head=node('thead'),tr=node('tr');t.appendChild(node('caption',caption));headers.forEach(function(title){var th=node('th',title);th.scope='col';tr.appendChild(th)});head.appendChild(tr);t.appendChild(head);var body=node('tbody');records.forEach(function(cells){var r=node('tr');cells.forEach(function(v){r.appendChild(node('td',v))});body.appendChild(r)});t.appendChild(body);holder.appendChild(t)}
// Bound fallback diagnostics and omit credential/ownership internals. Data is always text.
function diagnostic(v,depth){if(depth>5)return'[rút gọn]';if(Array.isArray(v))return v.slice(-20).map(function(x){return diagnostic(x,depth+1)});var o=obj(v);if(o){var out={};Object.keys(o).filter(function(k){return !/api.?key|secret|signature|token|authorization|accountIdentity|handoffSha256|receiptPath/i.test(k)}).slice(0,50).forEach(function(k){out[k]=diagnostic(o[k],depth+1)});return out}return typeof v==='string'&&v.length>1200?v.slice(0,1200)+'…':v}
function json(v){return v===null||v===undefined?'Chưa có dữ liệu':JSON.stringify(diagnostic(v,0),null,2)}
function render(data){
var wallet=obj(data.wallet),worker=obj(data.worker)||{},readiness=obj(data.readiness)||{},config=obj(data.config)||{},wc=wallet&&obj(wallet.config)||{},day=wallet&&obj(wallet.currentDay),blocked=first(wallet&&wallet.blockedReason,worker.blockedReason,worker.error,readiness.blockedReason,readiness.reason,data.blockedReason);
var enabled=data.enabled===true,badge=el('activation'),latched=day&&day.riskLatched===true;
badge.className='badge'+(blocked||latched?' blocked':enabled&&wallet?' active':'');
badge.textContent=!enabled?'GIAO DỊCH THẬT · CHƯA BẬT ĐIỀU PHỐI':!wallet?'ĐÃ BẬT · CHỜ KHỞI TẠO VÍ':blocked||latched?'GIAO DỊCH THẬT · ĐANG BỊ KHÓA':'GIAO DỊCH THẬT · ĐÃ BẬT';
set('policy','Chính sách: '+text(first(data.policyId,wallet&&wallet.policyId))+' · chỉ đọc');
set('blocked',blocked?'Lý do chờ / bị khóa: '+text(blocked):!wallet?'Chưa có ví live; chưa có số liệu lợi nhuận thực tế.':text(wallet.sourceDisposition,''));
var observed=first(wallet&&wallet.lastObservedAtMs,worker.lastObservedAtMs),stamp=typeof observed==='number'?observed:typeof observed==='string'?new Date(observed).valueOf():null;
set('observed','Quan sát tài khoản: '+date(observed)+(stamp!==null&&Number.isFinite(stamp)&&Date.now()-stamp>30000?' · Dữ liệu quan sát đã cũ.':''));
set('fetched','Trang đọc trạng thái lúc '+date(Date.now())+' · Giờ Việt Nam · tự cập nhật mỗi 5 giây');
var initial=first(config.initialCapital,config.initialCash,wc.initialCash),budget=first(config.dailyLossLimitUsd,wc.dailyLossLimitUsd),buffer=first(config.closeBufferUsd,wc.closeBufferUsd),soft=first(config.softLossThresholdUsd,wc.softLossThresholdUsd);
if(soft===null&&num(budget)!==null&&num(buffer)!==null)soft=-num(budget)+num(buffer);
set('initial',money(initial));set('budget',money(budget));set('buffer',money(buffer));set('soft',money(soft,true));set('equity',money(wallet&&wallet.equity));pnl('day-pnl',day&&day.netPnl);pnl('net-pnl',wallet&&wallet.netPnl);
set('latch',!day?'Chưa có dữ liệu':day.riskLatched===true?'ĐÃ KHÓA':day.riskLatched===false?'Chưa khóa':'Chưa có dữ liệu');
clear(el('wallet-details'));detail('wallet-details','Equity toàn tài khoản sàn',money(wallet&&wallet.accountEquity));detail('wallet-details','Số dư khả dụng tại sàn',money(wallet&&wallet.availableBalance));detail('wallet-details','Phí khớp lệnh thực tế',money(wallet&&wallet.totalFees));detail('wallet-details','Funding PnL có dấu',money(wallet&&wallet.fundingPnl,true));detail('wallet-details','Lãi/lỗ đã thực hiện',money(wallet&&wallet.realizedPnl,true));detail('wallet-details','Vốn nạp/rút đã đối soát',money(wallet&&wallet.netCashflow,true));detail('wallet-details','Equity mốc đầu ngày ICT',money(day&&day.anchorEquity));detail('wallet-details','Vượt ngân sách đã quan sát',money(day&&day.breachUsd));detail('wallet-details','Lý do khóa ngày',text(day&&day.latchReason,'Chưa ghi nhận'));
var actual=wallet&&Array.isArray(wallet.actualPositions)?list(wallet.actualPositions):null,positions=wallet&&obj(wallet.positions)||{};
var positionRows=actual?actual.filter(function(p){return num(first(p.positionAmt,p.quantity))!==0}).map(function(p){return[text(p.symbol,'—'),qty(first(p.positionAmt,p.quantity)),qty(first(p.entryPrice,p.averageEntry)),qty(p.markPrice),money(first(p.unRealizedProfit,p.unrealizedProfit),true),text(p.positionSide,'—')]}):Object.keys(positions).sort().map(function(symbol){var p=obj(positions[symbol])||{};return[symbol,qty(p.quantity),qty(p.averageEntry),'—','Chưa có dữ liệu','—']});
table('positions',['Coin','Quantity có dấu','Giá vào','Giá mark','PnL chưa thực hiện','Position side'],positionRows,actual?'Quan sát vị thế từ sàn; ẩn quantity bằng 0':'Sổ vị thế đã đối soát; chưa có bản quan sát vị thế thô');
var fills=wallet?list(wallet.trades).slice().sort(function(a,b){return(num(b.time)||0)-(num(a.time)||0)}).slice(0,30):[];
table('fills',['Thời gian ICT','Coin','Chiều','Quantity','Giá khớp','Phí USDT','PnL đã thực hiện','Order ID'],fills.map(function(f){return[date(f.time),text(f.symbol,'—'),text(f.side,'—'),qty(first(f.qty,f.quantity)),qty(f.price),money(f.commission),money(f.realizedPnl,true),text(f.orderId,'—')]}),'Tối đa 30 khớp lệnh gần nhất; dữ liệu đã đối soát');
var funds=wallet?list(wallet.incomes).filter(function(f){return f.incomeType==='FUNDING_FEE'}).sort(function(a,b){return(num(b.time)||0)-(num(a.time)||0)}).slice(0,30):[];
table('funding',['Thời gian ICT','Coin','Funding có dấu','Tài sản','Transaction ID'],funds.map(function(f){return[date(f.time),text(f.symbol,'—'),money(f.income,true),text(f.asset,'—'),text(f.tranId,'—')]}),'Tối đa 30 khoản funding gần nhất đã đối soát');
clear(el('worker-details'));detail('worker-details','Worker',text(worker.status));detail('worker-details','Trạng thái ví',text(wallet&&wallet.status));detail('worker-details','Điều kiện sẵn sàng',typeof readiness.ready==='boolean'?(readiness.ready?'Đã sẵn sàng theo kiểm tra':'Chưa sẵn sàng'):text(readiness.status));detail('worker-details','Ngày đang theo dõi',text(day&&day.day));detail('worker-details','Mốc ngày',text(day&&day.anchorQuality));detail('worker-details','Lý do khóa ngày',text(day&&day.latchReason,'Chưa ghi nhận'));
set('readiness',json({worker:worker,readiness:readiness}));set('wallet-json',wallet?json(wallet):'Chưa có ví live');
}
async function refresh(){if(busy)return;busy=true;var controller=new AbortController(),timer=window.setTimeout(function(){controller.abort()},8000);try{var response=await fetch(endpoint,{method:'GET',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});var payload=await response.json();if(!response.ok||!obj(payload)||payload.success!==true||!obj(payload.data)||payload.data.mode!=='live')throw new Error('Chưa nhận được trạng thái live hợp lệ (HTTP '+response.status+').');render(payload.data);el('read-error').hidden=true;set('read-error','')}catch(error){el('activation').className='badge';set('activation','CHƯA XÁC NHẬN TRẠNG THÁI MỚI');set('read-error',(error instanceof Error?error.message:'Không lấy được trạng thái live.')+' Số liệu cũ nếu đang hiển thị chưa được cập nhật.');el('read-error').hidden=false}finally{window.clearTimeout(timer);busy=false;window.setTimeout(function(){void refresh()},5000)}}
void refresh();
})();
</script></body></html>`;
