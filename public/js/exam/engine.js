import { examBlueprint, EXAM_VERSION, DEFAULT_DURATION } from './blueprint.js';
import { buildBank } from './bank.js';
import { validateBank, incompatible, normalize } from './validation.js';
import { shuffle } from '../utils.js';
import { gradeQuizAnswer } from '../quiz.js';
export const SESSION_KEY='ch.exam.v1';
export const HISTORY_KEY='ch.exam.history.v1';
export function generateExam(scope,{rng=Math.random,now=Date.now(),duration=DEFAULT_DURATION,prototype=false}={}) {
  const bank=buildBank(scope,{prototype});
  const report=validateBank(bank,scope,{prototype});
  if(report.errors.length) throw Error(report.errors.join('\n'));
  // Randomized backtracking: each slot tries its variants in random order and
  // backs up when no variant fits the questions already chosen, so conflicts
  // between distant slots never dead-end generation.
  const questions=[];
  const pick=i=>{
    if(i===examBlueprint.length) return true;
    const slot=examBlueprint[i];
    let candidates=bank[slot.slot];
    // Q11-Q13 share one conversation passage chosen at Q11.
    if(['Q12','Q13'].includes(slot.slot)) candidates=candidates.filter(q=>q.groupVariant===questions.at(-1).groupVariant);
    const fits=q=>!questions.some(p=>incompatible(p,q));
    candidates=candidates.filter(fits);
    // A single prototype may have overlapping culture topics; use full bank for
    // the compatible Q23 prototype, never silently remove the constraint.
    if(!candidates.length&&prototype) candidates=buildBank(scope)[slot.slot].filter(fits);
    for(const variant of shuffle(candidates,rng)) {
      questions.push({...structuredClone(variant),...slot,choices:variant.choices?shuffle(variant.choices,rng):null});
      if(pick(i+1)) return true;
      questions.pop();
    }
    return false;
  };
  if(!pick(0)) throw Error('정답 노출 없이 출제할 수 있는 문항 조합이 없습니다.');
  return {schemaVersion:EXAM_VERSION,id:globalThis.crypto.randomUUID(),scopeVersion:scope.version,scopeProvenance:scope.provenance,createdAt:now,deadline:now+duration,status:'active',questions,responses:{},manualScores:{},validation:report};
}
export function normalizeField(field,value) {
  if(field.mode==='sequence') return String(value??'').replace(/[\s,→\->]/g,'');
  return normalize(value,field.ignorePunctuation!==false);
}
export function gradeQuestion(q,response) {
  if(q.choices) {
    const correct=q.choices.includes(response)&&gradeQuizAnswer({grader:'meaning',answer:q.answer},response);
    return {score:correct?q.points:0,max:q.points,pending:0,parts:[{id:'choice',correct,score:correct?q.points:0,max:q.points,mode:'exact'}]};
  }
  const weights=q.type==='error_correction'?[3,2,2]:q.type==='word_bank'?[2,1,1]:q.fields.map(()=>q.points/q.fields.length);
  const values=response&&typeof response==='object'?response:{};
  const duplicates=q.allowReuse===false?Object.values(values).map(v=>normalize(v)):[];
  const parts=q.fields.map((f,i)=>{
    const value=values[f.id]??'',max=weights[i];
    if(f.mode==='manual') return {id:f.id,score:0,max,mode:'manual',pending:true,blank:!String(value).trim()};
    const reused=duplicates.filter(v=>v&&v===normalize(value)).length>1;
    const correct=!reused&&f.answers.some(a=>normalizeField(f,a)===normalizeField(f,value));
    return {id:f.id,correct,score:correct?max:0,max,mode:f.mode};
  });
  return {score:parts.reduce((s,p)=>s+p.score,0),max:q.points,pending:parts.filter(p=>p.pending).reduce((s,p)=>s+p.max,0),parts};
}
export function gradeExam(session) {
  const questions=session.questions.map(q=>{
    const g=gradeQuestion(q,session.responses[q.slot]);
    for(const p of g.parts) if(p.pending) {
      const manual=session.manualScores?.[`${q.slot}.${p.id}`];
      if(Number.isFinite(manual)&&manual>=0&&manual<=p.max) {p.score=manual;p.pending=false;p.reviewed=true;}
    }
    g.score=g.parts.reduce((s,p)=>s+p.score,0);g.pending=g.parts.filter(p=>p.pending).reduce((s,p)=>s+p.max,0);
    return {slot:q.slot,...g};
  });
  return {score:questions.reduce((s,q)=>s+q.score,0),max:questions.reduce((s,q)=>s+q.max,0),pending:questions.reduce((s,q)=>s+q.pending,0),questions};
}
export function answered(q,response) {
  return q.choices?q.choices.includes(response):q.fields.every(f=>String(response?.[f.id]??'').trim());
}
export function remaining(session,now=Date.now()) {return Math.max(0,session.deadline-now);}
export function readSession(storage=globalThis.localStorage) {
  const raw=storage.getItem(SESSION_KEY);if(!raw)return null;
  let s;try{s=JSON.parse(raw);}catch {throw Error('저장된 시험을 읽을 수 없습니다. 원본을 백업한 뒤 초기화해 주세요.');}
  if(s.schemaVersion!==EXAM_VERSION||!s.id||!Array.isArray(s.questions)||s.questions.length!==examBlueprint.length||!['active','submitted'].includes(s.status)||!Number.isFinite(s.deadline)||!s.responses||typeof s.responses!=='object') throw Error('저장된 시험 형식이 올바르지 않습니다. 자동으로 새 시험을 만들지 않았습니다.');
  for(let i=0;i<s.questions.length;i++) if(s.questions[i].slot!==examBlueprint[i].slot||(!s.questions[i].choices&&!s.questions[i].fields)) throw Error('저장된 시험 문항이 손상되었습니다.');
  return s;
}
export function persistSession(s,storage=globalThis.localStorage) {
  try {storage.setItem(SESSION_KEY,JSON.stringify(s));}catch{throw Error('시험을 저장하지 못했습니다. 저장 공간을 확보해 주세요. 현재 답안을 JSON으로 내려받을 수 있습니다.');}
  return s;
}
export function startExam(scope,options={},storage=globalThis.localStorage) {
  const old=readSession(storage);
  if(old?.status==='active') return old;
  const next=generateExam(scope,options);
  if(old) {
    let history;try{history=JSON.parse(storage.getItem(HISTORY_KEY)||'[]');}catch{throw Error('시험 기록을 읽지 못해 새 시험을 시작하지 않았습니다.');}
    if(!history.some(s=>s.id===old.id))history.push(old);
    storage.setItem(HISTORY_KEY,JSON.stringify(history));
  }
  return persistSession(next,storage);
}
export function submitExam(session,storage=globalThis.localStorage,now=Date.now()) {
  const current=readSession(storage);
  if(current?.id!==session.id) throw Error('다른 시험이 열렸습니다. 화면을 다시 열어 주세요.');
  if(current.status==='submitted')return current;
  return persistSession({...current,status:'submitted',submittedAt:now},storage);
}
export function saveAnswer(session,slot,value,{field,now=Date.now(),storage=globalThis.localStorage}={}) {
  const current=readSession(storage);
  if(current?.id!==session.id) throw Error('다른 탭에서 새 시험이 시작되었습니다. 화면을 다시 열어 주세요.');
  if(current.status!=='active')return current;
  if(!remaining(current,now))return submitExam(current,storage,now);
  const q=current.questions.find(q=>q.slot===slot);
  if(!q|| (field&&!q.fields?.some(f=>f.id===field)) || (!field&&!q.choices?.includes(value))) throw Error('잘못된 답안입니다.');
  current.responses[slot]=field?{...current.responses[slot],[field]:String(value)}:value;
  return persistSession(current,storage);
}
export function saveManualScore(session,slot,field,score,storage=globalThis.localStorage) {
  const current=readSession(storage);
  if(current?.id!==session.id||current.status!=='submitted')throw Error('제출한 시험에서만 채점할 수 있습니다.');
  const q=current.questions.find(q=>q.slot===slot),part=q&&gradeQuestion(q,current.responses[slot]).parts.find(p=>p.id===field);
  if(!part||part.mode!=='manual'||!Number.isFinite(score)||score<0||score>part.max)throw Error('허용되지 않는 점수입니다.');
  current.manualScores={...current.manualScores,[`${slot}.${field}`]:score};
  return persistSession(current,storage);
}
