/* Signal filter reads only the breakout candle closed before decision time. */
function strongClose(candidates,bars){
 const index=new Map(bars.map(b=>[b[0]+900000,b]));
 return candidates.filter(c=>{
  const b=index.get(c.sourceClose);if(!b||c.sourceClose>=c.time||b[2]<=b[3])return false;
  const location=c.side==='long'?(b[4]-b[3])/(b[2]-b[3]):(b[2]-b[4])/(b[2]-b[3]);
  return location>=.75;
 });
}
module.exports={strongClose};
