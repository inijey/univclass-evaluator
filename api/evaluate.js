// 간단한 CSV 파서
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\r') { /* skip */ }
      else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += char; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// CSV를 월별 필터링해서 대화 텍스트로 변환
function csvToFilteredDialogue(csvText, targetMonth) {
  const rows = parseCSV(csvText);
  if (rows.length === 0) return '';
  const header = rows[0].map(h => h.trim().toLowerCase());
  const dIdx = header.indexOf('date') >= 0 ? header.indexOf('date') : 0;
  const uIdx = header.indexOf('user') >= 0 ? header.indexOf('user') : 1;
  const mIdx = header.indexOf('message') >= 0 ? header.indexOf('message') : 2;

  const lines = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const dateStr = (r[dIdx] || '').trim();
    const user = (r[uIdx] || '').trim();
    const message = (r[mIdx] || '').trim();
    if (!dateStr || !message) continue;
    const match = dateStr.match(/^\d{4}-(\d{2})-\d{2}/);
    if (!match) continue;
    const month = parseInt(match[1], 10);
    if (targetMonth && month !== targetMonth) continue;
    lines.push(`[${dateStr}] ${user}: ${message}`);
  }
  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { logText, studentName, targetMonth, isCSV, allMonths } = req.body;
  if (!logText || !studentName) return res.status(400).json({ error: '필수 파라미터가 없습니다.' });

  const CRITERIA = `[평가 기준 - 카카오톡 소통 및 관리]
1. 응답속도·정확성
 상: 평균 응답 2시간 이내, 질문 의도를 정확히 파악하고 실용적 정보 제공
 중: 대체로 4시간 이내 응답, 답변 품질 보통
 하: 응답 자주 늦거나 누락, 답변 부정확

2. 주도적 안내·격려 빈도
 상: 주 3회 이상 먼저 맞춤 공지·격려·리마인드 제공
 중: 주 1~2회 정도 먼저 안내, 다소 형식적
 하: 거의 학생 질문에만 반응

3. 피드백 구체성
 상: 생기부 활동, 수행평가, 과목별 상황에 맞춘 구체적·실행 가능한 피드백
 중: 피드백 있으나 일반적·추상적
 하: 단순 확인 수준, 매우 짧고 추상적

4. 정서적 지지·동기부여
 상: 감정 상태 파악·공감, 긍정적 동기부여·격려 자연스럽게 이루어짐
 중: 기본 격려 있으나 다소 형식적
 하: 정서적 표현 거의 없거나 업무적·딱딱한 소통`;

  const SYSTEM_PROMPT = `당신은 교육 컨설팅 회사 유니브클래스의 컨설턴트 업무 평가 AI입니다.
아래 기준에 따라 카카오톡 대화로그를 분석하고, 4개 영역 각각을 상/중/하로 평가하세요.
${CRITERIA}

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "응답속도정확성": {"등급": "상|중|하", "이유": "1~2문장 근거"},
  "주도적안내격려": {"등급": "상|중|하", "이유": "1~2문장 근거"},
  "피드백구체성": {"등급": "상|중|하", "이유": "1~2문장 근거"},
  "정서적지지동기": {"등급": "상|중|하", "이유": "1~2문장 근거"}
}

중요: 반드시 모든 4개 영역에 등급(상/중/하 중 하나)을 빠짐없이 입력하세요. 등급이 누락되면 안 됩니다.`;

  // 월별 전체 평가 모드 (3~7월 자동 분리)
  if (allMonths && isCSV) {
    const monthResults = {};
    const monthsToEval = [3, 4, 5, 6, 7];

    for (const month of monthsToEval) {
      const dialogue = csvToFilteredDialogue(logText, month);
      if (!dialogue || dialogue.trim().length === 0) continue;

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1000,
            system: SYSTEM_PROMPT,
            messages: [{
              role: 'user',
              content: `학생명: ${studentName}\n평가 대상 월: ${month}월\n\n${dialogue.slice(0, 12000)}`
            }],
          }),
        });
        if (!response.ok) continue;
        const data = await response.json();
        const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
const monthParsed = JSON.parse(raw);
const keys = ['응답속도정확성', '주도적안내격려', '피드백구체성', '정서적지지동기'];
keys.forEach(k => {
  if (monthParsed[k] && !['상','중','하'].includes(monthParsed[k].등급)) {
    monthParsed[k].등급 = '중';
  }
});
monthResults[month] = monthParsed;      } catch (e) {
        continue;
      }
    }
    return res.status(200).json({ allMonths: true, monthResults });
  }

  // 단일 월 평가 모드
  let processedText = logText;
  if (isCSV) {
    processedText = csvToFilteredDialogue(logText, targetMonth ? parseInt(targetMonth, 10) : null);
    if (!processedText || processedText.trim().length === 0) {
      return res.status(200).json({
        응답속도정확성: { 등급: '하', 이유: `${targetMonth}월 대화 기록 없음` },
        주도적안내격려: { 등급: '하', 이유: `${targetMonth}월 대화 기록 없음` },
        피드백구체성: { 등급: '하', 이유: `${targetMonth}월 대화 기록 없음` },
        정서적지지동기: { 등급: '하', 이유: `${targetMonth}월 대화 기록 없음` },
      });
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `학생명: ${studentName}${targetMonth ? `\n평가 대상 월: ${targetMonth}월` : ''}\n\n${processedText.slice(0, 12000)}`
        }],
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: `Anthropic API 오류: ${err}` });
    }
    const data = await response.json();
    const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
// 등급 누락 시 이유에서 추론하거나 기본값 설정
const keys = ['응답속도정확성', '주도적안내격려', '피드백구체성', '정서적지지동기'];
keys.forEach(k => {
  if (parsed[k] && !['상','중','하'].includes(parsed[k].등급)) {
    parsed[k].등급 = '중'; // 기본값
  }
});
return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
