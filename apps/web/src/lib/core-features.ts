// Review labels are suggestions. Original candidates remain available as details;
// changing their values requires explicit EDIT confirmation before saving.
const presentation = /(?:밝은|어두운|흰색|검은색|배경색|라이트|다크)\s*(?:배경|테마)|(?:PC|모바일|데스크톱|왼쪽|오른쪽|상단|하단|좌측|우측).*(?:메뉴|사이드바|레이아웃)|넓은\s*본문|상태\s*배지|여백|폰트\s*(?:크기|색상)|반응형\s*(?:배치|레이아웃)|(?:light|dark)\s+(?:background|theme)|(?:left|right|mobile|desktop)\s+(?:menu|sidebar|layout)/i;
const stateOrFragment = /^(?:승인|검토|처리|응답|결제)\s*대기$|^(?:내용\s*)?확인\s*완료$|^새\s*버전$|^버전별\s*응답$|^받은[·ㆍ/]보낸\s*요청$|^(?:동일\s*버전\s*)?전원\s*동의$|(?:본문|제목)$|(?:검토|수정)\s*내역$|개인\s*응답[·ㆍ/].*검토\s*내용$/;
const policyOrSentence = /하지\s*않|덮어쓰지|막고|불변|하도록|하면|한\s*뒤|하는\s*것$|진행\s*중인|검토\s*중|게시\s*직전|(?:은|는)\s*(?:팀|프로젝트\s*팀|송신자|수신자|참여자|참여|불변)|에게(?:만)?\s*공개|만\s*접근|권한.*(?:분리|검사|확인)|같은\s*(?:내부\s*회원|프로젝트\s*팀)|근거\s*(?:부족|충돌)|(?:넘깁니다|넘긴다|않습니다|않는다|안\s*된다)[.!。]?$/;

export function coreFeatureLabel(value: string): string | null {
  const managesPresentation = /(?:관리|편집|생성|제작|내보내기|변환)$/.test(value);
  if ((presentation.test(value) && !managesPresentation) || stateOrFragment.test(value) || policyOrSentence.test(value)
    || /(?:은|는)\s+.*(?:공개|불변|적용)$/.test(value) || /^합의\s*후\s*새\s*확정$/.test(value)) return null;
  // API/model checks and version-specific substeps are implementation details.
  if (/^(?:KEY|SHA|API|[A-Z][A-Za-z0-9.-]*)\s*:?.*(?:재검사|충돌\s*검사)$/.test(value)
    || /^(?:새\s*버전\s*재전송|비공개\s*수정\s*의견|팀\s*공개\s*확정|참여자\s*검토|권한[·ㆍ].*확인)$/.test(value)
    || /(?:상태|본문[·ㆍ].*영역)\s*분리$/.test(value)) return null;
  let label = value.replace(/^(?:승인(?:된)?\s*회원의?|사용자의|관리자의|기존\s+송신자의)\s+/, '')
    .replace(/[을를]\s+(?=(?:대조|검증|확인|전송|조회)$)/, '')
    .replace(/(?:·재전송|[·ㆍ]재전송)$/, '');
  if (/^(?:[A-Za-z][A-Za-z /·-]*\s+)?로그인$/.test(label)) label = '로그인';
  if (/^일반\s+요청\s+전송$/.test(label)) label = '요청 전송';
  if (label === '팀 공개 회신') label = '팀 회신';
  if (/^(?:미리보기\s*후\s*게시한|최소사실\s*문장\s*공개|공개)\s+회신$/.test(label)) label = '회신';
  return label;
}

export function selectCoreFeatures(values: string[]): string[] {
  const labels = values.flatMap(value => coreFeatureLabel(value) ?? []);
  const requests = labels.some(label => /요청\s*전송$/.test(label));
  const contracts = labels.some(label => /계약\s*제안$/.test(label));
  return labels.filter(label => !(requests && /^(?:수정 요청|비공개 검토)$/.test(label)) && !(contracts && label === '제안 철회'));
}
