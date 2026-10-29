// ИИ-помощник: фраза обычными словами («айти в Питере, 230 баллов, бюджет») -> предметы, баллы и фильтры.
// Пока AI_ENDPOINT пустой, работает простой разбор прямо в браузере (parseLocally): без сервера и без ключей.
// Когда сервер готов (api/assistant.py, инструкция в AI_SETUP.md), впиши сюда его адрес,
// например 'https://unimatch.vercel.app/api/assistant' или просто '/api/assistant', если сайт на том же Vercel.
import { AREAS, FORMS, REGION_ALIASES } from './catalog.js';
import { LANGS, LOCKED_SUBJECTS, normalizeText } from './filters.js';

export const AI_ENDPOINT = '';
const AI_TIMEOUT_MS = 20000;

/*
 * План — то, что помощник понял из фразы. Тот же формат возвращает сервер (api/assistant.py):
 * {
 *   reply: 'короткий ответ человеку',
 *   subjects: ['phys', 'inf'],            // предметы по выбору, которые он сдаёт
 *   math_level: 'profile' | 'base' | 'unknown',
 *   scores: [{ subject: 'rus', score: 85 }],
 *   total_score: 230,                     // сумма, если баллы по предметам не названы; 0 — не названа
 *   region: 'Санкт-Петербург',            // как назвал человек; '' — любой
 *   areas: ['09', '10'],                  // группы направлений из AREAS
 *   query: '',                            // слово для поиска, если группы не хватает
 *   budget: 'budget_only' | 'any',
 *   forms: ['Очная'],
 *   only_fits: true,                      // показать только то, куда хватает баллов
 *   sort: 'keep' | 'score-desc' | 'score-asc' | 'margin-desc' | 'cost-asc',
 * }
 */
export const EMPTY_PLAN = Object.freeze({
  reply: '', subjects: [], math_level: 'unknown', scores: [], total_score: 0, region: '', areas: [],
  query: '', budget: 'any', forms: [], only_fits: false, sort: 'keep',
});

const SORT_NOTES = {
  'score-desc': 'сначала с высоким проходным', 'score-asc': 'сначала с низким проходным',
  'margin-desc': 'сначала с большим запасом баллов', 'cost-asc': 'сначала дешёвое платное',
};
const SORTS = Object.keys(SORT_NOTES);

/** Спросить помощника. Если сервер не настроен или не ответил — разбираем фразу сами. */
export async function askAssistant(text, regionNames) {
  if (AI_ENDPOINT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.plan) return { plan: { ...EMPTY_PLAN, ...body.plan }, source: 'ai' };
      return { plan: parseLocally(text, regionNames), source: 'local', error: body?.error || `HTTP ${res.status}` };
    } catch (err) {
      return { plan: parseLocally(text, regionNames), source: 'local', error: err.name === 'AbortError' ? 'долго нет ответа' : 'нет связи' };
    } finally {
      clearTimeout(timer);
    }
  }
  return { plan: parseLocally(text, regionNames), source: 'local' };
}

// ------------------------------------------------------------------ простой разбор без ИИ

// Слова пишем без окончаний: «физик» ловит и «физика», и «физику».
const SUBJECT_WORDS = [
  ['rus', /^рус/],
  ['math', /^мат(ем|ан$|$)|^профил/],
  ['phys', /^физик/],
  ['inf', /^информатик|^инф$|^икт$/],
  ['chem', /^хими/],
  ['bio', /^биол|^био$/],
  ['soc', /^обществ|^общ$|^обща$/],
  ['hist', /^истори/],
  ['lit', /^литер|^литр/],
  ['geo', /^географ|^гео$/],
  ['eng', /^англ/],
  ['ger', /^немец|^немецк/],
  ['fra', /^француз/],
  ['spa', /^испан/],
  ['chi', /^китайск/],
];

