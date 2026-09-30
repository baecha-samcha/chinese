import { examBlueprint } from './blueprint.js';
import { parseSyllables } from '../pinyin.js';
import { answerKey } from '../quiz.js';
export const normalize = (value, ignorePunctuation=true) => {
  const text=String(value??'').normalize('NFC').replace(/\s/g,'');
  return ignorePunctuation ? text.replace(/[，。！？、；：,.!?;:]/g,'') : text;
};
const chineseRuns = value => String(value).match(/[\p{Script=Han}]+/gu)||[];
// Word-level segmentation, not merely an allowlist of individual Hanzi.
// Numbers and independently evidenced single-character words are valid tokens.
export function createScopeValidator(scope) {
  const tokens = new Set(scope.vocabulary.map(w=>w.simplified));
  for(const s of scope.sentences) {
    chineseRuns(s.chinese).forEach(t=>tokens.add(t));
    s.tokens.forEach(t=>chineseRuns(t).forEach(x=>tokens.add(x)));
  }
  for(const g of scope.grammar) for(const ex of g.correct_examples) chineseRuns(ex).forEach(t=>tokens.add(t));
  for(const c of scope.culture) for(const value of [c.question,c.answer,c.explanation]) chineseRuns(value).forEach(t=>tokens.add(t));
  // Digits occur in dates, ages and times in the scoped examples.
  const corpus=scope.sentences.map(s=>s.chinese).join('');
  for(const n of '一二三四五六七八九十零两') if(corpus.includes(n)) tokens.add(n);
  const byFirst = new Map();
  for(const t of tokens) { const list=byFirst.get(t[0])||[]; list.push(t);byFirst.set(t[0],list); }
  function covered(run) {
    const ok=new Set([0]);
    for(let i=0;i<run.length;i++) if(ok.has(i)) for(const t of byFirst.get(run[i])||[]) if(run.startsWith(t,i)) ok.add(i+t.length);
    return ok.has(run.length);
  }
  return text => chineseRuns(text).filter(t=>!covered(t));
}
const visibleStrings = q => [q.prompt,...(q.choices||[]),...(q.blocks||[]).flatMap(b=>[...(b.lines||[]),b.caption||'',...(b.rows||[]).flat()]),...(q.wordBank||[]),...(q.tokens||[])];
export function validateQuestion(q,scope,checkScope=createScopeValidator(scope)) {
  const errors=[];
  if(!q.id||!q.prompt||!q.sourceRefs?.length) errors.push('식별자·발문·출처 누락');
  for(const ref of q.sourceRefs||[]) if(!scope[ref.table]?.some(r=>r.id===ref.id)) errors.push(`출처 없음: ${ref.table}/${ref.id}`);
  let all=[...visibleStrings(q),q.answer||'',...(q.fields||[]).flatMap(f=>f.answers||[])];
  if(q.type==='expression_analysis') { const expressionText=q.blocks.flatMap(b=>b.lines||[]).join(''); all=all.filter(t=>!(t.length===1&&expressionText.includes(t))); }
  if(q.type==='common_character') all=[q.prompt,...q.blocks.flatMap((b,i)=>b.lines.map(line=>line.replaceAll('（ ）',q.fields[i].answers[0])))];
  if(q.type==='pronunciation_match') all=all.map(t=>t.replace(/[【】]/g,''));
  const outside=[...new Set(all.flatMap(checkScope))];
  if(outside.length) errors.push(`범위 미확인: ${outside.join(', ')}`);
  if(q.choices) {
    if(q.choices.length<2||q.choices.length>6) errors.push('보기 수 2~6 초과');
    const keys=q.choices.map(x=>normalize(x));
    if(new Set(keys).size!==keys.length) errors.push('중복 보기');
    if(keys.filter(x=>x===normalize(q.answer)).length!==1) errors.push('정답이 유일하지 않음');
  } else if(!q.fields?.length) errors.push('입력 필드 없음');
  const word=t=>scope.vocabulary.find(w=>w.simplified===t);
  const rule=q.rule;
  if(rule&&q.choices) {
    let valid;
    if(rule.kind==='tone') {
      const tone=t=>parseSyllables(word(t)?.pinyin||'',1)?.find(p=>p.vowelIndex>=0)?.tone;
      valid=q.choices.filter(c=>tone(c)===tone(rule.target));
    } else if(rule.kind==='pronunciation') valid=q.choices.filter(c=>answerKey('pinyin',word(c)?.pinyin||'')===answerKey('pinyin',parseSyllables(word(rule.target)?.pinyin||'',[...rule.target].length)?.filter(p=>p.vowelIndex>=0)[rule.index||0]?.text||''));
    else if(rule.kind==='syllable') {
      const bare=t=>(word(t)?.pinyin||'').normalize('NFD').replace(/[\u0300-\u0304\u030c]/g,'').toLowerCase();
      valid=q.choices.filter(c=>bare(c)===rule.initial+rule.final);
    } else if(rule.kind==='absent') valid=q.choices.filter(c=>!rule.text.includes(c));
    else if(rule.kind==='count') valid=[`${rule.truth.filter(Boolean).length}개`];
    else if(rule.kind==='menu') valid=[`${rule.order.reduce((s,[i,n])=>s+rule.prices[i]*n,0)}위안`];
    else if(rule.kind==='order') valid=q.choices.filter(c=>normalize(c.split(' → ').map(n=>rule.tokens[Number(n)-1]).join(''))===normalize(rule.expected));
    else if(rule.kind==='quantity') valid=[`${['','一','两','三','四'][rule.count]}个${rule.word}`];
    if(valid&&(valid.length!==1||valid[0]!==q.answer)) errors.push('정답·오답 규칙 검증 실패');
  }
  if(q.type==='sentence_order') for(const expected of q.fields[0].answers) {
    const possible=(rest,remaining)=>remaining.length===0?rest==='':remaining.some((token,i)=>rest.startsWith(token)&&possible(rest.slice(token.length),remaining.filter((_,j)=>i!==j)));
    if(!possible(normalize(expected),q.tokens.map(t=>normalize(t)))) errors.push('제시어 사용 횟수 불일치');
  }
  if(q.type==='word_bank'&&!q.allowReuse) {
    const expected=q.fields.map(f=>f.answers[0]);
    if(new Set(expected).size!==expected.length||expected.some(t=>!q.wordBank.includes(t))) errors.push('단어 보기·중복 사용 규칙 위반');
    // Listing the answers in blank order would let the bank give them away.
    const order=expected.map(t=>q.wordBank.indexOf(t));
    if(order.every((n,i)=>!i||order[i-1]<n)) errors.push('단어 보기에 정답이 빈칸 순서대로 나열됨');
  }
  return errors;
}
export function validateBank(bank,scope,{prototype=false}={}) {
  const errors=[],warnings=[],check=createScopeValidator(scope),seen=new Set();
  for(const slot of examBlueprint) {
    const rows=bank[slot.slot]||[];
    if(!rows.length) errors.push(`${slot.slot}: 문항 없음`);
    if(!prototype&&rows.length<4) warnings.push(`${slot.slot}: ${rows.length}개 (목표 4개)`);
    const signatures=new Set();
    for(const q of rows) {
      if(seen.has(q.id)) errors.push(`중복 ID ${q.id}`); seen.add(q.id);
      if(q.slot!==slot.slot||q.type!==slot.type) errors.push(`${q.id}: blueprint 불일치`);
      const signature=JSON.stringify([q.prompt,q.blocks,q.choices,q.fields]);
      if(signatures.has(signature)) errors.push(`${q.id}: 동일 문항 중복`);signatures.add(signature);
      for(const error of validateQuestion(q,scope,check)) errors.push(`${q.id}: ${error}`);
    }
  }
  return {errors,warnings,total:Object.values(bank).flat().length};
}
// Sentence-length answers (4+ Hanzi) that another question could reveal by
// printing them; single characters and short words recur legitimately.
const hanOnly = t => chineseRuns(t).join('');
const revealable = q => [q.answer,q.rule?.expected,...(q.fields||[]).filter(f=>f.mode!=='manual').flatMap(f=>f.answers||[])].map(t=>hanOnly(t||'')).filter(t=>t.length>=4);
const reveals = (shown,hidden) => { const answers=revealable(hidden); return answers.length>0&&visibleStrings(shown).some(t=>{const h=hanOnly(t);return answers.some(a=>h.includes(a));}); };
export function incompatible(a,b) {
  // A tradition explanation in Q22 must not disclose the adjacent Q23 answer.
  if(a.slot==='Q22'&&b.slot==='Q23'&&a.sourceRefs.some(x=>x.table==='culture'&&b.sourceRefs.some(y=>y.table===x.table&&y.id===x.id))) return true;
  // No question on the paper may display another question's answer sentence.
  return reveals(a,b)||reveals(b,a);
}
