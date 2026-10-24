// Чистая логика подбора: без DOM, чтобы её можно было тестировать отдельно (tests/filters.test.html).

export const MIN_SUBJECTS = 3;
// Русский и математика обязательны для аттестата, поэтому отмечены всегда.
export const LOCKED_SUBJECTS = ['rus', 'math'];

/**
 * Предметы, которые засчитывают вузы. Базовую математику вузы не принимают:
 * она считается сданным экзаменом (для минимума из трёх), но не открывает программы с математикой.
 */
export function effectiveSubjects(state) {
  if (!state.mathBase || !state.subjects.has('math')) return state.subjects;
  const set = new Set(state.subjects);
  set.delete('math');
  return set;
}

const collator = new Intl.Collator('ru', { sensitivity: 'base' });

/** Связывает программы с вузами и городами и готовит строку для поиска. */
export function buildIndex(data) {
  const cities = new Map(data.cities.map((c) => [c.id, c]));
  const unis = new Map(data.universities.map((u) => [u.id, { ...u, cityName: cities.get(u.city)?.name ?? '' }]));
  const subjects = new Map(data.subjects.map((s) => [s.id, s]));
  const programs = data.programs.map((raw) => {
    // Экспорт выкидывает пустые поля, чтобы файл был меньше; возвращаем значения по умолчанию.
    const p = { profile: '', faculty: '', code: '', level: '', req: [], choice: [], extra: [], scores: {}, ...raw };
    if (p.score == null && Object.keys(p.scores).length) {
      p.year = Math.max(...Object.keys(p.scores).map(Number));
      p.score = p.scores[p.year];
    }
    p.score ??= null;
    p.year ??= null;
    const uni = unis.get(p.uni);
    return {
      ...p,
      uniObj: uni,
      cityId: uni?.city ?? null,
      dirKey: p.code || p.name,
      area: /^\d{2}\./.test(p.code) ? p.code.slice(0, 2) : '',
      trend: trend(p),
      // Максимум суммы: по 100 за каждый экзамен, включая обязательные испытания вуза.
      maxScore: 100 * (p.req.length + p.choice.length + p.extra.filter((e) => !e.endsWith('(по выбору)')).length),
      haystack: normalizeText([p.name, p.code, p.profile, p.faculty, uni?.name, uni?.fullName, uni?.cityName].join(' ')),
      uniKey: normalizeText([uni?.name, uni?.fullName].join(' ')),
    };
  });
  const scored = programs.map((p) => p.score).filter((s) => s != null);
  return {
    meta: data.meta,
    subjects,
    subjectList: data.subjects,
    cities,
    unis,
    programs,
    scoreBounds: scored.length
      ? { min: Math.floor(Math.min(...scored) / 10) * 10, max: Math.ceil(Math.max(...scored) / 10) * 10 }
      : { min: 0, max: 300 },
  };
}

