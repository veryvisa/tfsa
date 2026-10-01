/* Registered accounts, fixed-rule scenarios. No DOM, clock, network or dependencies.
 * Node reads the canonical ledger; browsers load its generated rules.js first.
 * Public contracts and exclusions: site/calc/README.md. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../rules/ca-accounts-2026.json'));
  else root.AccountsEngine = factory(root.CA_ACCOUNT_RULES);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ledger) {
  'use strict';
  const R = ledger.rules;
  const value = id => {
    if (!R[id] || R[id].value === null) throw new RangeError('未核定规则：' + id);
    return R[id].value;
  };
  const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const positive = n => Math.max(0, n);
  const number = (v, name, min = 0, max = 1e9) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new RangeError(name + ' 超出支持范围');
    return v;
  };
  const yearCheck = y => { if (y !== ledger.tax_year) throw new RangeError('仅核定 ' + ledger.tax_year + ' 税年'); };
  const provCheck = p => { if (!['BC', 'ON'].includes(p)) throw new RangeError('仅支持 BC 与 ON'); };
  function bracketTax(income, bands) {
    let lo = 0, total = 0;
    for (const [hi, rate] of bands) {
      total += positive(Math.min(income, hi === null ? Infinity : hi) - lo) * rate;
      lo = hi === null ? Infinity : hi;
    }
    return total;
  }
  function basicPersonal(netIncome) {
    const b = value('federal_bpa');
    return b.max - (b.max - b.min) * Math.min(1, positive(netIncome - b.phaseStart) / (b.phaseEnd - b.phaseStart));
  }
  function ageCredit(netIncome, age, id) {
    const r = value(id);
    return age < r.age ? 0 : positive(r.max - positive(netIncome - r.threshold) * r.rate);
  }
  /** income = taxable income; opts.netIncome can differ (e.g. GIS included in net).
   * Basic/age/employment credits, optional actual base CPP/EI credit amounts;
   * BC reduction; ON surtax, reduction, LIFT and health premium. Not a T1 return. */
  function taxes(income, prov = 'BC', year = ledger.tax_year, opts = {}) {
    number(income, '应税收入'); provCheck(prov); yearCheck(year);
    const age = number(opts.age ?? 35, '年龄', 0, 120);
    const net = number(opts.netIncome ?? income, '净收入');
    const employment = number(opts.employmentIncome ?? 0, '就业收入');
    const cppEi = number(opts.cppBaseCredit ?? 0, 'CPP 基础抵免金额') + number(opts.eiCredit ?? 0, 'EI 抵免金额');
    const fRate = value('federal_brackets')[0][1], pRate = value(prov + '_brackets')[0][1];
    const federal = positive(bracketTax(income, value('federal_brackets')) - fRate *
      (basicPersonal(net) + ageCredit(net, age, 'federal_age') + Math.min(employment, value('federal_employment')) + cppEi + Math.min(opts.pensionIncome??0,value('rrif_pension_federal')) + (opts.disabilityCredit?value('rdsp_dtc_federal'):0)));
    const baseProv = positive(bracketTax(income, value(prov + '_brackets')) - pRate *
      (value(prov + '_bpa') + ageCredit(net, age, prov + '_age') + cppEi + Math.min(opts.pensionIncome??0,value(prov==='BC'?'rrif_pension_BC':'rrif_pension_ON')) + (opts.disabilityCredit?value(prov==='BC'?'rdsp_dtc_BC':'rdsp_dtc_ON'):0)));
    let surtax = 0, reduction = 0, lift = 0, health = 0;
    if (prov === 'BC') {
      const r = value('BC_reduction');
      reduction = Math.min(baseProv, positive(r.max - positive(net - r.threshold) * r.rate));
    } else {
      surtax = value('ON_surtax').reduce((s, [threshold, rate]) => s + positive(baseProv - threshold) * rate, 0);
      const r = value('ON_reduction');
      const eligibleChildren = number(opts.reductionChildren ?? 0, '安省减税申领孩子数', 0, 20);
      if (opts.fullYearResident !== false) reduction = Math.min(baseProv + surtax, positive(r.multiplier * (r.basic + eligibleChildren * r.child) - baseProv - surtax));
      const l = value('ON_lift');
      if (employment > 0 && opts.fullYearResident !== false) lift = Math.min(positive(baseProv + surtax - reduction), positive(Math.min(l.max, employment * l.employmentRate) - l.phaseRate * Math.max(0, net - l.individualThreshold, (opts.familyNetIncome ?? net) - l.familyThreshold)));
      const band = value('ON_health').find(b => income > b[0] && (b[1] === null || income <= b[1]));
      if (band) health = Math.min(band[4], band[2] + band[3] * (income - band[0]));
    }
    const provincial = positive(baseProv + surtax - reduction - lift) + health;
    return { federal: money(federal), provincial: money(provincial), total: money(federal + provincial), surtax: money(surtax), reduction: money(reduction), lift: money(lift), health: money(health), basicPersonal: money(basicPersonal(net)), scope: '2026 specified credits; no CPP/EI premiums, dividend/foreign tax credits, AMT or spouse transfers' };
  }
  function ccb(afni, ages) {
    const children = ages.filter(a => a >= 0 && a < 18);
    if (!children.length) return 0;
    const maximum = children.reduce((s, a) => s + value(a < 6 ? 'ccb_under6' : 'ccb_6to17'), 0);
    const i = Math.min(children.length, 4) - 1, [a, b] = value('ccb_thresholds'), r = value('ccb_rates');
    const reduction = afni > b ? r.upperBase[i] + (afni - b) * r.upper[i] : positive(afni - a) * r.lower[i];
    return money(positive(maximum - reduction));
  }
  function cgeb(afni, childCount, married) {
    const a = value('cgeb_amounts'), t = value('cgeb_thresholds'), r = value('cgeb_rates');
    let full = a.adult;
    if (married) full += a.adult + childCount * a.child;
    else if (childCount) full += a.adult + (childCount - 1) * a.child + a.singleSupplement;
    else full += Math.min(a.singleSupplement, positive(afni - t.singlePhaseIn) * r.phaseIn);
    return money(positive(full - positive(afni - t.phaseOut) * r.phaseOut));
  }
  function gisMonthly(income, mode = 'single') {
    number(income, 'GIS 计入收入');
    if (!['single', 'couple'].includes(mode)) throw new RangeError('GIS 仅核定单身及双方全额 OAS');
    const cents = Math.round(income * 100);
    for (const [start, width, count, initial, step] of value('gis_' + mode + '_segments')) {
      const offset = cents - Math.round(start * 100);
      if (offset >= 0 && offset < Math.round(width * count * 100)) return money(initial + step * Math.floor(offset / Math.round(width * 100)));
    }
    return 0;
  }
  function gisExemption(working) {
    const e = value('gis_employment_exemption');
    return Math.min(working, e.full) + Math.min(positive(working - e.full), e.partialEnd - e.full) * e.partialRate;
  }
  function oasRecovery(income, oas) { return Math.min(oas, positive(income - value('oas_threshold')) * value('oas_rate')); }
  function normalize(f) {
    const o = Object.assign({ income: 0, spouseIncome: 0, age: 35, spouseAge: 35, prov: 'BC', married: false,
      children: [], employmentIncome: 0, spouseEmploymentIncome: 0, workingIncome: 0, spouseWorkingIncome: 0,
      oasAnnual: 0, spouseOasAnnual: 0, gisReceived: 0, spouseGisReceived: 0, resident: true,
      fullYearResident: true, ccbEligible: true, cgebEligible: true, cwbEligible: true, fullTimeStudent: false,
      gisMode: 'none', usPerson: false, cppBaseCredit: 0, eiCredit: 0, pensionIncome:0, spousePensionIncome:0 }, f);
    provCheck(o.prov);
    for (const k of ['income','spouseIncome','employmentIncome','spouseEmploymentIncome','workingIncome','spouseWorkingIncome','oasAnnual','spouseOasAnnual','gisReceived','spouseGisReceived','cppBaseCredit','eiCredit','pensionIncome','spousePensionIncome']) number(o[k], k);
    number(o.age, '年龄', 0, 120); number(o.spouseAge, '配偶年龄', 0, 120);
    if (!Array.isArray(o.children) || o.children.length > 20 || o.children.some(a => !Number.isInteger(a) || a < 0 || a > 120)) throw new RangeError('孩子年龄无效');
    if (!o.married && o.spouseIncome !== 0) throw new RangeError('单身情景不能带配偶收入');
    if (o.oasAnnual > o.income || o.spouseOasAnnual > o.spouseIncome) throw new RangeError('收入须包含 OAS（不含 GIS）');
    return o;
  }
  /** Annualized entitlements, NOT the calendar-year payment schedule.
   * income includes OAS but excludes GIS; gisReceived is prior/current actual GIS
   * to include in AFNI, distinct from the newly calculated future GIS entitlement. */
  function benefits(input) {
    const f = normalize(input);
    if (f.dtc) throw new RangeError('DTC/CWB 残障补充额尚未建模');
    if (f.resident === false || f.fullYearResident === false) throw new RangeError('非居民及部分年度居民的福利须按实际日期另算');
    const recoveryA = oasRecovery(f.income + f.gisReceived, f.oasAnnual);
    const recoveryB = f.married ? oasRecovery(f.spouseIncome + f.spouseGisReceived, f.spouseOasAnnual) : 0;
    const netA = positive(f.income + f.gisReceived - recoveryA), netB = f.married ? positive(f.spouseIncome + f.spouseGisReceived - recoveryB) : 0;
    const afni = netA + netB;
    const childCount = f.children.filter(a => a < 19).length;
    const childBenefit = f.ccbEligible ? ccb(afni, f.children) : 0;
    const gst = f.cgebEligible && (f.age >= 19 || f.married || childCount) ? cgeb(afni, childCount, f.married) : 0;
    const c = value('cwb_amounts'), r = value('cwb_rates');
    let worker = 0;
    const eligibleWorker = f.cwbEligible && f.fullYearResident && (f.age >= 19 || f.married || childCount) && !(f.fullTimeStudent && !childCount);
    if (eligibleWorker) {
      let ani = afni;
      if (f.married) {
        const secondaryWorking = Math.min(f.workingIncome, f.spouseWorkingIncome);
        const secondaryNet = f.workingIncome < f.spouseWorkingIncome ? netA : netB;
        ani -= Math.min(secondaryNet, secondaryWorking, c.secondaryExemption);
      }
      const isFamily = f.married || childCount > 0;
      worker = positive(Math.min(isFamily ? c.familyMax : c.singleMax, positive(f.workingIncome + (f.married ? f.spouseWorkingIncome : 0) - c.workingFloor) * r.in) - positive(ani - (isFamily ? c.familyThreshold : c.singleThreshold)) * r.out);
    }
    let gis = 0;
    if (f.gisMode !== 'none') {
      if (f.age < 65 || !f.oasAnnual) throw new RangeError('GIS 情景须年满六十五岁并领取 OAS');
      if (f.gisMode === 'couple' && (!f.married || f.spouseAge < 65 || !f.spouseOasAnnual)) throw new RangeError('夫妻 GIS 模型须双方领取全额 OAS');
      if (f.gisMode === 'single' && f.married) throw new RangeError('已婚不得套单身 GIS 表');
      const income = positive(f.income - f.oasAnnual - gisExemption(f.workingIncome) + (f.married ? f.spouseIncome - f.spouseOasAnnual - gisExemption(f.spouseWorkingIncome) : 0));
      gis = gisMonthly(income, f.gisMode) * 12 * (f.gisMode === 'couple' ? 2 : 1);
    }
    return { ccb: childBenefit, cgeb: gst, cwb: money(worker), gis: money(gis), oasRecovery: money(recoveryA + recoveryB), total: money(childBenefit + gst + worker + gis - recoveryA - recoveryB), afni: money(afni), status: 'fixed_2026_rules', paymentPeriod: 'CCB/CGEB 2026-07..2027-06; GIS 2026-Q3 annualized; CWB/OAS tax year 2026' };
  }
  function familyTax(f) {
    const recovery = oasRecovery(f.income + f.gisReceived, f.oasAnnual);
    const spouseRecovery = f.married ? oasRecovery(f.spouseIncome + f.spouseGisReceived, f.spouseOasAnnual) : 0;
    const familyNet = positive(f.income + f.gisReceived - recovery) + (f.married ? positive(f.spouseIncome + f.spouseGisReceived - spouseRecovery) : 0);
    const own = taxes(positive(f.income - recovery), f.prov, ledger.tax_year, {
      pensionIncome:f.pensionIncome??0, age: f.age, netIncome: positive(f.income + f.gisReceived - recovery), employmentIncome: f.employmentIncome,
      familyNetIncome: familyNet,
      cppBaseCredit: f.cppBaseCredit, eiCredit: f.eiCredit, fullYearResident: f.fullYearResident
    }).total;
    const spouse = f.married ? taxes(positive(f.spouseIncome - spouseRecovery), f.prov, ledger.tax_year, {
      pensionIncome:f.spousePensionIncome??0, age: f.spouseAge, netIncome: positive(f.spouseIncome + f.spouseGisReceived - spouseRecovery),
      employmentIncome: f.spouseEmploymentIncome, familyNetIncome: familyNet,
      cppBaseCredit: f.spouseCppBaseCredit ?? 0, eiCredit: f.spouseEiCredit ?? 0, fullYearResident: f.fullYearResident
    }).total : 0;
    return money(own + spouse);
  }
  function incomeShift(f, delta) {
    const income = positive(f.income + delta);
    // Deducting RRSP does not reduce wages, OAS received, or CWB working income.
    return Object.assign({}, f, { income, oasAnnual: f.oasAnnual });
  }
  function cashEffect(f, delta, pension = false) {
    const changed = incomeShift(f, delta);
    if(pension)changed.pensionIncome=(f.pensionIncome??0)+Math.max(0,delta);
    // A deduction can reduce net income below OAS; benefits' input validation is
    // for gross scenario inputs. Represent the deductible amount separately here.
    const b0 = benefits(f), b1 = benefitsForDeduction(changed, Math.min(0, delta));
    return { tax: money(familyTax(changed) - familyTax(f)), benefitLoss: money(b0.total - b1.total), oasLoss:money(b1.oasRecovery-b0.oasRecovery), gisLoss:money(b0.gis-b1.gis), before: b0, after: b1 };
  }
  function benefitsForDeduction(f, delta) {
    if (delta < 0 && f.income < f.oasAnnual) {
      // OAS still received; GIS assessable income floors at zero. AFNI and OAS
      // recovery still use net income. Internal validated flag is not public.
      return benefits(Object.assign({}, f, { oasAnnual: Math.min(f.oasAnnual, f.income) }));
    }
    return benefits(f);
  }
  function eligible(account, f, amount) {
    const reasons = [];
    if (!['tfsa', 'rrsp', 'fhsa'].includes(account)) throw new RangeError('未知账户');
    if (!f.resident) reasons.push('非居民情景须单独核定预扣、条约及供款资格');
    if (!f.fullYearResident) reasons.push('移民首年/离境年须按实际日期分配抵免与福利，本模型不计算');
    if (f.usPerson) reasons.push('美国纳税人须加入美国税与申报成本，本模型不能给净价值');
    if (account === 'tfsa' && f.age < value('tfsa_age')) reasons.push('未到 TFSA 额度年龄');
    if (account === 'rrsp' && f.age > value('rrsp_age')) reasons.push('本人 RRSP 已过供款年龄；配偶 RRSP 须另算');
    if (account === 'fhsa') {
      if (!f.firstHomeBuyer) reasons.push('尚未确认符合 FHSA 开户首套房条件');
      if (f.age < value('fhsa_min_age') || f.age > value('fhsa_last_age')) reasons.push('不在 FHSA 开户年龄内');
    }
    const room = f[account + 'Room'];
    if (room === undefined || room === null) reasons.push('须输入已核对的个人供款额度');
    else if (amount > number(room, account + 'Room')) reasons.push('供款超过输入的个人剩余额度');
    return reasons;
  }
  /** Same contribution, compared with a taxable, annually taxed interest portfolio.
   * Deduction savings and withdrawals held in cash, not reinvested or discounted.
   * RRSP becomes RRIF at 71; minimum withdrawals use opening value. */
  function accountValue(account, input, amount = 1000, horizon = 5) {
    account = String(account).toLowerCase();
    if((typeof __REGACCT_RDSP__ === 'undefined' || __REGACCT_RDSP__)&&account==='rdsp')return rdspPlan(input,amount,horizon);
    if(account==='rrif')return {...withdrawalPlan({...input,planType:input.planType??'rrif'},amount,input.annualGross??0,horizon,input.returnRate??.04),account:'rrif',netValue:null};
    if((typeof __REGACCT_SAVINGS__ === 'undefined' || __REGACCT_SAVINGS__)){
    const f = normalize(input);
    number(amount, '供款'); number(horizon, '持有年数', 0, 60);
    if (!Number.isInteger(horizon)) throw new RangeError('持有年数须为整数');
    const rate = number(f.returnRate ?? .04, '假设收益率', -.99, .3);
    const reasons = eligible(account, f, amount);
    const fhsaUse = f.fhsaUse ?? 'buy';
    if (!['buy','retirement','taxable'].includes(fhsaUse)) throw new RangeError('FHSA 用途无效');
    const yearsOpen = number(f.fhsaYearsOpen ?? 0, 'FHSA 已开户年数', 0, value('fhsa_years'));
    if (!Number.isInteger(yearsOpen)) throw new RangeError('FHSA 已开户年数须为整数');
    const fhsaRemaining = Math.min(value('fhsa_years') - yearsOpen, value('fhsa_last_age') - f.age);
    if (account === 'fhsa' && fhsaUse !== 'retirement' && horizon > fhsaRemaining) reasons.push('提款超过 FHSA 关闭期限；可改为转 RRSP/RRIF 情景');
    if (reasons.length) return { account, eligible: false, reasons, netValue: null, rows: [] };
    const deduction = account === 'tfsa' ? 0 : Math.min(amount, f.income);
    const contributionEffect = cashEffect(f, -deduction);
    const taxSaving = -contributionEffect.tax, benefitGain = -contributionEffect.benefitLoss;
    let balance = amount, outside = amount, totalWithdrawal = 0, withdrawalTax = 0, withdrawalBenefitLoss = 0;
    const rows = [];
    function atYear(y, terminal) {
      const g = Object.assign({}, f, { age: Math.min(120, f.age + y), spouseAge: Math.min(120, f.spouseAge + y), children: f.children.map(a => a + y) });
      if (terminal && f.withdrawalIncome !== undefined) g.income = number(f.withdrawalIncome, '提款年其他应税收入');
      if (terminal && f.withdrawalSpouseIncome !== undefined) g.spouseIncome = number(f.withdrawalSpouseIncome, '提款年配偶收入');
      // Wages remain fixed unless user supplies a different withdrawal-year figure.
      if (terminal && f.withdrawalWorkingIncome !== undefined) { g.workingIncome = f.withdrawalWorkingIncome; g.employmentIncome = f.withdrawalWorkingIncome; }
      return g;
    }
    for (let y = 1; y <= horizon; y++) {
      const terminal = y === horizon, g = atYear(y, terminal), start = balance;
      const interest = balance * rate;
      balance += interest;
      const outsideInterest = outside * rate;
      const outsideCost = cashEffect(g, Math.max(0, outsideInterest));
      // Negative interest is a capital loss in this simplified scenario; no
      // immediate deduction or welfare windfall is assumed.
      outside = positive(outside + outsideInterest - outsideCost.tax - outsideCost.benefitLoss);
      const pension = account === 'rrsp' || (account === 'fhsa' && fhsaUse === 'retirement' && y > fhsaRemaining);
      let withdrawal = terminal ? balance : (pension && g.age > value('rrsp_age') ? Math.min(balance, start * value('rrif_factors')[String(Math.min(95, g.age))]) : 0);
      const taxable = account === 'rrsp' || (account === 'fhsa' && fhsaUse !== 'buy');
      const cost = withdrawal && taxable ? cashEffect(g, withdrawal) : { tax: 0, benefitLoss: 0 };
      balance -= withdrawal;
      totalWithdrawal += withdrawal; withdrawalTax += cost.tax; withdrawalBenefitLoss += cost.benefitLoss;
      rows.push({ year: y, age: g.age, opening: money(start), growth: money(interest), withdrawal: money(withdrawal), tax: cost.tax, benefitLoss: cost.benefitLoss, closing: money(balance), taxableBaseline: money(outside), accumulatedNetWithdrawals: money(totalWithdrawal - withdrawalTax - withdrawalBenefitLoss) });
    }
    if (horizon === 0) {
      totalWithdrawal = amount; balance = 0;
      const taxable = account === 'rrsp' || (account === 'fhsa' && fhsaUse !== 'buy');
      // Same-year contribution and withdrawal must be netted before tax/benefits.
      const netEffect = cashEffect(f, taxable ? amount - deduction : -deduction);
      return { account, eligible: true, amount, horizon, taxSaving: money(-netEffect.tax), benefitGain: money(-netEffect.benefitLoss), growthAdvantage: 0, withdrawalTax: 0, withdrawalBenefitLoss: 0, netValue: money(-netEffect.tax - netEffect.benefitLoss), registeredNet: amount, taxableBaseline: amount, netContributionCost: money(amount + netEffect.tax + netEffect.benefitLoss), rows, reasons: [], assumptions: '同年供款提款合并计算；FHSA 合资格提款须另满足全部条件。' };
    }
    const growthAdvantage = totalWithdrawal + balance - outside;
    return { account, eligible: true, amount, horizon, taxSaving: money(taxSaving), benefitGain: money(benefitGain), growthAdvantage: money(growthAdvantage), withdrawalTax: money(withdrawalTax), withdrawalBenefitLoss: money(withdrawalBenefitLoss), netValue: money(taxSaving + benefitGain + growthAdvantage - withdrawalTax - withdrawalBenefitLoss), registeredNet: money(totalWithdrawal + balance - withdrawalTax - withdrawalBenefitLoss), taxableBaseline: money(outside), netContributionCost: money(amount - taxSaving - benefitGain), deductionUsed: deduction, deductionDeferred: account === 'tfsa' ? 0 : money(amount - deduction), rows, reasons: [], assumptions: '同额供款；利息型收益；固定已核税制；福利按年化权益估计（通常次期兑现）；节省及已提款现金不再投资；未计福利收入次年再传导、省级福利、费用、通胀和美税。' };
    }
    throw new RangeError('本页未载入该账户的工具，请打开对应独立站');
  }
  function tfsaRoom(o) {
    const year = o.year ?? ledger.tax_year; yearCheck(year);
    number(o.birthYear, '出生年', 1900, year); number(o.residentYear, '税务居民起始年', 1900, year);
    if (!Number.isInteger(o.birthYear) || !Number.isInteger(o.residentYear)) throw new RangeError('年份须为整数');
    const history = o.history ?? {}, excluded = o.nonResidentYears ?? [];
    const first = Math.max(value('tfsa_history')[0][0], o.birthYear + value('tfsa_age'), o.residentYear);
    if (!Array.isArray(excluded) || excluded.some(y => !Number.isInteger(y) || y < o.residentYear || y > year)) throw new RangeError('整年非居民年份无效');
    if (Object.keys(history).some(y => !/^\d{4}$/.test(y) || Number(y) < first || Number(y) > year)) throw new RangeError('交易记录超出合资格年度');
    let room = 0, previousWithdrawals = 0; const rows = [];
    for (let y = Math.max(value('tfsa_history')[0][0], o.birthYear + value('tfsa_age'), o.residentYear); y <= year; y++) {
      const band = value('tfsa_history').find(r => y >= r[0] && y <= r[1]);
      if (!band) throw new RangeError('该年度额度未知');
      const annual = excluded.includes(y) ? 0 : band[2];
      const h = history[y] ?? {};
      const contribution = number(h.contribution ?? 0, '历年供款'), withdrawal = number(h.withdrawal ?? 0, '历年普通提款');
      room += annual + previousWithdrawals - contribution;
      rows.push({ year: y, annual, restored: previousWithdrawals, contribution, withdrawal, remaining: money(room), nonresidentContribution: excluded.includes(y) && contribution > 0 });
      previousWithdrawals = withdrawal;
    }
    const special=rows.some(r => r.remaining < 0 || r.nonresidentContribution);
    return { room: special ? null : money(room), rows, pendingRestoration: previousWithdrawals, warnings: special ? ['记录存在超额或非居民供款，暂不报可再供款额。纠正提款可能不属于普通回补，须按逐日交易核对。'] : [] };
  }
  function rrspRoom(o) {
    const earned = number(o.previousEarnedIncome, '上一年 earned income');
    const current = positive(Math.min(earned * value('rrsp_earned_rate'), value('rrsp_limit')) - number(o.pa ?? 0, 'PA'));
    const deductionLimit = positive(number(o.carry ?? 0, '旧抵扣额度') + current + number(o.par ?? 0, 'PAR') - number(o.pspa ?? 0, 'PSPA'));
    return { newRoom: money(current), deductionLimit: money(deductionLimit), contributionRoom: money(deductionLimit - number(o.undeducted ?? 0, '已存未扣供款')) };
  }
  function fhsaRoom(o) {
    const openYear = number(o.openYear, '开户年', 2023, ledger.tax_year), history = o.history ?? {};
    if (!Number.isInteger(openYear) || Object.keys(history).some(y => !/^\d{4}$/.test(y) || Number(y) < openYear || Number(y) > ledger.tax_year)) throw new RangeError('FHSA 记录年份无效');
    let lifetime = 0, carry = 0; const rows = [];
    for (let y = openYear; y <= ledger.tax_year; y++) {
      const available = Math.max(0, Math.min(value('fhsa_annual') + carry, value('fhsa_lifetime') - lifetime));
      const used = number(history[y] ?? 0, 'FHSA 供款及转入');
      lifetime += used;
      rows.push({ year: y, openingRoom: available, used, remaining: money(available - used) });
      carry = Math.min(value('fhsa_carry'), positive(available - used));
    }
    const special=rows.some(r => r.remaining < 0);
    return { room: special ? null : rows.at(-1).remaining, lifetimeUsed: lifetime, rows, warnings: special ? ['历史超额会影响后续年度参与额度；需加入指定提款、转账与纠正记录，暂不报可再供款额。'] : [] };
  }
  function withdrawalPlan(input, startingBalance, annualGross, years, rate = .04) {
    const f=normalize(input);number(startingBalance,'现有账户余额');number(annualGross,'每年计划税前提款');whole(years,'计划年数',1,60);number(rate,'收益率',-.99,.3);
    const kind=f.planType??'rrsp'; if(!['rrsp','rrif','lif','lira'].includes(kind))throw new RangeError('账户类型无效');
    const reasons=[];
    if(!f.resident||!f.fullYearResident||f.usPerson)reasons.push('此净额只支持全年加拿大居民且无美国纳税义务');
    if(kind==='lira')reasons.push('LIRA 不直接作普通年度现金提款；先按原计划法域核转 LIF/年金或解锁资格');
    if(f.spousalAttribution)reasons.push('可能涉及配偶 RRSP/RRIF 归属，需分别计算双方收入，不能套本表');
    if(kind==='lif'&&(f.firstYear||f.specialTransfer||!['BC','ON'].includes(f.pensionJurisdiction)))reasons.push('本 LIF 只计算 BC/ON 已存在的普通完整年度；首年、特殊转入或其他法域须由机构核定');
    if(reasons.length)return {eligible:false,reasons,rows:[]};
    let balance=startingBalance,netTotal=0,priorReturn=f.previousReturn??0;const rows=[];
    for(let y=1;y<=years;y++){
      const g={...f,age:Math.min(119,f.age+y-1),spouseAge:Math.min(119,f.spouseAge+y-1),children:f.children.map(a=>a+y-1)};
      const ageEnd=Math.min(120,(f.ageAtYearEnd??f.age+1)+y-1);
      const opening=balance,growth=opening*rate,electedAge=f.electedAge===undefined||f.electedAge===null?undefined:Math.min(120,f.electedAge+y-1);
      const hasRrif=kind!=='rrsp'||g.age>value('rrsp_age');
      const minInfo=hasRrif?rrifMinimum(opening,g.age,{firstYear:!!f.firstYear&&y===1,electedAge}):{minimum:0,factor:0};
      const minimum=minInfo.minimum;
      const maxInfo=kind==='lif'?lifMaximum({jurisdiction:f.pensionJurisdiction,balance:opening,age:g.age,ageAtYearEnd:ageEnd,electedAge,previousReturn:priorReturn}):null;
      const maximum=maxInfo?maxInfo.maximum:null;
      const gross=Math.min(opening+growth,maximum??Infinity,Math.max(annualGross,minimum));
      const effect=cashEffect(kind==='rrsp'?g:{...g,age:ageEnd,spouseAge:Math.min(120,g.spouseAge+1)},gross,hasRrif&&ageEnd>=value('rrif_pension_age')),net=gross-effect.tax-effect.benefitLoss;
      balance=positive(opening+growth-gross);netTotal+=net;priorReturn=growth;
      rows.push({year:y,age:g.age,ageAtYearEnd:ageEnd,opening:money(opening),growth:money(growth),minimum,factor:minInfo.factor,maximum,gross:money(gross),tax:effect.tax,benefitLoss:effect.benefitLoss,oasLoss:effect.oasLoss,gisLoss:effect.gisLoss,net:money(net),closing:money(balance)});
    }
    return {eligible:true,rows,netTotal:money(netTotal),remaining:money(balance),reasons:[],assumptions:'现有账户，不再给供款抵扣。最低额按年初年龄；普通 RRIF 按年底满六十五岁起计养老金收入抵免。年初余额先计收益再取；其他收入、养老金与当年规则固定，福利按年化权益、通常次期兑现；零费用、零折现，未计通胀、省级福利、所得分割及抵免转让。'};
  }
  function whole(v, label, min=0, max=120) {
    number(v,label,min,max); if(!Number.isInteger(v))throw new RangeError(label+' 须为整数'); return v;
  }
  /** Ordinary modern RRIF, FMV and whole age at Jan 1; election already made. */
  function rrifMinimum(balance, age, options={}) {
    number(balance,'年初余额');whole(age,'年初年龄');
    const elected=options.electedAge===undefined||options.electedAge===null?age:whole(options.electedAge,'已选配偶年初年龄');
    const r=value('rrif_minimum');
    const factor=elected<r.formulaAge?1/(r.denominatorAge-elected):value('rrif_factors')[String(Math.min(r.maxFactorAge,elected))];
    return {factor,ageUsed:elected,minimum:options.firstYear?0:money(balance*factor),firstYear:!!options.firstYear};
  }
  /** Existing full-year BC or ON Schedule 1.1 LIF. Jurisdiction != residence. */
  function lifMaximum(o) {
    const jurisdiction=o.jurisdiction;
    if(!['BC','ON'].includes(jurisdiction))return {eligible:false,reasons:['先按原养老金适用法律核对；此法域尚无已核 LIF 上限'],maximum:null};
    if(o.firstYear||o.specialTransfer)return {eligible:false,reasons:['首年、同年跨 LIF 转入或上年转入收益须由机构核定，不能套普通完整年度上限'],maximum:null};
    const balance=number(o.balance,'LIF 年初余额'),age=whole(o.age,'年初年龄');
    const ageEnd=whole(o.ageAtYearEnd??age+1,'年底年龄');
    if(ageEnd<age||ageEnd>age+1)throw new RangeError('年底年龄须等于年初年龄或多一岁');
    const r=value(jurisdiction==='BC'?'lif_BC':'lif_ON');
    const years=Math.max(1,r.terminalAge-(jurisdiction==='BC'?age:ageEnd)+1);
    // BC's published table uses 90-age beginning-year advance payments (50 -> 6.26996%).
    const periods=jurisdiction==='BC'?Math.max(1,r.terminalAge-age):years;
    const firstRate=Math.max(r.floorRate,value('lif_bond_rate'));
    let pv=0; for(let i=0;i<periods;i++)pv+=1/(Math.pow(1+firstRate,Math.min(i,r.firstYears))*Math.pow(1+r.laterRate,Math.max(0,i-r.firstYears)));
    const minimum=rrifMinimum(balance,age,{electedAge:o.electedAge}).minimum;
    const formula=balance/pv,prior=number(o.previousReturn??0,'上年 LIF 实际收益',-1e9);
    const maximum=Math.min(balance,Math.max(formula,minimum,prior));
    return {eligible:true,reasons:[],factor:1/pv,formula:money(formula),minimum,maximum:money(maximum),jurisdiction,ageUsed:jurisdiction==='BC'?age:ageEnd};
  }
  /** Current-year total contribution, with optional verified historical entitlements. */
  function rdspSupport(o) {
    const age=whole(o.ageAtYearEnd,'受益人当年达到年龄'),contribution=number(o.contribution??0,'本年供款');
    const income=number(o.familyIncome,'补助收入基年家庭收入');
    const used=number(o.lifetimeContributions??0,'历年私人供款及 rollover'),grantUsed=number(o.grantUsed??0,'终身已获 grant'),bondUsed=number(o.bondUsed??0,'终身已获 bond');
    const g=value('rdsp_grant_bands'),b=value('rdsp_bond'),c=value('rdsp_carry');
    const reasons=[];
    if(o.dtcEligible!==true)reasons.push('需确认受益人本年 DTC 已获批；诊断或省福利资格不代替批准');
    if(o.resident!==true)reasons.push('供款时受益人须符合加拿大居民条件');
    if(o.incomeFiled!==true)reasons.push('收入基年或报税记录未确认，先核补助权益通知');
    if(age>value('rdsp_contribution_age'))reasons.push('已超过新供款年龄；既有账户请用提款工具');
    if(used+contribution>value('rdsp_lifetime'))reasons.push('本次供款会超过终身私人供款与 rollover 上限');
    if(grantUsed>g.lifetimeMax||bondUsed>b.lifetimeMax)throw new RangeError('历史补助超过终身上限，请核记录');
    if(reasons.length)return {eligible:false,reasons,grant:null,bond:null,room:Math.max(0,value('rdsp_lifetime')-used)};
    const room=money(value('rdsp_lifetime')-used-contribution);
    if(age>value('rdsp_grant_age'))return {eligible:true,reasons:[],grant:0,bond:0,total:0,room,unmatched:contribution,allocation:[]};
    const currentYear=ledger.tax_year;
    const entitlements=(o.carryGrants??[]).map(r=>({...r}));
    const seen=new Set();
    for(const r of entitlements){whole(r.year,'补领年度',currentYear-c.years,currentYear-1);number(r.remainingContribution,'已核未用配比本金');if(![1,2,3].includes(r.rate))throw new RangeError('未用权益的配比无效');if(seen.has(r.year+':'+r.rate))throw new RangeError('同年同率权益不可重复');seen.add(r.year+':'+r.rate);const max=r.rate===3?g.firstContribution:g.secondContribution;if(r.remainingContribution>max)throw new RangeError('该年该档的未用配比本金过大');}
    if(income<=value('rdsp_grant_threshold'))entitlements.push({year:currentYear,rate:g.firstRate,remainingContribution:g.firstContribution},{year:currentYear,rate:g.secondRate,remainingContribution:g.secondContribution});
    else entitlements.push({year:currentYear,rate:g.highRate,remainingContribution:g.highContribution});
    entitlements.sort((a,b)=>b.rate-a.rate||a.year-b.year);
    let remaining=contribution,grant=0;const allocation=[];
    const grantCap=Math.min(c.grantMax,g.lifetimeMax-grantUsed);
    for(const e of entitlements){const applied=Math.min(remaining,e.remainingContribution,Math.max(0,(grantCap-grant)/e.rate));if(applied>0){const paid=applied*e.rate;allocation.push({year:e.year,rate:e.rate,contribution:money(applied),grant:money(paid)});grant+=paid;remaining-=applied;}}
    let bond=income<=b.fullThreshold?b.annualMax:income>=b.zeroThreshold?0:b.annualMax*(b.zeroThreshold-income)/(b.zeroThreshold-b.fullThreshold);
    const seenBonds=new Set();for(const r of o.carryBonds??[]){whole(r.year,'bond 补领年度',currentYear-c.years,currentYear-1);number(r.amount,'已核未领 bond',0,b.annualMax);if(seenBonds.has(r.year))throw new RangeError('bond 年份重复');seenBonds.add(r.year);bond+=r.amount;}
    bond=Math.min(bond,c.bondMax,b.lifetimeMax-bondUsed);
    return {eligible:true,reasons:[],grant:money(grant),bond:money(bond),total:money(grant+bond),room,unmatched:money(remaining),allocation};
  }
  function rdspHoldback(events, at) {
    const parse=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new RangeError('日期须为年月日');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw new RangeError('日期不存在');return d;};
    const when=parse(at),cut=new Date(+when);cut.setUTCFullYear(cut.getUTCFullYear()-value('rdsp_repayment').years);
    if(!Array.isArray(events))throw new RangeError('补助记录须为数组');
    let amount=0; for(const e of events){const date=parse(e.date),paid=number(e.amount,'实际补助'),repaid=number(e.repaid??0,'该笔已退补助',0,paid);if(date>when)throw new RangeError('入账日期晚于提款日期');if(date>cut)amount+=paid-repaid;}
    return money(amount);
  }
  function rdspRepayment(o) {
    const age=whole(o.ageAtYearEnd,'年底年龄'),withdrawal=number(o.withdrawal??0,'提款'),balance=number(o.balance,'提款前资产'),aha=number(o.holdback,'机构确认 AHA');
    if(o.dtcEligible!==true)return {eligible:false,reasons:['失去 DTC 的回收窗口须按日期及条例另核'],repayment:null};
    if(o.sdsp)return {eligible:false,reasons:['SDSP 与预期寿命缩短情景须单独办理'],repayment:null};
    const r=value('rdsp_repayment');
    return {eligible:true,reasons:[],repayment:age>=r.noRepaymentAge?0:money(Math.min(balance,aha,o.event==='close'||o.event==='death'?aha:r.ratio*withdrawal))};
  }
  /** No annuities, advantage-tax adjustments, SDSP or special transfer year. */
  function rdspWithdrawal(o) {
    const balance=number(o.balance,'提款前资产'),opening=number(o.openingBalance??balance,'年初资产'),principal=number(o.privatePrincipal,'未取出的普通私人本金'),aha=number(o.holdback??0,'机构确认 AHA'),w=number(o.withdrawal,'本年合计提款');
    const age=whole(o.age,'年初年龄'),ageEnd=whole(o.ageAtYearEnd??age+1,'年底年龄');
    if(ageEnd<age||ageEnd>age+1)throw new RangeError('年初和年底年龄不一致');
    if(typeof o.pgap!=='boolean')throw new RangeError('须确认本年是否政府主要资助计划 PGAP');
    if(aha>balance||principal>balance-aha+.01)throw new RangeError('资产亏损或 AHA/本金记录需要机构核定，不能套简式免税比例');
    const r=value('rdsp_ldap'),ldap=opening/(Math.max(r.baseAge,age)+r.offset-age);
    const maximum=o.pgap?Math.max(ldap,opening*value('rdsp_pgap_rate')):balance-aha;
    const min=ageEnd>=value('rdsp_payment_age')?Math.min(ldap,balance):0;
    const rep=rdspRepayment({...o,balance,withdrawal:w,holdback:aha,ageAtYearEnd:ageEnd});
    const reasons=[...rep.reasons];
    if(w>maximum+.011)reasons.push('超过本情景年度 DAP 上限');
    if(w<min-.011)reasons.push('已到必须年度付款的阶段，低于本情景 LDAP 最低付款');
    if(w>balance-aha+.011||rep.repayment!==null&&w+rep.repayment>balance+.011)reasons.push('提款及回收后资产不足，须由机构核可付金额');
    if(reasons.length)return {eligible:false,reasons,minimum:money(min),maximum:money(maximum),ldap:money(ldap),repayment:rep.repayment};
    const nonTaxable=Math.min(w,balance>aha?w*principal/(balance-aha):0);
    return {eligible:true,reasons:[],minimum:money(min),maximum:money(maximum),ldap:money(ldap),gross:money(w),nonTaxable:money(nonTaxable),taxable:money(w-nonTaxable),repayment:rep.repayment,closing:money(balance-w-rep.repayment),remainingPrincipal:money(principal-nonTaxable)};
  }
  /** Adult beneficiary tax only: RDSP is excluded from specified benefit tests. */
  function rdspTax(input,taxable) {
    const f=normalize({...input,dtc:false});number(taxable,'RDSP 应税提款');
    if(f.age<18)return {tax:null,reason:'未成年 DTC 补充额、转让及家庭照护抵免未模拟'};
    const opts={age:f.age,employmentIncome:f.employmentIncome,netIncome:f.income+f.gisReceived,disabilityCredit:true,familyNetIncome:f.income+f.gisReceived+f.spouseIncome};
    // RDSP is in net income for non-refundable credit reductions, but excluded
    // from OAS recovery and the supported refundable-benefit income bases.
    const recovery=oasRecovery(f.income+f.gisReceived,f.oasAnnual);
    const before=taxes(Math.max(0,f.income-recovery),f.prov,ledger.tax_year,{...opts,netIncome:opts.netIncome-recovery}).total;
    const after=taxes(Math.max(0,f.income-recovery)+taxable,f.prov,ledger.tax_year,{...opts,netIncome:opts.netIncome-recovery+taxable}).total;
    return {tax:money(after-before),benefitLoss:0,reason:'指定联邦福利排除 RDSP 收入；省级及其他残障福利不在此净额内'};
  }
  function rdspPlan(input,amount,horizon) {
    number(amount,'一次供款');whole(horizon,'模拟年数',1,60);
    const f={age:35,prov:'BC',returnRate:.04,...input},ageEnd=whole(f.ageAtYearEnd??f.age,'本年达到年龄');
    const rate=number(f.returnRate,'收益率',-.99,.3);
    const first=rdspSupport({ageAtYearEnd:ageEnd,familyIncome:f.rdspFamilyIncome??f.income,contribution:amount,dtcEligible:f.dtcEligible,resident:f.resident,incomeFiled:f.incomeFiled,lifetimeContributions:f.rdspContributions??0,grantUsed:f.rdspGrantUsed??0,bondUsed:f.rdspBondUsed??0,carryGrants:f.carryGrants,carryBonds:f.carryBonds});
    const reasons=[...first.reasons];
    if(f.usPerson||f.fullYearResident===false)reasons.push('美国税与首年/离境年资格需另核，不给净价值');
    if(f.rdspContributions||f.rdspGrantUsed||f.rdspBondUsed)reasons.push('已有 RDSP 请用补助/提款工具核历史，本逐年表只演示零历史的新账户');
    if(reasons.length)return {account:'rdsp',eligible:false,reasons,netValue:null,rows:[]};
    let balance=0,principal=0,grantTotal=0,bondTotal=0,netTotal=0,repaymentTotal=0;const rows=[];
    for(let y=1;y<=horizon;y++){
      const endAge=ageEnd+y-1,startAge=endAge-1,opening=balance,growth=opening*rate;
      const contribution=y===1?amount:0,grant=y===1?first.grant:0;
      const b=value('rdsp_bond');
      const annualBond=(f.rdspFamilyIncome??f.income)<=b.fullThreshold?b.annualMax:(f.rdspFamilyIncome??f.income)>=b.zeroThreshold?0:b.annualMax*(b.zeroThreshold-(f.rdspFamilyIncome??f.income))/(b.zeroThreshold-b.fullThreshold);
      const bond=y===1?first.bond:endAge<=value('rdsp_grant_age')?money(Math.min(b.annualMax,annualBond,b.lifetimeMax-bondTotal)):0;
      balance+=growth+contribution+grant+bond;principal+=contribution;grantTotal+=grant;bondTotal+=bond;
      let gross=0,taxable=0,tax=0,repayment=0;
      if(endAge>=value('rdsp_payment_age')&&balance>0){
        const r=value('rdsp_ldap');gross=Math.min(balance,opening/(Math.max(r.baseAge,startAge)+r.offset-startAge));
        // All deposits in this scenario cease by 49: after 60 there is no AHA.
        const nonTaxable=balance?gross*Math.min(1,principal/balance):0;principal-=nonTaxable;taxable=gross-nonTaxable;
        const t=rdspTax({...f,age:endAge,income:f.withdrawalIncome??f.income},taxable);tax=t.tax;balance-=gross;netTotal+=gross-tax;
      }
      rows.push({year:y,calendarYear:ledger.tax_year+y-1,age:endAge,opening:money(opening),contribution,grant:money(grant),bond:money(bond),growth:money(growth),gross:money(gross),taxable:money(taxable),tax:money(tax),repayment,net:money(gross-tax),closing:money(balance)});
    }
    return {account:'rdsp',eligible:true,reasons:[],rows,netValue:null,amount,horizon,firstYear:first,supportTotal:money(grantTotal+bondTotal),netTotal:money(netTotal),remaining:money(balance),repaymentTotal,assumptions:'一次供款，年末供款/补助入账后次年开始计收益；以后只继续合资格 bond。收入与规则固定，不预测未来门槛；六十岁当年起按 LDAP 公式付款。未提款资产未扣未来税，不可当成可用现金；零费用、零折现、不计通胀，未计省级福利与 DTC 转让。'};
  }

  function fhsaDates(o) {
    number(o.birthYear,'出生年份',1900,ledger.tax_year);number(o.openYear,'FHSA 开户年份',2023,ledger.tax_year);
    if(!Number.isInteger(o.birthYear)||!Number.isInteger(o.openYear))throw new RangeError('年份须为整数');
    if(o.openYear-o.birthYear<value('fhsa_min_age')||o.openYear-o.birthYear>value('fhsa_last_age'))throw new RangeError('开户年份不符合年龄范围；临近生日请按实际生日核定');
    const readDate=(v)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))throw new RangeError('请填完整日期');const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)throw new RangeError('日期不存在');return d;};
    const withdrawal=readDate(o.withdrawalDate),acquire=readDate(o.acquisitionDate),agreement=readDate(o.agreementDate);
    const year=withdrawal.getUTCFullYear(),conditions=value('fhsa_withdraw_conditions');
    const naturalEnd=Math.min(o.openYear+value('fhsa_years'),o.birthYear+value('fhsa_last_age'));
    const checks=[
      ['提款在首次开户之后的有效期间',year>=o.openYear&&year<=naturalEnd],
      ['提款时已经签订书面协议',agreement<=withdrawal],
      ['取得住宅不早于提款前允许天数',withdrawal-acquire<=conditions.afterAcquisitionDays*86400000],
      ['取得住宅早于提款下一年的法定截止日',acquire<Date.UTC(year+1,conditions.acquireBeforeMonth-1,conditions.acquireBeforeDay)],
      ['确认符合提款用的首套房测试',o.firstHomeWithdrawal===true],
      ['确认住宅位于加拿大且属于合资格住宅',o.qualifyingHome===true],
      ['确认所需期间持续为加拿大税务居民',o.residentThroughPurchase===true],
      ['确认在规定期限内入住或有意作为主要居所',o.occupancyIntent===true],
      ['确认没有未纠正的 FHSA 超额',o.noExcess===true]
    ];
    return {checks:checks.map(([label,pass])=>({label,pass})),passes:checks.every(x=>x[1]),naturalCloseYear:naturalEnd,afterWithdrawalCloseYear:Math.min(naturalEnd,year+value('fhsa_close_after_buy')),acquireBefore:`${year+1}-${String(conditions.acquireBeforeMonth).padStart(2,'0')}-${String(conditions.acquireBeforeDay).padStart(2,'0')}`,note:'这是根据输入的日期与自报条件核对；仍须填 RC725 并由机构办理，非 CRA 资格裁定。'};
  }
  return Object.freeze({ value, taxes, benefits, accountValue, withdrawalPlan, rrifMinimum, lifMaximum, ccb, cgeb, gisMonthly, gisExemption, oasRecovery, basicPersonal, bracketTax, money, ...((typeof __REGACCT_SAVINGS__ === 'undefined' || __REGACCT_SAVINGS__)?{tfsaRoom,rrspRoom,fhsaRoom,fhsaDates}:{}), ...((typeof __REGACCT_RDSP__ === 'undefined' || __REGACCT_RDSP__)?{rdspSupport,rdspHoldback,rdspRepayment,rdspWithdrawal,rdspTax,rdspPlan}:{}) });
});