// Профессии и интересы -> группы направлений (коды из AREAS).
const AREA_WORDS = [
  [/айти|(^| )it( |$)|(^| )ит( |$)|программист|программирован|разработ|кодинг|компьютер|нейросет|искусственн[а-я]* интеллект|(^| )ии( |$)|геймдев|data science|датасаенс/, ['02', '09', '10']],
  [/кибербез|информационн[а-я]* безопасн|безопасник/, ['10']],
  [/медицин|врач|доктор|медик|хирург|педиатр|стоматолог|лечеб/, ['31', '32']],
  [/фармац|провизор/, ['33']],
  [/юрист|юриспруд|правовед|адвокат|прокурор|следовател|(^| )прав(о|у|а)( |$)/, ['40']],
  [/эконом|финанс|бухгалт|менеджмент|менеджер|бизнес|маркетинг|маркетолог|банк|аудит|логистик|управлени/, ['38']],
  [/психолог/, ['37']],
  [/педагог|учител|преподава/, ['44']],
  [/лингвист|переводчик|филолог|иностранн[а-я]* язык/, ['45']],
  [/журналист|медиа|реклам|пиар|(^| )pr( |$)|блогер/, ['42']],
  [/дизайн|художник|иллюстрат/, ['54']],
  [/архитект/, ['07']],
  [/строител|строительств/, ['08']],
  [/инженер|машиностро|робототех|робот|мехатрон|автоматизац/, ['15', '27']],
  [/авиа|самолет|космос|космическ|ракет|летчик|пилот/, ['24', '25']],
  [/энергет|атомн|ядерн/, ['13', '14']],
  [/нефт|газ|геолог|горн(ое|ым|ый)|шахт/, ['21']],
  [/электроник|радиотех|связь|телеком/, ['11']],
  [/эколог|природопольз/, ['05', '20']],
  [/туризм|гостинич|ресторан|сервис/, ['43']],
  [/спорт|тренер|физкульт|фитнес/, ['49']],
  [/музык|вокал/, ['53']],
  [/актер|театр|режисс|кино/, ['52', '55']],
  [/ветеринар/, ['36']],
  [/агроном|сельск|фермер/, ['35']],
  [/транспорт|железнодорож|автомобил/, ['23']],
  [/полит|международн|дипломат/, ['41']],
  [/социолог|социальн[а-я]* работ/, ['39']],
  [/военн|офицер/, ['56']],
  [/востоковед|япон|корейск|арабск/, ['58']],
];

// В названиях регионов эти слова ничего не говорят о месте.
const GENERIC = new Set(['республика', 'область', 'край', 'автономный', 'автономная', 'округ', 'город']);
const stem = (word) => word.replace(/[аеиоуыэюяьй]+$/, '');

/** Ключи для поиска региона в тексте: значимые слова из названия и городов, без окончаний. */
function regionKeys(name) {
  return normalizeText(`${name} ${REGION_ALIASES[name] ?? ''}`)
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => !GENERIC.has(w))
    .map(stem)
    .filter((s) => s.length >= 4);
}

/** Какой регион назван в тексте (берём упомянутый раньше всех). Возвращает его название или ''. */
export function findRegion(text, regionNames) {
  const words = normalizeText(text).replace(/спб/g, 'санкт петербург').split(/[^a-zа-я0-9]+/).filter(Boolean);
  let best = null;
  for (const name of regionNames) {
    const keys = regionKeys(name);
    const pos = words.findIndex((w) => keys.some((k) => w.startsWith(k)));
    if (pos >= 0 && (!best || pos < best.pos)) best = { name, pos };
  }
  return best?.name ?? '';
}

/** Разбор без ИИ: ключевые слова и числа рядом с предметами. Понимает простые фразы, на хитрые отвечает пустым планом. */
export function parseLocally(text, regionNames = []) {
  // Знаки препинания -> пробелы: тогда «база,» и «база» ловятся одинаково.
  const t = normalizeText(String(text).replace(/[^\p{L}\p{N}]+/gu, ' '));
  const plan = { ...EMPTY_PLAN, subjects: [], scores: [], areas: [], forms: [] };
  const tokens = t.split(/[^a-zа-я0-9]+/).filter(Boolean);
  const subjectAt = tokens.map((w) => SUBJECT_WORDS.find(([, re]) => re.test(w))?.[0] ?? null);

  const subjects = new Set(subjectAt.filter(Boolean));
  const scored = new Set();
  tokens.forEach((w, i) => {
    if (!/^\d{1,3}$/.test(w)) return;
    const n = Number(w);
    // Число рядом с предметом — балл по нему: «физика 80», «80 по физике». Сначала смотрим назад.
    const near = [i - 1, i - 2, i + 1, i + 2, i + 3].find((j) => subjectAt[j] && !scored.has(subjectAt[j]));
    if (n <= 100 && near != null) {
      scored.add(subjectAt[near]);
      plan.scores.push({ subject: subjectAt[near], score: n });
    } else if (n > 100 && n <= 500 && !plan.total_score) {
      plan.total_score = n;
    }
  });
  plan.subjects = [...subjects].filter((s) => !LOCKED_SUBJECTS.includes(s));
  if (/базов[а-я]* мат|мат[а-я]* баз|(^| )баз(а|у|е)( |$)/.test(t)) plan.math_level = 'base';
  else if (/профил/.test(t)) plan.math_level = 'profile';

  for (const [re, codes] of AREA_WORDS) if (re.test(t)) plan.areas.push(...codes);
  plan.areas = [...new Set(plan.areas)];
  plan.region = findRegion(t, regionNames);
  if (/бюджет|бесплатн/.test(t)) plan.budget = 'budget_only';
  if (/очно.?заочн|вечерн/.test(t)) plan.forms.push('Очно-заочная');
  else if (/(^| )заочн/.test(t)) plan.forms.push('Заочная');
  else if (/(^| )очн/.test(t)) plan.forms.push('Очная');
  if (/прохож|пройду|поступлю|хватает|хватит|реальн|шанс/.test(t)) plan.only_fits = true;
  if (/дешев|недорог/.test(t)) plan.sort = 'cost-asc';
  else if (/запас|надежн|наверняка/.test(t)) plan.sort = 'margin-desc';
  return plan;
}

