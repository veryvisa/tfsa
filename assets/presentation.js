(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AccountsPresentation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dollars = n => n === null ? '不适用' : new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0}).format(n) + ' 加元';
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + dollars(Math.abs(n));
  const labels = [['taxSaving','抵扣少交的税',1],['benefitGain','抵扣带来的福利变化',1],['growthAdvantage','账户内增长的额外价值',1],['withdrawalTax','提款交税',-1],['withdrawalBenefitLoss','提款减少的福利',-1]];
  function comparison(results, focus) {
    const endpoints=[];
    for(const r of results.filter(x=>x.eligible)){let n=0; endpoints.push(0);for(const [k,,sign] of labels){n+=r[k]*sign;endpoints.push(n);}}
    const lo=Math.min(0,...endpoints), hi=Math.max(1,...endpoints), range=hi-lo;
    return '<div class="comparison">'+results.map(r=>{
      const title=r.account.toUpperCase();
      if(!r.eligible) return `<article class="result-card unavailable"><h3>${title}</h3><p class="result-value">不适用</p><p>${r.reasons.map(escape).join('；')}。</p></article>`;
      let cumulative=0;
      const rows=labels.map(([k,label,sign])=>{
        const n=r[k]*sign, old=cumulative; cumulative+=n;
        const left=(Math.min(old,cumulative)-lo)/range*100, width=Math.abs(n)/range*100;
        return `<li><span>${label}</span><strong>${signed(n)}</strong><span class="waterfall-track" aria-hidden="true"><i class="zero" style="left:${(-lo/range*100).toFixed(3)}%"></i><i class="bar ${n<0?'negative':'positive'}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"></i></span></li>`;
      }).join('');
      return `<article class="result-card ${r.account===focus?'focus-account':''}"><h3>${title}</h3><p class="result-value ${r.netValue<0?'loss':''}">约 ${signed(r.netValue)}</p><p class="caption">相对于同额非注册利息投资</p><ol class="waterfall">${rows}</ol><p class="small">同额供款的净现金成本约 ${dollars(r.netContributionCost)}；账户税后取出合计约 ${dollars(r.registeredNet)}。</p></article>`;
    }).join('')+'</div>';
  }
  function yearly(result) {
    if(!result.eligible) return `<p>${result.reasons.map(escape).join('；')}。</p>`;
    if(!result.rows.length) return '<p>同年进出按净额计算，没有持有期间收益。</p>';
    return '<div class="table-scroll" role="region" aria-label="逐年测算，可横向滚动" tabindex="0"><table><caption>逐年账本 · 金额为加元，显示到分供复算</caption><thead><tr>'+['年次','年龄','年初本金','收益','取出','提款税','福利减少','年末余额','非注册余额'].map(s=>'<th scope="col">'+s+'</th>').join('')+'</tr></thead><tbody>'+result.rows.map(r=>'<tr>'+[r.year,r.age,r.opening,r.growth,r.withdrawal,r.tax,r.benefitLoss,r.closing,r.taxableBaseline].map((v,i)=>i<2?`<td>${v}</td>`:`<td>${v.toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>`).join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function plan(result) {
    if(!result.eligible)return '<p>'+result.reasons.map(escape).join('；')+'</p>';
    return `<p>税与福利变化后，累计可用约 ${dollars(result.netTotal)}，账户剩余约 ${dollars(result.remaining)}。剩余资产尚未扣未来提款成本。</p><div class="table-scroll" role="region" aria-label="退休提款账本，可横向滚动" tabindex="0"><table><caption>按输入年初年龄起算；预扣税不等于最终税</caption><thead><tr>${['年次','年龄','年初余额','收益','RRIF 最低额','实际税前提款','所得税增额','福利损失','净可用现金','年末余额'].map(s=>'<th scope="col">'+s+'</th>').join('')}</tr></thead><tbody>${result.rows.map(r=>'<tr>'+['year','age','opening','growth','minimum','gross','tax','benefitLoss','net','closing'].map(k=>'<td>'+r[k].toLocaleString('en-CA',{maximumFractionDigits:2})+'</td>').join('')+'</tr>').join('')}</tbody></table></div><p class="small">${escape(result.assumptions)}</p>`;
  }
  function fhsaDates(result) {
    return `<h2>${result.passes?'按输入，各项日期与自报条件相符':'还有条件未满足，先不要按免税提款办理'}</h2><ul>${result.checks.map(c=>'<li>'+(c.pass?'符合：':'待解决：')+escape(c.label)+'</li>').join('')}</ul><p>没有购房提款时的最迟关闭年：${result.naturalCloseYear} 年；若本次为首次合资格提款，最迟关闭年：${result.afterWithdrawalCloseYear} 年。取得住宅须早于 ${result.acquireBefore}。</p><p>${escape(result.note)}</p>`;
  }
  return {escape,dollars,signed,comparison,yearly,plan,fhsaDates};
});
