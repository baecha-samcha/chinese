// The position and assessment objective are independent of bank contents.
const types = [
  ['pinyin_combination','성모·운모 결합'], ['pronunciation_match','표시한 한자의 발음'],
  ['picture_pinyin','그림과 공통 병음'], ['meaning_count','한자·뜻 연결'],
  ['collocation','어휘 결합'], ['culture_symbol','문화 상징'],
  ['tone_match','성조 비교'], ['menu_total','메뉴 읽기'],
  ['dialogue_common','대화 공통 빈칸'], ['dialogue_inference','대화 내용 이해'],
  ['dialogue_character','대화: 한자'], ['dialogue_word','대화: 단어'],
  ['dialogue_response','대화: 응답'], ['expression_analysis','표현 구성 분석'],
  ['word_order','문장 어순'], ['culture_count','생활문화 판단'],
  ['picture_quantity','그림과 수량 표현'], ['picture_job','그림과 직업'],
  ['situation','회화 상황'], ['response','질문과 응답'],
  ['picture_sound','그림과 발음'], ['culture_judgment','전통문화 판단'],
  ['culture_reading','문화 지문 독해'],
];
export const examBlueprint = [
  ...types.map(([type,label],i)=>({slot:`Q${String(i+1).padStart(2,'0')}`,type,label,section:'객관식',points:3})),
  ...[['dialogue_order','그림 대화 순서'],['common_character','공통 한자'],['word_bank','보기 단어 쓰기']].map(([type,label],i)=>({slot:`SA0${i+1}`,type,label,section:'서답형',points:4})),
  ...[['error_correction','오류 수정·이유·번역',7],['sentence_order','제시어 문장 배열',6],['culture_map','문화 지도',6]].map(([type,label,points],i)=>({slot:`WR0${i+1}`,type,label,section:'서술형',points})),
];
export const EXAM_VERSION = 1;
export const DEFAULT_DURATION = 50 * 60 * 1000;