export function normalizeText(text) {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Подходит ли набор предметов: все обязательные есть и в каждой группе «по выбору» есть хотя бы один. */
export function isEligible(program, selected) {
  return program.req.every((s) => selected.has(s)) && program.choice.every((g) => g.some((s) => selected.has(s)));
}

/**
 * Какие предметы по одному «открывают» программу, если добавить их к выбранным.
 * Возвращает [] если программа уже подходит или не хватает больше одного предмета.
 */
export function unlockingSubjects(program, selected) {
  const missingReq = program.req.filter((s) => !selected.has(s));
  const openGroups = program.choice.filter((g) => !g.some((s) => selected.has(s)));
  if (missingReq.length > 1) return [];
  if (missingReq.length === 1) {
    const [s] = missingReq;
    return openGroups.every((g) => g.includes(s)) ? [s] : [];
  }
  if (openGroups.length === 0) return [];
  return openGroups.reduce((acc, g) => acc.filter((s) => g.includes(s)));
}

/** Сумма баллов абитуриента по экзаменам программы или null, если каких-то баллов не хватает. */
export function myTotal(program, selected, myScores) {
  let total = 0;
  for (const s of program.req) {
    const v = myScores[s];
    if (!selected.has(s) || v == null) return null;
    total += v;
  }
  for (const group of program.choice) {
    const options = group.filter((s) => selected.has(s) && myScores[s] != null).map((s) => myScores[s]);
    if (!options.length) return null;
    total += Math.max(...options);
  }
  return total;
}

export function hasScoreFilter(state, bounds) {
  return (state.min != null && state.min > bounds.min) || (state.max != null && state.max < bounds.max);
}

/** Все фильтры, кроме предметов. Нужен отдельно, чтобы считать «+N программ» для каждого предмета. */
export function matchesBaseFilters(p, state, bounds) {
  if (state.city && p.cityId !== state.city) return false;
  if (state.uni && p.uni !== state.uni) return false;
  if (state.dir && p.dirKey !== state.dir) return false;
  if (state.forms.size && !state.forms.has(p.form)) return false;
  if (state.levels.size && !state.levels.has(p.level)) return false;
  if (p.score == null) {
    // Программы без проходного (только платно, только БВИ) видны, пока не включён «Только бюджет» или диапазон балла.
    if (state.budgetOnly || hasScoreFilter(state, bounds)) return false;
  } else if (hasScoreFilter(state, bounds)) {
    if (state.min != null && p.score < state.min) return false;
    if (state.max != null && p.score > state.max) return false;
  }
  if (state.q) {
    const words = normalizeText(state.q).split(' ');
    if (!words.every((w) => p.haystack.includes(w))) return false;
  }
  return true;
}

/**
 * Главная функция: возвращает подходящие программы и подсказки «+N» для невыбранных предметов.
 * Пока выбрано меньше MIN_SUBJECTS предметов, список пуст (ready = false).
 */
export function computeResults(index, state) {
  const selected = effectiveSubjects(state);
  const ready = state.subjects.size >= MIN_SUBJECTS;
  const unlock = new Map();
  const items = [];
  const showUnlock = state.subjects.size + 1 >= MIN_SUBJECTS;

  for (const p of index.programs) {
    if (!matchesBaseFilters(p, state, index.scoreBounds)) continue;
    if (isEligible(p, selected)) {
      if (!ready) continue;
      const mine = state.showScores ? myTotal(p, selected, state.myScores) : null;
      const margin = mine != null && p.score != null ? mine - p.score : null;
      if (state.fits && !(margin != null && margin >= 0)) continue;
      items.push({ p, mine, margin });
    } else if (showUnlock) {
      for (const s of unlockingSubjects(p, selected)) unlock.set(s, (unlock.get(s) ?? 0) + 1);
    }
  }
  return { ready, items: sortItems(items, state.sort), unlock };
}

const SORTERS = {
  'score-desc': (a, b) => nullsLast(a.p.score, b.p.score, (x, y) => y - x),
  'score-asc': (a, b) => nullsLast(a.p.score, b.p.score, (x, y) => x - y),
  'margin-desc': (a, b) => nullsLast(a.margin, b.margin, (x, y) => y - x),
  'trend-desc': (a, b) => nullsLast(a.p.trend, b.p.trend, (x, y) => y - x),
  'cost-asc': (a, b) => nullsLast(a.p.cost, b.p.cost, (x, y) => x - y),
  name: (a, b) => collator.compare(a.p.name, b.p.name),
  uni: (a, b) => collator.compare(a.p.uniObj?.name ?? '', b.p.uniObj?.name ?? ''),
};

export const SORT_OPTIONS = [
  ['score-desc', 'Проходной балл ↓'],
  ['score-asc', 'Проходной балл ↑'],
  ['margin-desc', 'Запас моих баллов'],
  ['trend-desc', 'Рост балла за год'],
  ['cost-asc', 'Платное дешевле'],
  ['name', 'Направление А–Я'],
  ['uni', 'Вуз А–Я'],
];

export function sortItems(items, key) {
  const primary = SORTERS[key] ?? SORTERS['score-desc'];
  return items.sort((a, b) => primary(a, b) || collator.compare(a.p.name, b.p.name) || a.p.id - b.p.id);
}

function nullsLast(a, b, cmp) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return cmp(a, b);
}

/** Изменение проходного балла к предыдущему известному году. */
export function trend(p) {
  const years = Object.keys(p.scores).map(Number).sort((a, b) => a - b);
  if (years.length < 2) return null;
  return p.scores[years.at(-1)] - p.scores[years.at(-2)];
}

export function pluralize(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