// ------------------------------------------------------------------ применение плана

const shortRegion = (name) => name.split(' и ')[0];

/**
 * Переносит план в состояние подбора. Фильтры (регион, направления, бюджет…) задаются заново,
 * предметы и баллы меняются, только если о них сказано. Возвращает строки «что понял» для ответа.
 */
export function applyPlan(raw, state, index) {
  const plan = { ...EMPTY_PLAN, ...raw };
  const notes = [];
  const subjectName = (id) => (index.subjects.get(id)?.name ?? id).replace(/ \(профильная\)$/, '');

  Object.assign(state, {
    city: null, uni: null, dir: '', areas: new Set(), forms: new Set(), levels: new Set(),
    min: null, max: null, budgetOnly: false, fits: false, q: '',
  });

  const chosen = arr(plan.subjects).filter((s) => index.subjects.has(s) && !LOCKED_SUBJECTS.includes(s));
  if (chosen.length) {
    state.subjects = new Set(LOCKED_SUBJECTS);
    for (const s of chosen) addSubject(state, s);
    notes.push(`предметы: ${chosen.map(subjectName).map((n) => n.toLowerCase()).join(', ')}`);
  }
  if (plan.math_level === 'base' || plan.math_level === 'profile') {
    state.mathBase = plan.math_level === 'base';
    notes.push(state.mathBase ? 'математика базовая' : 'математика профильная');
  }

  const scores = arr(plan.scores).filter((x) => index.subjects.has(x?.subject) && Number.isFinite(x.score));
  const total = Number(plan.total_score);
  // Названы новые баллы — старые (из прошлого запроса) не смешиваем с ними.
  if (scores.length || total > 0) state.myScores = {};
  for (const { subject, score } of scores) {
    state.myScores[subject] = Math.round(Math.min(100, Math.max(0, score)));
    if (!LOCKED_SUBJECTS.includes(subject)) addSubject(state, subject);
  }
  // Балл по математике без слова «база» — значит, профильная.
  if (plan.math_level === 'unknown' && scores.some((x) => x.subject === 'math')) state.mathBase = false;
  if (scores.length) notes.push(`баллы: ${scores.map((x) => `${subjectName(x.subject).toLowerCase()} ${state.myScores[x.subject]}`).join(', ')}`);

  if (!scores.length && total > 0) {
    // Названа только сумма: делим поровну на три экзамена, точнее человек впишет сам.
    const per = Math.min(100, Math.round(total / 3));
    const exams = [...state.subjects].filter((s) => s !== 'math' || !state.mathBase);
    for (const s of exams) state.myScores[s] = per;
    notes.push(`сумма ${total}: поставил по ${per} на каждый предмет, поправь точные баллы ниже`);
  }

  const region = plan.region ? findRegion(plan.region, [...index.cities.values()].map((c) => c.name)) : '';
  if (region) {
    state.city = [...index.cities.values()].find((c) => c.name === region).id;
    notes.push(`регион: ${shortRegion(region)}`);
  }

  const areas = arr(plan.areas).filter((a) => AREAS[a] && index.programs.some((p) => p.area === a));
  if (areas.length) {
    state.areas = new Set(areas);
    notes.push(`направления: ${areasLabel(state.areas)}`);
  }
  if (plan.query) {
    state.q = String(plan.query).slice(0, 100);
    notes.push(`поиск «${state.q}»`);
  }
  if (plan.budget === 'budget_only') {
    state.budgetOnly = true;
    notes.push('только бюджет');
  }
  const forms = arr(plan.forms).filter((f) => FORMS.includes(f));
  if (forms.length) {
    state.forms = new Set(forms);
    notes.push(forms.join(', ').toLowerCase());
  }
  if (plan.only_fits) {
    state.fits = true;
    notes.push('только куда хватает баллов');
  }
  if (SORTS.includes(plan.sort)) {
    state.sort = plan.sort;
    notes.push(SORT_NOTES[plan.sort]);
  }
  return notes;
}

/** «Информатика и вычислительная техника» или «Информационная безопасность и ещё 2». */
export function areasLabel(areas) {
  const names = [...areas].map((a) => AREAS[a]).filter(Boolean);
  if (names.length <= 1) return names[0] ?? '';
  return `${names[0]} и ещё ${names.length - 1}`;
}

function addSubject(state, id) {
  if (LANGS.includes(id)) for (const l of LANGS) state.subjects.delete(l);
  state.subjects.add(id);
}

const arr = (value) => (Array.isArray(value) ? value : []);
