import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildBank} from '../public/js/exam/bank.js';
import {examBlueprint} from '../public/js/exam/blueprint.js';
import {validateBank,validateQuestion,incompatible} from '../public/js/exam/validation.js';
import {generateExam,gradeQuestion,gradeExam,readSession,persistSession,startExam,saveAnswer,submitExam,saveManualScore,SESSION_KEY,HISTORY_KEY} from '../public/js/exam/engine.js';
const scope=JSON.parse(fs.readFileSync('public/data/exam-scope.json'));
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
// mulberry32: consecutive small seeds must not give correlated first draws.
function rng(seed){return ()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/2**32;};}
const bank=buildBank(scope);
test('prototype: every slot validates, grades its expected answer, and has matching type',()=>{
 const bank=buildBank(scope,{prototype:true});assert.deepEqual(validateBank(bank,scope,{prototype:true}).errors,[]);
 for(const slot of examBlueprint){assert.equal(bank[slot.slot].length,1);const q={...bank[slot.slot][0],...slot};const response=q.choices?q.answer:Object.fromEntries(q.fields.map(f=>[f.id,f.answers[0]||'번역']));const g=gradeQuestion(q,response);assert.equal(g.score+g.pending,q.points,q.id);}
});
test('expanded bank: 113 variants, exactly five options, source validation and unique answers',()=>{
 const r=validateBank(bank,scope);assert.deepEqual(r.errors,[]);assert.equal(r.total,113);assert.deepEqual(r.warnings,['WR03: 1개 (목표 4개)']);
 for(const slot of examBlueprint){assert.equal(bank[slot.slot].length,slot.slot==='WR03'?1:4);for(const q of bank[slot.slot])if(q.choices)assert.equal(q.choices.length,5);}
});
test('hundreds of exams preserve 29 fixed slots, shared passages and culture exclusion',()=>{
 const seen=new Map();const positions=new Set();
 for(let seed=1;seed<=160;seed++){
 const e=generateExam(scope,{rng:rng(seed)});assert.deepEqual(e.questions.map(q=>q.slot),examBlueprint.map(q=>q.slot));
 assert.equal(e.questions[10].groupVariant,e.questions[11].groupVariant);assert.equal(e.questions[11].groupVariant,e.questions[12].groupVariant);
 assert.equal(incompatible(e.questions[21],e.questions[22]),false);
 e.questions.forEach((a,i)=>e.questions.slice(i+1).forEach(b=>assert.equal(incompatible(a,b),false,`${a.id} ↔ ${b.id}`)));assert.equal(e.questions.reduce((s,q)=>s+q.points,0),100);
 for(const q of e.questions){if(!seen.has(q.slot))seen.set(q.slot,new Set());seen.get(q.slot).add(q.id);if(q.choices)positions.add(q.choices.indexOf(q.answer));}
 }
 assert.equal(positions.size,5);for(const [slot,ids]of seen)assert.equal(ids.size,slot==='WR03'?1:4,slot);
});
test('a question that prints another question\'s answer sentence is incompatible with it',()=>{
 const q15=bank.Q15.find(q=>q.rule.expected==='你有几个弟弟'),q14=bank.Q14.find(q=>q.blocks[0].lines.includes('你有几个弟弟？'));
 assert.ok(incompatible(q14,q15));assert.ok(incompatible(q15,q14));
 assert.ok(bank.SA01.some(q=>incompatible(q,q15)));
 assert.equal(incompatible(bank.Q01[0],q15),false);
});
test('Q02 reads 糕 in 年糕 as gāo (nián+gāo, not niáng+āo) and rejects a wrong key',()=>{
 const q=bank.Q02.find(q=>q.rule.target==='年糕');assert.equal(q.answer,'高');assert.deepEqual(validateQuestion(q,scope),[]);
 const wrong=structuredClone(q);wrong.answer='长';assert.ok(validateQuestion(wrong,scope).some(e=>e.includes('정답·오답')));
});
test('Q03 blanks and Q04 pairs are recomputed from scope pinyin and meanings',()=>{
 const word=t=>scope.vocabulary.find(w=>w.simplified===t),bare=s=>s.normalize('NFD').replace(/[\u0300-\u0304\u030c]/g,'').normalize('NFC');
 for(const q of bank.Q03){const terms=q.sourceRefs.map(r=>scope.vocabulary.find(w=>w.id===r.id).pinyin);
  const fits=c=>q.blocks.every((b,i)=>bare(b.caption.replace('__',c))===bare(terms[i]));
  assert.deepEqual(q.choices.filter(fits),[q.answer],q.id);}
 for(const q of bank.Q04){const matches=q.blocks[0].lines.filter(l=>{const [h,m]=l.split(' — ');return word(h).meaning===m;}).length;assert.equal(`${matches}개`,q.answer,q.id);}
});
test('WR01 accepts every listed word order for the correction',()=>{
 const q={...bank.WR01.find(q=>q.expectedCorrection==='我五点回家。'),points:7};
 for(const s of ['我五点回家。','五点我回家','我 五点 回家！'])assert.equal(gradeQuestion(q,{correction:s}).parts[0].correct,true,s);
 assert.equal(gradeQuestion(q,{correction:'我回家五点。'}).parts[0].correct,false);
 assert.ok(bank.WR01.every(q=>!q.blocks[0].lines.join('').includes('怎么样')));
});
test('negative validation rejects out of scope, duplicate and alternative correct distractor',()=>{
 let q=structuredClone(bank.Q01[0]);q.choices[1]='火车';assert.ok(validateQuestion(q,scope).some(e=>e.includes('범위')));
 q=structuredClone(bank.Q01[0]);q.choices[1]=q.answer;assert.ok(validateQuestion(q,scope).some(e=>e.includes('중복')));
 q=structuredClone(bank.Q07[0]);q.choices[1]='好';assert.ok(validateQuestion(q,scope).some(e=>e.includes('정답·오답')));
});
test('snapshot survives reload, independent new RNG and scope changes; answers and deadline persist',()=>{
 const store=memory(),now=1000;let e=startExam(scope,{now,rng:rng(3)},store);const original=JSON.stringify(e.questions);
 e=saveAnswer(e,'Q01',e.questions[0].choices[2],{storage:store,now:1200});const reloaded=readSession(store);
 assert.equal(JSON.stringify(reloaded.questions),original);assert.equal(reloaded.deadline,e.deadline);assert.equal(reloaded.responses.Q01,e.questions[0].choices[2]);
 assert.equal(startExam({},{now:5000},store).id,e.id);
 const submitted=submitExam(e,store,1500);assert.equal(saveAnswer(submitted,'Q01',e.questions[0].answer,{storage:store,now:1600}).responses.Q01,reloaded.responses.Q01);
 const next=startExam(scope,{now:2000},store);assert.notEqual(next.id,e.id);assert.equal(JSON.parse(store.getItem(HISTORY_KEY))[0].id,e.id);
});
test('deadline auto submission and stale tabs never overwrite another exam',()=>{
 const store=memory();let e=startExam(scope,{now:0,duration:1000},store);
 const expired=saveAnswer(e,'Q01',e.questions[0].answer,{storage:store,now:1001});assert.equal(expired.status,'submitted');assert.equal(expired.responses.Q01,undefined);
 startExam(scope,{now:2000},store);assert.throws(()=>saveAnswer(e,'Q01',e.questions[0].answer,{storage:store,now:2001}));
});
test('traditional Chinese fails, whitespace and configured punctuation pass, manual answers stay pending',()=>{
 const q={...bank.SA02[0],points:4};assert.equal(gradeQuestion(q,{a:' 是 ',b:'謝'}).score,2);assert.equal(gradeQuestion(q,{a:'是',b:'谢'}).score,4);
 const wr={...bank.WR02[0],points:6};assert.equal(gradeQuestion(wr,{sentence:' 这 是 我 的 中国 朋友！'}).score,6);assert.equal(gradeQuestion(wr,{sentence:'这是我的中国中国朋友。'}).score,0);
 const written={...bank.WR01[0],points:7};const result=gradeQuestion(written,{correction:written.expectedCorrection,reason:'关键词',translation:'关键词'});assert.equal(result.score,3);assert.equal(result.pending,4);
});
test('manual scores are bounded, persist, and yield total 100 with correct responses',()=>{
 const store=memory();let e=startExam(scope,{now:0},store);
 for(const q of e.questions)e.responses[q.slot]=q.choices?q.answer:Object.fromEntries(q.fields.map(f=>[f.id,f.answers[0]||'번역']));persistSession(e,store);e=submitExam(e,store,100);
 assert.equal(gradeExam(e).score,94);assert.equal(gradeExam(e).pending,6);
 assert.throws(()=>saveManualScore(e,'WR01','reason',999,store));
 for(const q of e.questions)for(const p of gradeQuestion(q,e.responses[q.slot]).parts)if(p.mode==='manual')e=saveManualScore(e,q.slot,p.id,p.max,store);
 assert.equal(gradeExam(e).score,100);assert.equal(gradeExam(readSession(store)).pending,0);
});
test('storage failures and corrupt snapshots are surfaced without rerandomizing',()=>{
 const store=memory();store.setItem(SESSION_KEY,'{');assert.throws(()=>readSession(store));
 assert.throws(()=>persistSession(generateExam(scope),{setItem(){throw Error('quota')}}),/저장/);
});
