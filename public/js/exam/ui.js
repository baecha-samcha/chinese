import { el,button,download } from '../utils.js';
import { examBlueprint } from './blueprint.js';
import { buildBank } from './bank.js';
import { validateBank } from './validation.js';
import { SESSION_KEY,HISTORY_KEY,readSession,startExam,saveAnswer,submitExam,remaining,answered,gradeExam,saveManualScore } from './engine.js';
const symbols=['①','②','③','④','⑤','⑥'];
const scoreText=n=>Number(n.toFixed(2)).toString();
export function renderBlock(block) {
  if(block.kind==='menu')return el('table',{class:'exam-menu'},el('caption',{},'메뉴'),el('thead',{},el('tr',{},el('th',{},'품목'),el('th',{},'가격 (1개)'))),el('tbody',{},block.rows.map(row=>el('tr',{},row.map(v=>el('td',{lang:'zh-CN'},v))))));
  if(block.kind==='figure')return el('figure',{class:'exam-figure'},el('span',{class:'exam-picture',role:'img','aria-label':block.caption||'문항 그림'},block.symbol),block.caption?el('figcaption',{},block.caption):null);
  if(block.kind==='map') {
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 400 280');svg.setAttribute('role','img');svg.setAttribute('aria-label','중국 개략도. A는 북쪽, B는 남쪽 영역에 표시되어 있습니다.');
    const path=document.createElementNS(ns,'path');path.setAttribute('d','M28 97L55 74 69 41 91 48 104 26 126 54 154 59 180 78 203 74 234 61 259 42 274 28 286 38 301 20 309 53 342 64 352 82 329 111 303 114 315 139 307 161 323 180 302 205 276 217 259 235 225 243 202 230 178 238 153 218 119 222 102 199 73 186 70 166 47 153 24 129Z');path.setAttribute('fill','#f1eddf');path.setAttribute('stroke','#5b675f');path.setAttribute('stroke-width','2');svg.append(path);
    for(const m of block.marks){const g=document.createElementNS(ns,'g');const c=document.createElementNS(ns,'circle');c.setAttribute('cx',m.x*4);c.setAttribute('cy',m.y*2.8);c.setAttribute('r','14');c.setAttribute('fill','#243e31');const t=document.createElementNS(ns,'text');t.setAttribute('x',m.x*4);t.setAttribute('y',m.y*2.8+5);t.setAttribute('text-anchor','middle');t.setAttribute('fill','white');t.textContent=m.label;g.append(c,t);svg.append(g);}
    return el('figure',{class:'exam-map'},svg,el('figcaption',{},'학습용 개략도 · 북방/남방의 위치 표시이며 정확한 경계·축척을 뜻하지 않습니다.'));
  }
  return el('div',{class:block.kind==='bubbles'?'exam-bubbles':'exam-box'},(block.lines||[]).map(line=>el('p',{lang:'zh-CN'},line)));
}
export async function renderExam(root) {
  let session=null,timer,disposed=false,scope=null;
  const error=el('p',{class:'exam-storage-error',role:'alert',hidden:true});
  function report(e){error.hidden=false;error.textContent=e.message;}
  function exportCurrent(){download(`중국어-실전시험-${session?.id||'백업'}.json`,session?JSON.stringify(session,null,2):localStorage.getItem(SESSION_KEY)||'{}');}
  try {session=readSession();}catch(e){root.replaceChildren(el('h1',{},'저장된 시험 확인이 필요합니다.'),el('p',{},e.message),button('저장 원본 내려받기',exportCurrent),button('저장된 시험 초기화',()=>{if(confirm('저장된 시험을 내려받았나요? 초기화하면 이 시험의 답안이 삭제됩니다.')){localStorage.removeItem(SESSION_KEY);location.reload();}}));return ()=>{};}
  async function getScope(){if(scope)return scope;const r=await fetch('/data/exam-scope.json');if(!r.ok)throw Error('시험 범위 데이터를 불러오지 못했습니다. 연결 후 다시 시도해 주세요.');scope=await r.json();return scope;}
  function updateStatus(){
    if(!session)return;
    const count=session.questions.filter(q=>answered(q,session.responses[q.slot])).length;
    const summary=root.querySelector('[data-exam-progress]');if(summary)summary.textContent=`답안 작성 ${count} / ${session.questions.length}`;
    for(const q of session.questions){const n=root.querySelector(`[data-jump="${q.slot}"]`);if(n){const done=answered(q,session.responses[q.slot]);n.classList.toggle('answered',done);n.setAttribute('aria-label',`${q.slot} ${done?'응답 완료':'미응답'}`);}}
    const clock=root.querySelector('[data-exam-clock]');
    if(clock){const seconds=Math.ceil(remaining(session)/1000);clock.textContent=session.status==='submitted'?'제출 완료':`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
  }
  function tick(){
    if(disposed||!session)return;
    if(session.status==='active'&&!remaining(session)) {try{session=submitExam(session);draw();}catch(e){report(e);root.querySelectorAll('input,textarea').forEach(i=>i.disabled=true);}}
    updateStatus();
  }
  function change(q,value,field){
    try{session=saveAnswer(session,q.slot,value,{field});error.hidden=true;if(session.status==='submitted')draw();else updateStatus();}catch(e){report(e);}
  }
  function finish(){
    const missing=session.questions.filter(q=>!answered(q,session.responses[q.slot])).length;
    const dialog=el('dialog',{class:'exam-confirm'},el('h2',{},'답안을 제출할까요?'),el('p',{},missing?`${missing}개 문항에 작성하지 않은 답이 있습니다.`:'모든 문항에 답을 작성했습니다.'),el('p',{},'제출 후에는 답안을 수정할 수 없습니다. 서술형 일부는 기준표로 직접 채점합니다.'),button('계속 풀기',()=>dialog.close()),button('제출하기',()=>{try{session=submitExam(session);dialog.close();draw();}catch(e){report(e);}},'primary'));
    root.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  }
  function draw(){
    if(disposed)return;
    clearInterval(timer);
    const submitted=session.status==='submitted',results=submitted?gradeExam(session):null;
    const top=el('div',{class:'exam-toolbar'},el('div',{},el('span',{class:'eyebrow'},'실전처럼 시험보기'),el('h1',{},'중국어 I 실전 모의시험')),el('div',{class:'exam-live'},el('strong',{'data-exam-clock':'','aria-label':'남은 시간'}),el('span',{'data-exam-progress':''})),button('답안 JSON 내려받기',exportCurrent),submitted?button('새 시험 만들기',()=>lobby()):button('시험 제출',finish,'primary'));
    const paper=el('div',{class:'exam-paper'});
    const nav=el('aside',{class:'exam-answer-sheet','aria-label':'답안 현황'},el('h2',{},'답안 현황'),el('p',{},'채워진 번호는 답안 작성 완료'),el('div',{class:'exam-numbers'},session.questions.map(q=>button(q.slot,()=>root.querySelector(`#exam-${q.slot}`).scrollIntoView({behavior:'smooth',block:'start'})))));
    [...nav.querySelectorAll('button')].forEach((b,i)=>b.dataset.jump=session.questions[i].slot);
    if(results)paper.append(el('section',{class:'exam-results','aria-label':'시험 결과'},el('h2',{},`채점된 점수 ${scoreText(results.score)} / ${results.max}`),el('p',{},results.pending?`${scoreText(results.pending)}점은 수동 채점 대기입니다. 아래 기준표를 확인하여 직접 채점하세요.`:'채점을 마쳤습니다. 수동 점수는 자기 채점 결과입니다.'),el('p',{},'부분 점수가 반영됩니다. 정답·해설은 제출 후에만 표시됩니다.')));
    paper.append(el('div',{class:'exam-paper-heading'},el('h2',{},'중국어 I'),el('p',{},'객관식 23문항 · 서답형 3문항 · 서술형 3문항 / 100점 / 50분'),el('p',{},'한자 답안은 간체자로 씁니다. 범위: 교과서·2026 보충자료의 기존 학습 데이터.')));
    let section='';
    session.questions.forEach((q,index)=>{
      if(q.section!==section){section=q.section;paper.append(el('h2',{class:'exam-section'},section));}
      const article=el('article',{class:'exam-question',id:`exam-${q.slot}`,tabIndex:-1},el('h3',{},el('span',{class:'exam-question-number'},q.slot),` ${q.prompt} `,el('small',{},`[${q.points}점]`)));
      if(q.group&&q.slot!=='Q11')article.append(el('p',{class:'exam-shared-note'},'Q11 위의 공통 대화를 참고하세요.'));
      else article.append(...q.blocks.map(renderBlock));
      const response=session.responses[q.slot];
      if(q.choices){
        const fieldset=el('fieldset',{class:'exam-choices',disabled:submitted},el('legend',{class:'sr-only'},`${q.slot} 답안 선택`));
        q.choices.forEach((c,i)=>fieldset.append(el('label',{},el('input',{type:'radio',name:q.slot,value:c,checked:response===c,onChange:()=>change(q,c)}),el('span',{},`${symbols[i]} ${c}`))));article.append(fieldset);
      } else {
        const area=el('div',{class:'exam-written'});
        q.fields.forEach(f=>{
          const attrs={id:`${q.slot}-${f.id}`,name:`${q.slot}-${f.id}`,value:response?.[f.id]||'',disabled:submitted,autocomplete:'off',spellcheck:false,maxLength:1500,onInput:e=>{if(!e.isComposing)change(q,e.target.value,f.id);},onCompositionend:e=>change(q,e.target.value,f.id)};
          const input=f.mode==='manual'?el('textarea',{...attrs,rows:3}):el('input',{...attrs,type:'text'});
          area.append(el('label',{htmlFor:attrs.id},f.label),input);
        });article.append(area);
      }
      if(submitted){
        const result=results.questions[index];
        const feedback=el('div',{class:'exam-feedback'},el('strong',{},`${scoreText(result.score)} / ${q.points}점${result.pending?' · 수동 채점 대기':''}`),q.choices?el('p',{},`정답: ${symbols[q.choices.indexOf(q.answer)]} ${q.answer}`):el('div',{},q.fields.map(f=>el('p',{},`${f.label}: ${f.answers.length?f.answers.join(' / '):'아래 핵심 내용으로 검토'}`))),el('p',{class:'exam-explanation'},q.explanation));
        if(q.translationKeyTerms)feedback.append(el('p',{},`번역 핵심: ${q.translationKeyTerms.join(' · ')} (단순 키워드 일치만으로 자동 채점하지 않습니다.)`));
        for(const part of result.parts.filter(p=>p.mode==='manual')) {
          const f=q.fields.find(f=>f.id===part.id),key=`${q.slot}.${part.id}`;
          const select=el('select',{'aria-label':`${q.slot} ${f.label} 자기 채점`,onChange:e=>{if(e.target.value==='')return;try{session=saveManualScore(session,q.slot,part.id,Number(e.target.value));draw();}catch(e){report(e);}}},el('option',{value:''},'채점 대기'),Array.from({length:part.max+1},(_,i)=>el('option',{value:String(i)},`${i}점 / ${part.max}점`)));
          select.value=session.manualScores?.[key]===undefined?'':String(session.manualScores[key]);feedback.append(el('label',{},`${f.label} · 자기 채점 `,select));
        }
        feedback.append(el('small',{},`출처 ${q.sourceRefs.map(r=>`${r.table} #${r.id}`).join(', ')} · ${q.id}`));article.append(feedback);
      }
      paper.append(article);
    });
    root.replaceChildren(el('div',{class:'exam-mode'},top,error,el('div',{class:'exam-layout'},paper,nav)));
    updateStatus();timer=setInterval(tick,1000);
  }
  async function lobby(){
    clearInterval(timer);
    root.replaceChildren(el('div',{class:'card'},el('h1',{},'실전처럼 시험보기'),el('p',{},'시험 데이터를 확인하고 있습니다…')));
    try {
      const data=await getScope();if(disposed)return;
      const report=validateBank(buildBank(data),data);if(report.errors.length)throw Error(report.errors.join('\n'));
      const current=readSession();
      const panel=el('section',{class:'exam-lobby card'},el('span',{class:'eyebrow'},'CHINESE I · PRACTICE EXAM'),el('h1',{},'실전처럼 시험보기'),el('p',{},'29문항 · 100점 · 50분. 실제 시험처럼 문제지를 읽고 답안지를 완성하세요.'),el('ul',{},el('li',{},'각 문항 위치의 변형 중 하나가 출제됩니다. 시험 중 문제는 바뀌지 않습니다.'),el('li',{},'답안은 입력 즉시 이 브라우저에 저장됩니다. 새로고침하거나 다른 화면으로 이동해도 시간은 계속 흐릅니다.'),el('li',{},'시간이 끝나면 자동 제출됩니다. 설명·번역·문화 특징은 제출 후 기준표로 직접 채점합니다.')),el('p',{class:'note'},'현재 자료로 구성한 연습시험입니다. 기출 4페이지와 PDF 원본은 저장소에 없어 원본 대조는 미완료입니다. 문화 지도는 확인된 북방·남방 음식 1종으로 출제됩니다.'),error);
      panel.append(button(current?.status==='active'?'이어서 풀기':'50분 시험 시작',()=>{try{session=startExam(data);draw();tick();}catch(e){report(e);}},'primary'));
      if(current?.status==='submitted')panel.append(button('마지막 결과 보기',()=>{session=current;draw();}));
      let history=[];try{history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');}catch{}
      if(history.length)panel.append(el('details',{},el('summary',{},`이전 시험 기록 ${history.length}회`),history.slice().reverse().map(s=>el('div',{},new Date(s.createdAt).toLocaleString('ko-KR'),button('기록 내려받기',()=>download(`시험-${s.id}.json`,JSON.stringify(s,null,2)))))));
      root.replaceChildren(panel);
    }catch(e){if(disposed)return;root.replaceChildren(el('h1',{},'시험 준비 확인'),error,button('다시 시도',lobby));report(e);}
  }
  const onStorage=e=>{if(e.key!==SESSION_KEY||disposed)return;try{session=readSession();if(session)draw();else lobby();}catch(e){report(e);}};
  window.addEventListener('storage',onStorage);
  if(session){draw();tick();}else await lobby();
  return ()=>{disposed=true;clearInterval(timer);window.removeEventListener('storage',onStorage);};
}
