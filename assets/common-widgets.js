(function(){'use strict';const D=window.ACCOUNT_DATA;
  document.documentElement.classList.add('js');
  const theme=document.getElementById('theme-toggle');
  try{const saved=localStorage.getItem('accounts-theme');if(['dark','light'].includes(saved))document.documentElement.dataset.theme=saved;}catch(_){}
  if(theme)theme.addEventListener('click',()=>{const dark=document.documentElement.dataset.theme==='dark'||(!document.documentElement.dataset.theme&&matchMedia('(prefers-color-scheme: dark)').matches);const next=dark?'light':'dark';document.documentElement.dataset.theme=next;theme.setAttribute('aria-label',next==='dark'?'切换浅色模式':'切换深色模式');try{localStorage.setItem('accounts-theme',next);}catch(_){}});
  const quiz=document.getElementById('quiz');if(quiz)quiz.addEventListener('submit',e=>{e.preventDefault();if(!quiz.reportValidity())return;const score={scenario:[0,0],myth:[0,0]};
    quiz.querySelectorAll('fieldset').forEach((box,i)=>{const ok=Number(quiz.elements.namedItem('q'+i).value)===D.quiz[i].answer,s=score[box.dataset.kind]||score.scenario;s[1]++;if(ok)s[0]++;
      let fb=box.querySelector('.feedback');if(!fb){fb=document.createElement('div');fb.className='feedback';box.appendChild(fb);}
      const src=document.getElementById('answer-'+i);fb.innerHTML='<p><b>'+(ok?'答对':'答错')+'</b></p>'+(src?src.innerHTML:'');fb.dataset.ok=ok?'1':'0';});
    quiz.classList.add('answered');const parts=[];if(score.scenario[1])parts.push(`情景题答对 ${score.scenario[0]} / ${score.scenario[1]}`);if(score.myth[1])parts.push(`误区快测答对 ${score.myth[0]} / ${score.myth[1]}`);
    document.getElementById('quiz-score').textContent=parts.join('，')+'。';});
})();
