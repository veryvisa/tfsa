(function () {
  'use strict';
  const E=window.AccountsEngine,P=window.AccountsPresentation,D=window.ACCOUNT_DATA;
  if(!E||!P||!D)return;
  const form=document.querySelector('[data-calculator]');
  if(form){
    const full=form.dataset.calculator==='full';
    const el=n=>form.elements.namedItem(n),num=n=>Number(el(n).value),yes=n=>!!el(n)?.checked;
    function family(){
      const senior=!full&&el('ageMode').value==='senior',student=!full&&el('ageMode').value==='student';
      const household=el('household').value,married=['couple','parents'].includes(household),income=num('income');
      const oas=full?num('oasAnnual'):(senior?E.money(E.value('oas_monthly')['65to74']*12):0);
      const f={income,prov:el('prov').value,age:full?num('age'):(senior?67:student?22:35),spouseAge:full?num('spouseAge'):35,married,spouseIncome:married?num('spouseIncome'):0,
        spouseWorkingIncome:married?(full?num('spouseWorkingIncome'):num('spouseIncome')):0,
        spouseEmploymentIncome:married?(full?num('spouseEmploymentIncome'):num('spouseIncome')):0,
        children:full?el('childrenAges').value.split(',').map(x=>x.trim()).filter(Boolean).map(Number):(['parents','single-parent'].includes(household)?[4,8]:[]),
        employmentIncome:full?num('employmentIncome'):Math.max(0,income-oas),workingIncome:full?num('workingIncome'):Math.max(0,income-oas),
        fullTimeStudent:full?yes('fullTimeStudent'):student,firstHomeBuyer:yes('firstHomeBuyer'),
        resident:full?yes('resident'):true,fullYearResident:full?yes('fullYearResident'):true,usPerson:full?yes('usPerson'):false,
        returnRate:num('returnRate')/100,withdrawalIncome:num('withdrawalIncome'),withdrawalWorkingIncome:full?num('withdrawalWorkingIncome'):Math.max(0,num('withdrawalIncome')-oas),
        oasAnnual:oas,gisReceived:full?num('gisReceived'):0,gisMode:full?el('gisMode').value:(senior&&!married?'single':'none'),
        fhsaUse:el('fhsaUse').value,fhsaYearsOpen:full?num('fhsaYearsOpen'):0,
        tfsaRoom:full?num('tfsaRoom'):num('amount'),rrspRoom:full?num('rrspRoom'):num('amount'),fhsaRoom:full?num('fhsaRoom'):Math.min(num('amount'),E.value('fhsa_annual'))};
      if(!full&&f.gisMode==='single'&&income>=oas)f.gisReceived=E.benefits(f).gis;
      return f;
    }
    function render(){
      const error=document.getElementById('calc-error'),output=document.getElementById('calc-results'),yearly=document.getElementById('yearly-results');
      form.querySelector('[data-income-output]').textContent=P.dollars(num('income'));el('income').setAttribute('aria-valuetext',P.dollars(num('income')));
      try{
        if(!form.checkValidity())throw Error('请检查输入范围；年数必须是整数，金额不可为空或为负。');
        const f=family(),results=['tfsa','rrsp','fhsa'].map(a=>E.accountValue(a,f,num('amount'),num('horizon')));
        error.textContent='';output.innerHTML=P.comparison(results,D.account);
        if(yearly)yearly.innerHTML='<h2>'+D.account.toUpperCase()+' 的逐年账</h2>'+P.yearly(results.find(r=>r.account===D.account));
      }catch(e){error.textContent=e.message;output.innerHTML='';if(yearly)yearly.innerHTML='';}
    }
    function loadProfile(){const p=D.profiles.find(p=>p.id===el('profile').value);if(!p)return;
      const set=(name,v)=>{if(el(name))el(name).value=v;};
      for(const name of ['income','prov','age','spouseIncome','employmentIncome','workingIncome','spouseWorkingIncome','spouseEmploymentIncome','oasAnnual','gisReceived','tfsaRoom','rrspRoom','fhsaRoom'])set(name,p[name]??0);
      set('childrenAges',(p.children||[]).join(','));set('horizon',p.horizon);set('returnRate',(p.returnRate??.04)*100);set('withdrawalIncome',p.withdrawalIncome??p.income);set('withdrawalWorkingIncome',p.withdrawalWorkingIncome??p.workingIncome??0);set('gisMode',p.gisMode??'none');
      set('spouseAge',p.spouseAge??35);
      set('ageMode',p.age>=65?'senior':p.fullTimeStudent?'student':'working');set('household',p.married?(p.children?.length?'parents':'couple'):(p.children?.length?'single-parent':'single'));
      for(const key of ['firstHomeBuyer','fullTimeStudent','usPerson'])el(key).checked=!!p[key];for(const key of ['resident','fullYearResident'])el(key).checked=p[key]!==false;
      if(document.title.includes('三者')){set('horizon',20);set('fhsaUse','retirement');}
      render();
    }
    form.addEventListener('submit',e=>{e.preventDefault();render();});
    form.addEventListener('input',e=>{if(e.target.name==='profile')return;if(!full&&e.target.name==='income')el('withdrawalIncome').value=el('income').value;render();});
    form.addEventListener('change',e=>{if(e.target.name==='profile')loadProfile();else {if(full&&e.target.name==='household'){const children=['parents','single-parent'].includes(e.target.value);el('childrenAges').value=children?(el('childrenAges').value||'4,8'):'';}render();}});
    if(full)loadProfile();else render();
  }
  const room=document.querySelector('[data-room]');
  if(room){
    const output=document.getElementById('room-result');
    function parseHistory(raw,width,minYear){const history={};for(const line of raw.split('\n').filter(l=>l.trim())){const cols=line.split(',').map(x=>x.trim());if(cols.length!==width||cols.some(v=>v===''||!Number.isFinite(Number(v))))throw Error('交易记录请按每行指定列数填写，使用英文逗号。');const vals=cols.map(Number),year=vals[0];if(!Number.isInteger(year)||year<minYear||year>2026||vals.slice(1).some(v=>v<0))throw Error('交易年份或金额超出范围；金额不能为负。');if(Object.hasOwn(history,year))throw Error('同一年请先合并各机构记录，只填一行。');history[year]=width===3?{contribution:vals[1],withdrawal:vals[2]}:vals[1];}return history;}
    function calculate(){try{if(!room.checkValidity())throw Error('请检查输入范围，年份为整数，金额不能为负。');const n=k=>Number(room.elements.namedItem(k).value),a=room.dataset.room;let result,headers,rows;
      if(a==='tfsa'){const excluded=room.elements.nonResidentYears.value.split(',').map(s=>s.trim()).filter(Boolean).map(Number);if(excluded.some(y=>!Number.isInteger(y)||y<n('residentYear')||y>2026))throw Error('非居民年份须为税务居民起始年之后至当前年的整数。');const min=Math.max(2009,n('birthYear')+E.value('tfsa_age'),n('residentYear'));result=E.tfsaRoom({birthYear:n('birthYear'),residentYear:n('residentYear'),history:parseHistory(room.elements.history.value,3,min),nonResidentYears:excluded});headers=['年份','新额度','上年提款回补','本年供款','本年提款','年末剩额'];rows=result.rows.map(r=>[r.year,r.annual,r.restored,r.contribution,r.withdrawal,r.remaining]);}
      if(a==='rrsp'){const args={};for(const key of ['previousEarnedIncome','carry','pa','par','pspa','undeducted'])args[key]=n(key);result=E.rrspRoom(args);result.room=result.contributionRoom;headers=['新额度','抵扣限额','扣除已供款后的可供款额'];rows=[[result.newRoom,result.deductionLimit,result.contributionRoom]];}
      if(a==='fhsa'){result=E.fhsaRoom({openYear:n('openYear'),history:parseHistory(room.elements.history.value,2,n('openYear'))});headers=['年份','年初可用','本年供款及转入','年末剩额'];rows=result.rows.map(r=>[r.year,r.openingRoom,r.used,r.remaining]);}
      output.innerHTML=`<h2>${result.room===null?'记录需要核对，暂不报可再供款额':'按这份记录，剩余额度 '+P.dollars(result.room)}</h2><p>${(result.warnings||[]).map(P.escape).join('；')||'请再与所有机构记录及最新评税通知核对；这不是 CRA 对个人额度的确认。'}</p><div class="table-scroll" role="region" aria-label="额度账本" tabindex="0"><table><caption>${result.room===null?'简式记录，仅用于定位特殊事项；后续余量不是供款依据':'输入记录的逐年核对'}</caption><thead><tr>${headers.map(t=>'<th scope="col">'+t+'</th>').join('')}</tr></thead><tbody>${rows.map(row=>'<tr>'+row.map(v=>'<td>'+Number(v).toLocaleString('en-CA')+'</td>').join('')+'</tr>').join('')}</tbody></table></div>${a==='tfsa'&&result.room!==null?'<p>本年普通提款 '+P.dollars(result.pendingRestoration)+' 留待下一日历年回补；本工具不猜下一年新额度。</p>':''}`;
    }catch(e){output.innerHTML='<p class="error" role="alert">'+P.escape(e.message)+'</p>';}}
    room.addEventListener('submit',e=>{e.preventDefault();calculate();});calculate();
  }
  const withdrawal=document.querySelector('[data-withdrawal]');
  if(withdrawal)withdrawal.addEventListener('submit',e=>{e.preventDefault();const output=document.getElementById('withdrawal-result');try{if(!withdrawal.checkValidity())throw Error('请检查日期、金额与年龄。');const el=n=>withdrawal.elements.namedItem(n),num=n=>Number(el(n).value);
    if(withdrawal.dataset.withdrawal==='rrsp'){
      const f={age:num('age'),prov:el('prov').value,income:num('income'),oasAnnual:num('oasAnnual'),gisReceived:num('gisReceived'),gisMode:el('gisMode').value,cwbEligible:false};
      output.innerHTML=P.plan(E.withdrawalPlan(f,num('balance'),num('annualGross'),num('years'),num('rate')/100));
    }else{const args={birthYear:num('birthYear'),openYear:num('openYear')};for(const k of ['agreementDate','withdrawalDate','acquisitionDate'])args[k]=el(k).value;for(const k of ['firstHomeWithdrawal','qualifyingHome','residentThroughPurchase','occupancyIntent','noExcess'])args[k]=el(k).checked;output.innerHTML=P.fhsaDates(E.fhsaDates(args));}
  }catch(error){output.innerHTML='<p class="error" role="alert">'+P.escape(error.message)+'</p>';}});
})();
