import { examBlueprint } from './blueprint.js';
import { parseSyllables } from '../pinyin.js';
const plain = s => s.normalize('NFD').replace(/[\u0300-\u0304\u030c]/g,'').normalize('NFC').toLowerCase();
const box = (...lines) => ({kind:'box',lines});
const figure = (symbol, caption='') => ({kind:'figure',symbol,caption});
const fields = (...list) => list.map(([id,label,answers,mode='exact'])=>({id,label,answers,mode,ignorePunctuation:true}));
export function buildBank(scope, {prototype=false}={}) {
  const bank=Object.fromEntries(examBlueprint.map(s=>[s.slot,[]]));
  const words=new Map(scope.vocabulary.map(w=>[w.simplified,w]));
  const word = s => { if(!words.has(s)) throw Error(`범위에 없는 단어: ${s}`); return words.get(s); };
  const refs = (...terms) => terms.map(t=> { if(words.has(t)) return {table:'vocabulary',id:word(t).id}; const row=scope.sentences.find(s=>s.chinese.includes(t)); if(!row) throw Error(`출처 없는 어휘: ${t}`); return {table:'sentences',id:row.id}; });
  const cref = (...ids)=>ids.map(id=>({table:'culture',id}));
  const gref = (...ids)=>ids.map(id=>({table:'grammar',id}));
  function add(slot,prompt,blocks,choices,answer,sourceRefs,extra={}) {
    const n=bank[slot].length;
    if(prototype && n) return;
    bank[slot].push({id:`${slot}-${String.fromCharCode(65+n)}`,slot,type:examBlueprint.find(s=>s.slot===slot).type,prompt,blocks,choices,answer,sourceRefs,origin:'reviewed',difficulty:'보통',explanation:extra.explanation||'제시된 자료와 문맥을 근거로 판단합니다.',...extra});
  }
  // Generators use audited seeds and recompute the answer from scope data.
  const mono=['你','好','他','我','去','忙','是','国','人','书','长','重','吃','分','喝','热','渴','累','难','看','高','小','姓','多'];
  const syllable = s => parseSyllables(word(s).pinyin,1)?.find(p=>p.vowelIndex>=0);
  for(const [target,initial,final] of [['书','sh','u'],['忙','m','ang'],['喝','h','e'],['国','g','uo']]) {
    const other=mono.filter(s=>plain(word(s).pinyin)!==initial+final && s!==target).slice(0,4);
    add('Q01','<보기>의 성모와 운모를 결합한 발음을 갖는 한자는? (성조는 고려하지 않는다.)',[box(`성모: ${initial}`,`운모: ${final}`)],[target,...other],target,refs(target,...other),{origin:'generator',rule:{kind:'syllable',initial,final},explanation:`${target}의 병음은 ${word(target).pinyin}입니다.`});
  }
  for(const [target,index,b,others] of [
    ['他',0,'她',['你','我','书','去']],['是',0,'事',['好','忙','多','喝']],
    ['高兴',1,'姓',['国','人','吃','渴']],['年糕',1,'高',['重','长','分','热']],
  ]) {
    const shown=[...target].map((c,i)=>i===index?`【${c}】`:c).join('');
    const options=[b,...others];
    add('Q02','보기에서 【 】로 표시한 한자와 발음이 같은 것은? (성조 포함, 사전 발음 기준)',[box(shown)],options,b,refs(target,b,...others),{origin:'generator',rule:{kind:'pronunciation',target,index},explanation:`${target}: ${word(target).pinyin}, ${b}: ${word(b).pinyin}`});
  }
  for(const [icons,templates,common,opts,terms] of [
    [['🧊🍦','🖊️'],['b__ngqílín','yuánzhūb__'],'i',['i','a','u','e','ü'],['冰淇淋','圆珠笔']],
    [['⚽','🏓'],['zúq__','pīngpāngq__'],'iu',['iu','ui','ie','uo','ao'],['足球','乒乓球']],
    [['☕','🛋️'],['k__fēi','sh__fā'],'a',['a','o','e','i','u'],['咖啡','沙发']],
    [['📺','🏫👩‍🏫'],['diànsh__','lǎosh__'],'i',['i','u','a','e','o'],['电视','老师']],
  ]) add('Q03','두 그림의 단어에서 빈칸에 공통으로 들어갈 병음 요소는? (빈칸의 성조 생략)',icons.map((s,i)=>figure(s,templates[i])),opts,common,refs(...terms),{origin:'generator',explanation:terms.map(t=>`${t}: ${word(t).pinyin}`).join(', ')});
  const meaningSets=[['昨天','明天','前天','后天'],['铅笔','橡皮','书包','词典'],['饿','渴','累','困'],['教授','大夫','服务员','经理']];
  meaningSets.forEach((set,i)=>{
    const correct=i+1;
    const pairs=set.map((s,j)=>`${s} — ${word(j<correct?s:set[(j+1)%set.length]).meaning}`);
    add('Q04','한자와 뜻이 바르게 연결된 것은 모두 몇 개인가?',[box(...pairs)],['0개','1개','2개','3개','4개'],`${correct}개`,refs(...set),{origin:'generator',rule:{kind:'count',truth:set.map((_,j)=>j<correct)},explanation:set.map(s=>`${s}: ${word(s).meaning}`).join(' / ')});
  });
  [
    [['喝茶','看电视','听音乐','吃饭','喝书'],'喝书',['喝茶','看电视','听音乐','吃饭','喝','书']],
    [['洗脸','洗头','刷牙','看电影','看饭'],'看饭',['洗脸','洗头','刷牙','看电影','听音乐']],
    [['做作业','做运动','上班','下班','吃电脑'],'吃电脑',['做作业','做运动','上班','下班','吃','电脑']],
    [['祝你好运','祝你健康','祝你平安','祝你幸福','祝你铅笔'],'祝你铅笔',['祝','你','好运','健康','平安','幸福','铅笔']],
  ].forEach(([opts,ans,terms])=>add('Q05','일반적인 표현에서 결합이 자연스럽지 않은 것은?',[],opts,ans,refs(...terms),{explanation:'동작의 대상이나 축원의 내용이 해당 표현의 의미와 맞아야 합니다.'}));
  [
    ['대문 양쪽에 붙이는 글귀를 준비했다. 새해에 악귀를 쫓고 평안을 기원한다.','春联',['红包','月饼','粽子','旗袍'],[18]],
    ['보충자료에 소개된 국기는 붉은 바탕에 다섯 별이 있고 가로와 세로의 비는 3:2이다.','五星红旗',['春联','红包','粽子','旗袍'],[24]],
    ['푸둥에 세워진 높이 468m의 방송 송수신 탑이다. 자료에서는 한 도시의 대표 상징으로 소개한다.','상하이',['베이징','하얼빈','라싸','하이난'],[29]],
    ['대도시의 전파 탑이나 궁전이 아니라, 쑹화강의 얼음으로 조각품을 만들어 전시하는 축제이다.','하얼빈',['상하이','베이징','라싸','하이난'],[27]],
  ].forEach(([text,ans,other,ids])=>add('Q06','자료가 가리키는 문화 요소 또는 지역은?',[box(text)],[ans,...other],ans,cref(...ids),{explanation:scope.culture.find(c=>c.id===ids[0]).explanation}));
  for(const target of ['你','国','书','去']) {
    const tone=syllable(target).tone;
    const same=mono.find(s=>s!==target&&syllable(s)?.tone===tone);
    const diff=mono.filter(s=>syllable(s)?.tone!==tone).slice(0,4);
    add('Q07','기준 한자와 사전 성조가 같은 것은? (변조 전 발음)',[box(target)],[same,...diff],same,refs(target,same,...diff),{origin:'generator',rule:{kind:'tone',target},explanation:`${target}와 ${same}은 ${tone}성입니다.`});
  }
  [
    [['热狗','汉堡包','比萨饼'],[8,15,24],[[0,2],[1,1]]],
    [['饺子','年糕','月饼'],[12,9,16],[[1,2],[2,1]]],
    [['咖啡','冰淇淋','热狗'],[13,7,10],[[0,1],[1,2]]],
    [['粽子','比萨饼','汉堡包'],[6,22,14],[[0,3],[2,1]]],
  ].forEach(([terms,prices,order])=>{
    const total=order.reduce((sum,[i,n])=>sum+prices[i]*n,0);
    add('Q08','주문표의 음식을 모두 주문했을 때 총 금액은? (메뉴 가격은 1개 기준)',[{kind:'menu',rows:terms.map((s,i)=>[s,`${prices[i]}위안`])},box('주문표',...order.map(([i,n])=>`${terms[i]} × ${n}`))],[total,total+prices[0],total-prices[0],total+2,total-2].map(n=>`${n}위안`),`${total}위안`,refs(...terms),{origin:'generator',rule:{kind:'menu',prices,order},explanation:order.map(([i,n])=>`${prices[i]} × ${n}`).join(' + ')+` = ${total}위안`});
  });
  [
    [['A: 我很（ ）。','B: 我也很（ ），喝茶吧。'],'渴',['饿','困','漂亮','聪明'],'목이 말라 차를 마시자고 제안합니다.'],
    [['A: 我很（ ）。','B: 我也很（ ），吃饭吧。'],'饿',['渴','高','聪明','漂亮'],'배가 고파 밥을 먹자고 제안합니다.'],
    [['A: 认识你很（ ）。','B: 见到你，我也很（ ）。'],'高兴',['重','饿','渴','难'],'만남에 대한 기쁨을 나타냅니다.'],
    [['A: 他很（ ），不去。','B: 我也很（ ）。','상황: 두 사람 모두 할 일이 많아 함께 가지 못한다.'],'忙',['难','矮','胖','瘦'],'할 일이 많다는 문맥에는 忙을 씁니다.'],
  ].forEach(([lines,ans,other,explanation])=>add('Q09','모든 빈칸에 공통으로 들어갈 말은?',[box(...lines)],[ans,...other],ans,refs(ans,...other),{explanation}));
  [
    [['A: 你有弟弟吗？','B: 没有，我有一个哥哥。'],'B에게는 형 또는 오빠가 있다.',['B에게는 남동생이 두 명 있다.','B는 외동이다.','A에게는 누나가 있다.','A와 B는 형제다.'],[11,12]],
    [['A: 你几点吃饭？','B: 我六点半吃饭。','A: 我五点回家。'],'B는 6시 반에 식사한다.',['A는 6시 반에 귀가한다.','B는 5시에 식사한다.','A와 B는 같은 집에 산다.','B는 5시에 귀가한다.'],[21]],
    [['A: 他是日本人吗？','B: 不是，他是韩国人。'],'그는 한국인이다.',['그는 일본인이다.','A는 한국인이다.','B는 중국인이다.','그는 고등학생이다.'],[6]],
    [['A: 那是你的书包吗？','B: 不是，那是她的书包。'],'가방의 주인은 그녀이다.',['가방의 주인은 A이다.','가방의 주인은 B이다.','가방 안에 책이 있다.','그녀는 B의 동생이다.'],[9]],
  ].forEach(([lines,ans,other,ids])=>add('Q10','대화에서 확실하게 알 수 있는 사실은?',[box(...lines)],[ans,...other],ans,gref(...ids),{explanation:`대화에 직접 제시된 사실: ${ans}`}));
  // Each triple is selected as one passage group in the session generator.
  const dialogues=[
    {lines:['A: 你（11）几个弟弟？','B: （12），我有一个哥哥。','A: 认识你很高兴。','B: （13）'],answers:['有','没有','认识你，我也很高兴。'],choices:[['有','是','叫','姓','看'],['没有','谢谢','再见','早上','明天'],['认识你，我也很高兴。','我六点半吃饭。','那是椅子。','他十八岁了。','四点二十分。']],g:[11,12]},
    {lines:['A: 你（11）学生吗？','B: 是，我（12）上高中。','A: 明天见！','B: （13）'],answers:['是','也','再见！'],choices:[['是','有','姓','叫','喝'],['也','吗','的','呢','个'],['再见！','我叫金大韩。','这是书。','我有小狗。','五点半。']],g:[2,7]},
    {lines:['A: 她（11）什么名字？','B: 她叫晶晶。她很（12）。','A: 对不起！','B: （13）','상황: B는 그녀가 아름답다고 소개한다.'],answers:['叫','漂亮','没关系！'],choices:[['叫','有','看','吃','去'],['漂亮','困','渴','饿','难'],['没关系！','你是哪国人？','他上高中三年级。','那是书。','六月八号。']],g:[3,5]},
    {lines:['A: 我们几点（11）饭？','B: 六点半吃饭（12）。','A: 谢谢你！','B: （13）'],answers:['吃','吧','不客气！'],choices:[['吃','喝','叫','姓','上'],['吧','吗','的','个','年'],['不客气！','你多高？','她没有手机。','今天星期三。','我是学生。']],g:[21,22]},
  ];
  dialogues.forEach((d,i)=>d.answers.forEach((ans,j)=>add(`Q${11+j}`,`공통 대화의 (${11+j})에 들어갈 가장 알맞은 ${j===0?'한자':j===1?'단어':'응답'}는?`,[box(...d.lines)],d.choices[j],ans,gref(...d.g),{group:'conversation',groupVariant:i,explanation:`문맥에 맞는 표현은 ${ans}입니다.`})));
  [
    [['你叫什么名字？','您贵姓？','认识你很高兴。'],'家',['叫','姓','你','名']],
    [['谢谢你！','不客气！','不用谢！'],'见',['谢','你','不','气']],
    [['早上好！','晚上好！','明天见！'],'姓',['早','晚','明','见']],
    [['你有几个弟弟？','我家有四口人。','她没有手机。'],'饭',['有','家','人','她']],
  ].forEach(([lines,ans,other])=>add('Q14','아래 표현들에 사용되지 않은 한자는?',[box(...lines)],[ans,...other],ans,refs(ans),{origin:'generator',rule:{kind:'absent',text:lines.join('')},explanation:`${ans}은 제시된 표현에 없습니다.`}));
  const orders=[
    {tokens:['他','也','是','中国','人'],answer:'他也是中国人',meaning:'그도 중국인이다.',g:7},
    {tokens:['那','是','她','的','书包'],answer:'那是她的书包',meaning:'저것은 그녀의 가방이다.',g:9},
    {tokens:['我','六','点','半','吃饭'],answer:'我六点半吃饭',meaning:'나는 6시 반에 밥을 먹는다.',g:21},
    {tokens:['你','有','几','个','弟弟'],answer:'你有几个弟弟',meaning:'너는 남동생이 몇 명 있니?',g:12},
  ];
  orders.forEach(o=>{
    const perm=[2,4,0,3,1], shown=perm.map(i=>o.tokens[i]);
    const right=o.tokens.map((_,i)=>perm.indexOf(i)+1).join(' → ');
    const incorrect=[[1,2,3,4,5],[5,4,3,2,1],[2,1,3,5,4],[4,3,5,1,2]].map(a=>a.join(' → '));
    add('Q15',`모든 어휘를 한 번씩 사용하여 ‘${o.meaning}’의 어순을 고르면?`,[box(...shown.map((s,i)=>`${i+1}. ${s}`))],[right,...incorrect],right,gref(o.g),{origin:'generator',rule:{kind:'order',tokens:shown,expected:o.answer},explanation:o.answer});
  });
  const cultureStatements=[
    [['중국 학교의 새 학년은 9월에 시작한다.',true,9],['중국 학교에서는 눈 체조를 한다.',true,10],['교재의 점심시간은 약 10분이다.',false,11],['중국 대학 입학시험은 高考이다.',true,12]],
    [['중국 전역의 공식 표준시는 같다.',true,14],['교재의 가오카오 실시 시기는 9월이다.',false,13],['11월 11일은 솔로 데이로 소개된다.',true,16],['5월 20일은 한자 모양 때문에 고백과 연결된다.',false,15]],
    [['중국의 일반적인 인사는 항상 깊이 허리를 굽힌다.',false,1],['교재의 남성 공수는 왼손을 오른손 위에 놓는다.',true,3],['叩指礼는 탁자를 손가락으로 가볍게 치는 감사 예법이다.',true,2],['이름 글자를 쪼개 말하는 것은 이름을 정확히 전달하기 위해서다.',true,5]],
    [['젊은 사람을 친근하게 부를 때 성 앞에 小를 붙이기도 한다.',true,7],['교재는 老를 존경을 담은 호칭으로 소개한다.',true,6],['음식점 직원은 服务员이라고 부른다.',true,8],['교재에는 점심시간의 낮잠이 소개된다.',true,11]],
  ];
  cultureStatements.forEach(set=>add('Q16','현행 자료의 설명과 일치하는 것은 모두 몇 개인가?',[box(...set.map(([s],i)=>`${'ㄱㄴㄷㄹ'[i]}. ${s}`))],['0개','1개','2개','3개','4개'],`${set.filter(x=>x[1]).length}개`,cref(...set.map(x=>x[2])),{origin:'generator',rule:{kind:'count',truth:set.map(x=>x[1])},explanation:set.map(([s,t])=>`${t?'○':'×'} ${s}`).join('\n')}));
  [['🍔','汉堡包',2],['🌭','热狗',3],['🥟','饺子',4],['🥮','月饼',2]].forEach(([symbol,w,n])=>{
    const num=['','一','两','三','四'][n];
    const ans=`${num}个${w}`;
    const opts=[ans,`${num==='两'?'三':'两'}个${w}`,`${num}口${w}`,`${num}点${w}`,`${num}年${w}`];
    add('Q17','그림의 음식 수량과 일치하며 주문 목록에 쓸 수 있는 올바른 표현은?',[figure(Array(n).fill(symbol).join(' '))],opts,ans,[...refs(w,'个','口','点','年'),...gref(13)],{origin:'generator',rule:{kind:'quantity',word:w,count:n},explanation:`${w} ${n}개: ${ans}. 수량 2는 两을 씁니다.`});
  });
  [
    ['🩺👩‍⚕️','진료실에서 환자를 진찰하는 사람','大夫'],
    ['🍽️🧑‍💼','식당에서 주문을 받고 음식을 내오는 사람','服务员'],
    ['🏫👩‍🏫','초등학교 교실에서 학생을 가르치는 사람','老师'],
    ['🎓📖🧑‍🏫','대학교에서 강의하고 연구하는 교수','教授'],
  ].forEach(([symbol,caption,ans])=>add('Q18','그림 속 역할에 가장 정확히 대응하는 직업명은?',[figure(symbol,caption)],['大夫','服务员','老师','教授','经理'],ans,refs('大夫','服务员','老师','教授','经理'),{origin:'generator',explanation:`${ans}: ${word(ans).meaning}`}));
  [
    [['您贵姓？','我姓金。','初次见面！'],'처음 만나 소개하기'],
    [['生日快乐！','祝你好运！','恭喜恭喜！'],'축하와 축원'],
    [['对不起！','很抱歉！','请原谅。'],'사과와 양해 구하기'],
    [['非常感谢！','多谢！','不用谢！'],'감사와 그에 대한 응답'],
  ].forEach(([lines,ans])=>add('Q19','표현들을 함께 묶기에 가장 적절한 상황은?',[box(...lines)],[ans,...['처음 만나 소개하기','축하와 축원','사과와 양해 구하기','감사와 그에 대한 응답','시간 묻고 답하기'].filter(x=>x!==ans)],ans,gref(23,24),{explanation:`제시된 표현은 ${ans}에 사용합니다.`}));
  [
    ['你的生日是几月几号？','二月十号。',['四点二十分。','我是学生。','我有小狗。','他是韩国人。'],17],
    ['他上几年级？','他上高中三年级。',['他十八岁了。','他是韩国人。','那是椅子。','我很忙。'],3],
    ['你多高？','1米75。',['60公斤。','六月八号。','我姓金。','我没有手机。'],10],
    ['你是哪国人？','我是中国人。',['我叫金大韩。','我十八岁了。','我五点回家。','我有一个哥哥。'],3],
  ].forEach(([q,ans,other,g])=>add('Q20','질문에 대한 가장 자연스러운 응답은?',[box(q)],[ans,...other],ans,gref(g),{explanation:`질문에서 요구하는 정보에 해당하는 응답은 ${ans}입니다.`}));
  [['📚','书',['是','事','吃','人']],['☕','咖啡',['沙发','热狗','词典','手机']],['⚽','足球',['乒乓球','电脑','电视','黑板']],['✏️','铅笔',['圆珠笔','橡皮','词典','书包']]].forEach(([symbol,ans,other])=>{
    const opts=[ans,...other].map(t=>`${t} · ${word(t).pinyin}`);
    add('Q21','그림에 해당하는 단어와 병음을 고르면?',[figure(symbol)],opts,opts[0],refs(ans,...other),{origin:'generator',explanation:`${ans}: ${word(ans).pinyin}`});
  });
  [
    ['춘절','춘절은 음력 1월 1일이다.',['춘절은 음력 5월 5일이다.','춘절에는 용선 경기만 한다.','춘절의 대표 음식은 전국에서 월병으로 같다.','춘절은 가오카오의 다른 이름이다.'],[17,18,19]],
    ['중추절','중추절에는 보름달을 감상하고 월병을 먹는다.',['중추절은 음력 1월 1일이다.','중추절은 굴원을 기리는 날이다.','중추절에는 용선 경기가 중심이다.','중추절은 11월 11일이다.'],[20,21]],
    ['단오절','단오절에는 粽子를 먹고 용선 경기를 한다.',['단오절은 음력 8월 15일이다.','단오절은 가오카오 실시일이다.','단오절에는 월병으로 달맞이를 한다.','단오절은 춘절의 다른 이름이다.'],[22,23]],
    ['춘절의 음식','교재에서는 북방은 饺子, 남방은 年糕를 먹는다고 한다.',['교재에서는 북방은 年糕, 남방은 饺子를 먹는다고 한다.','교재에서는 북방과 남방 모두 月饼만 먹는다.','교재에서는 북방과 남방 모두 咖啡를 먹는다.','교재에서는 북방은 粽子, 남방은 热狗를 먹는다고 한다.'],[19]],
  ].forEach(([topic,ans,other,ids])=>add('Q22',`${topic}에 관한 설명으로 현행 자료와 일치하는 것은?`,[],[ans,...other],ans,cref(...ids),{explanation:scope.culture.find(c=>c.id===ids[0]).explanation}));
  [
    ['여행 중 음력 8월 15일에 가족이 함께 모인 모습을 보았다. 보름달을 감상하며 나누어 먹는 대표 음식이 있었다.','月饼',['饺子','年糕','粽子','热狗'],[20,21]],
    ['시인 굴원을 기리는 명절이다. 강에서는 용선 경기가 열리고, 찹쌀밥을 대나무 잎에 싸서 찐 음식을 먹는다.','粽子',['月饼','年糕','饺子','比萨饼'],[22,23]],
    ['음력 새해 첫날이다. 여행자는 중국 북방 가정에서 명절 음식을 먹었다. 교재는 같은 날 남방에서 먹는 떡과 이 음식을 구별한다.','饺子',['年糕','月饼','粽子','汉堡包'],[17,19]],
    ['설에 해당하는 명절의 음식 문화를 비교하고 있다. 북방에서 먹는 교자와 달리, 남방에서는 대표적으로 떡을 먹는다고 자료에 소개되어 있다.','年糕',['饺子','月饼','粽子','热狗'],[17,19]],
  ].forEach(([passage,ans,other,ids])=>add('Q23','지문의 단서를 모두 만족하는 음식은?',[box(passage)],[ans,...other],ans,cref(...ids),{explanation:scope.culture.find(c=>c.id===ids.at(-1)).explanation}));
  const sequences=[
    ['A: 你叫什么名字？','B: 我叫金大韩，你呢？','A: 我叫晶晶。','B: 认识你很高兴。'],
    ['A: 你有弟弟吗？','B: 有。','A: 你有几个弟弟？','B: 两个弟弟。'],
    ['A: 你是学生吗？','B: 是。','A: 你上几年级？','B: 我上高中三年级。'],
    ['A: 你几点吃饭？','B: 我六点半吃饭。','A: 六点半？','B: 是。'],
  ];
  sequences.forEach((lines,i)=>{
    const permutation=[2,0,3,1], answer=[1,2,3,4].map((_,j)=>permutation.indexOf(j)+1).join('');
    add('SA01','A가 질문을 시작한다. 말풍선을 자연스러운 대화 순서로 배열하여 번호 네 개를 입력하세요.',[{kind:'bubbles',lines:permutation.map((j,n)=>`${n+1}. ${lines[j]}`)}],null,null,gref([3,12,2,21][i]),{fields:fields(['order','대화 순서 (예: 1234)',[answer],'sequence']),explanation:lines.join('\n')});
  });
  [
    [['我（ ）中国人。','他（ ）学生。','那（ ）书。'],'是',['（ ）谢你！','不用（ ）！','多（ ）！'],'谢'],
    [['我（ ）一个哥哥。','你（ ）几个弟弟？','她没（ ）手机。'],'有',['早上（ ）！','晚上（ ）！','（ ）久不见！'],'好'],
    [['我（ ）忙。','她（ ）漂亮。','认识你（ ）高兴。'],'很',['明天（ ）！','再（ ）！','好久不（ ）！'],'见'],
    [['那是我（ ）书。','这是她（ ）书包。','你（ ）生日是几月几号？'],'的',['（ ）你好运！','（ ）你平安！','（ ）你幸福！'],'祝'],
  ].forEach(([a,aa,b,bb])=>add('SA02','각 묶음의 빈칸에 공통으로 들어갈 간체자 한 글자를 쓰세요.',[box('가',...a),box('나',...b)],null,null,refs(aa,bb),{fields:fields(['a','가: 공통 한자',[aa]],['b','나: 공통 한자',[bb]]),explanation:`가: ${aa} / 나: ${bb}`}));
  [
    [['是','有','叫','姓','去'],['我（ ）金。','她（ ）晶晶。','他（ ）中国人。'],['姓','叫','是'],[6,23]],
    [['的','呢','吧','个','吗'],['你是学生（ ）？','六点半吃饭（ ）。','那是她（ ）书包。'],['吗','吧','的'],[2,9,22]],
    [['几','多','什么','谁','哪'],['你叫（ ）名字？','你有（ ）个弟弟？','长城（ ）长？'],['什么','几','多'],[3,10,12]],
    [['不','没有','也','很','是'],['我有手机，她（ ）有手机。','我（ ）去。（가지 않는다）','她（ ）漂亮。'],['也','不','很'],[1,5,7]],
  ].forEach(([options,lines,answers,ids])=>add('SA03','보기에서 골라 각 빈칸에 들어갈 단어를 간체자로 쓰세요. 같은 단어는 한 번만 사용할 수 있습니다.',[box('보기',options.join(' / ')),box(...lines.map((s,i)=>`${i+1}. ${s}`))],null,null,gref(...ids),{wordBank:options,allowReuse:false,fields:fields(...answers.map((a,i)=>[`blank${i+1}`,`${i+1}번 빈칸`,[a]])),explanation:answers.join(' / ')}));
  [
    ['A: 她有手机吗？','B: 她不有手机。','她没有手机。','有의 부정은 没有를 사용한다.',['有','부정','没有'],'她很漂亮。',['그녀','예쁘'],11],
    ['A: 他是学生吗？','B: 他是也学生。','他也是学生。','也는 是 앞에 놓는다.',['也','是','앞'],'他上高中三年级。',['고등학교','3학년'],7],
    ['A: 她很漂亮吗？','B: 她漂亮很。','她很漂亮。','정도부사 很은 형용사 앞에 놓는다.',['很','형용사','앞'],'那是她的书包。',['그녀','가방'],5],
    ['A: 你几点回家？','B: 我回家五点。',['我五点回家。','五点我回家。'],'시간 표현은 동작을 나타내는 말 앞에 놓는다.',['시간','동작','앞'],'我六点半吃饭。',['6시','반','밥'],21],
  ].forEach(([a,b,correction,reason,keywords,translate,terms,g])=>{
    const corrections=[].concat(correction);
    add('WR01','B의 문장을 고쳐 쓰고 수정 이유를 한국어로 설명하세요. 별도 문장은 한국어로 번역하세요.',[box(a,b),box('번역할 문장',translate)],null,null,gref(g),{fields:fields(['correction','B의 문장 전체를 바르게 쓰기',corrections],['reason','수정 이유 (한국어)',[reason],'manual'],['translation','별도 문장 번역 (한국어)',[],'manual']),expectedCorrection:corrections[0],acceptedReasons:[reason],reasonKeyTerms:keywords,translationKeyTerms:terms,explanation:`${corrections.join(' / ')}\n${reason}\n번역 핵심: ${terms.join(', ')}`});
  });
  [
    {tokens:['这','是','我','的','中国','朋友'],answers:['这是我的中国朋友。'],g:9,meaning:'이 사람은 나의 중국 친구이다.'},
    {tokens:['他','不','是','日本','人'],answers:['他不是日本人。'],g:6,meaning:'그는 일본인이 아니다.'},
    {tokens:['我','今天','五点','回家'],answers:['我今天五点回家。','今天我五点回家。'],g:21,meaning:'나는 오늘 5시에 귀가한다.'},
    {tokens:['祝','你','生日','快乐'],answers:['祝你生日快乐！'],g:24,meaning:'너의 생일을 축하한다.'},
  ].forEach(o=>add('WR02',`제시어를 각각 정확히 한 번씩 사용하여 ‘${o.meaning}’에 맞는 문장을 쓰세요.`,[box([...o.tokens].reverse().join(' // '))],null,null,gref(o.g),{tokens:o.tokens,fields:fields(['sentence','완성한 문장',o.answers]),explanation:o.answers.join(' / ')}));
  // Only one defensible map variant exists in this scope: do not invent regional cuisine.
  add('WR03','지도에서 A와 B는 각각 중국의 북방과 남방을 개략적으로 나타냅니다. 각 지역명, 교재에 나온 춘절 대표 음식, 두 지역이 이 음식을 먹는 명절의 특징을 쓰세요. (지역명·특징은 한국어, 음식은 간체자)',[{kind:'map',marks:[{label:'A',x:64,y:32},{label:'B',x:62,y:68}]}],null,null,cref(17,19),{fields:fields(['a-region','A 지역명',['북방','중국 북방']],['a-food','A 대표 음식',['饺子']],['a-feature','A 명절의 특징',['음력 1월 1일인 춘절에 먹는다.'],'manual'],['b-region','B 지역명',['남방','중국 남방']],['b-food','B 대표 음식',['年糕']],['b-feature','B 명절의 특징',['중국의 설인 춘절에 먹는다.'],'manual']),explanation:'A: 북방 / 饺子, B: 남방 / 年糕. 두 지역 모두 음력 1월 1일 춘절의 음식입니다.',limitation:'현재 범위에는 도시별 대표 요리가 없어 북방·남방 춘절 음식만 출제합니다.'});
  return bank;
}
