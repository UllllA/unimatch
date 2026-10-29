// HTML-шаблоны. Все строки из данных проходят через esc(): данные парсятся со стороннего сайта.
import { pluralize, LOCKED_SUBJECTS, LANGS } from './filters.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);

// Один набор тонких линейных иконок вместо эмодзи: 24×24, цвет берётся из текста.
const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  scale: '<path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  building: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9.5 21v-5h5v5M9 11h.01M15 11h.01"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  sort: '<path d="M8 4v16M4.5 16.5 8 20l3.5-3.5M16 20V4M12.5 7.5 16 4l3.5 3.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M19 15.5v4M17 17.5h4"/>',
};

export function icon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ''}</svg>`;
}

// ------------------------------------------------------------------ предметы

/** Плашка предмета: отметка, название и поле для балла. Ввод балла сам отмечает предмет (app.js). */
function subjectTile({ id, name, title, note = '', extra = '', locked = false, badge = true }) {
  return `
    <div class="subject${locked ? ' is-locked' : ''}" data-id="${esc(id)}">
      <button type="button" class="subject__toggle" aria-pressed="false" title="${esc(title)}"${locked ? ' aria-disabled="true"' : ''}>
        <span class="subject__check" aria-hidden="true"></span>
        <span class="subject__text">
          <span class="subject__name">${esc(name)}</span>
          ${note ? `<span class="subject__note">${esc(note)}</span>` : ''}
          ${badge ? '<span class="subject__badge"></span>' : ''}
        </span>
      </button>
      <input class="subject__score" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="балл"
        data-score="${esc(id)}" aria-label="Мой балл ЕГЭ: ${esc(title)}">
      ${extra}
    </div>`;
}

/**
 * Две группы: обязательные (русский и математика с выбором уровня) и предметы по выбору.
 * Пять иностранных языков — одна плашка «Иностранный» со списком языков.
 */
export function mountSubjects(container, index) {
  const all = index.subjectList;
  const required = all.filter((s) => LOCKED_SUBJECTS.includes(s.id)).map((s) => (s.id === 'math'
    ? subjectTile({
      id: s.id, name: 'Математика', title: 'Математика', locked: true,
      extra: `<div class="seg" role="group" aria-label="Уровень математики">
        <button type="button" class="seg__btn" data-math="profile" aria-pressed="true">Профиль</button>
        <button type="button" class="seg__btn" data-math="base" aria-pressed="false">База</button>
      </div>`,
    })
    : subjectTile({ id: s.id, name: s.name, title: s.name, note: 'нужен везде', locked: true, badge: false })));
  const optional = all.filter((s) => !LOCKED_SUBJECTS.includes(s.id) && !LANGS.includes(s.id))
    .map((s) => subjectTile({ id: s.id, name: s.short, title: s.name }));
  const langs = all.filter((s) => LANGS.includes(s.id));
  if (langs.length) {
    optional.push(subjectTile({
      id: 'lang', name: 'Иностранный', title: 'Иностранный язык',
      extra: `<select class="subject__lang" data-lang aria-label="Какой иностранный язык сдаёшь">
        ${langs.map((s) => `<option value="${esc(s.id)}">${esc(s.short)}</option>`).join('')}</select>`,
    }));
  }
  container.innerHTML = `
    <p class="subjects__label">Обязательные</p>
    <div class="subjects__grid subjects__grid--req">${required.join('')}</div>
    <p class="subjects__label">По выбору <span>отметь хотя бы один</span></p>
    <div class="subjects__grid">${optional.join('')}</div>`;
}

/** id выбранного иностранного языка, а если не выбран — того, что стоит в списке плашки. */
export function langId(container, state) {
  return LANGS.find((l) => state.subjects.has(l)) ?? container.querySelector('[data-lang]')?.value ?? LANGS[0];
}

export function updateSubjects(container, state, unlock) {
  const select = container.querySelector('[data-lang]');
  const chosenLang = LANGS.find((l) => state.subjects.has(l));
  if (select && chosenLang && document.activeElement !== select) select.value = chosenLang;
  for (const el of container.querySelectorAll('.subject')) {
    const id = el.dataset.id === 'lang' ? langId(container, state) : el.dataset.id;
    const on = state.subjects.has(id);
    const base = id === 'math' && state.mathBase;
    el.classList.toggle('is-selected', on);
    el.classList.toggle('is-base', base);
    el.querySelector('.subject__toggle').setAttribute('aria-pressed', String(on));
    el.querySelectorAll('[data-math]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.math === 'base') === state.mathBase)));
    const input = el.querySelector('.subject__score');
    input.dataset.score = id;
    input.hidden = base; // базу ставят по пятибалльной шкале, вузы её не учитывают
    if (document.activeElement !== input) input.value = state.myScores[id] ?? '';
    const badge = el.querySelector('.subject__badge');
    if (badge) {
      // У математики «+N» — сколько программ откроет профильный уровень вместо базы.
      const n = base ? unlock.get(id) ?? 0 : on ? 0 : unlock.get(id) ?? 0;
      badge.textContent = n ? `+${n.toLocaleString('ru')} ${base ? 'с профильной' : pluralize(n, 'программа', 'программы', 'программ')}` : '';
      badge.title = n ? `${base ? 'С профильной откроет' : 'Добавит'} ${n} ${pluralize(n, 'программу', 'программы', 'программ')}` : '';
    }
  }
}

// ------------------------------------------------------------------ карточка программы

/**
 * Группа «по выбору» в виде списка вариантов. Если в группе есть все иностранные языки,
 * они сворачиваются в один вариант «Иностранный» (с выбранным языком, если он есть).
 */
function choiceOptions(group, index, selected) {
  const hasAllLangs = LANGS.every((l) => group.includes(l));
  const options = [];
  for (const id of group) {
    if (hasAllLangs && LANGS.includes(id)) continue;
    options.push({ label: index.subjects.get(id)?.short ?? id, ok: selected.has(id) });
  }
  if (hasAllLangs) {
    const mine = LANGS.filter((l) => selected.has(l)).map((l) => index.subjects.get(l)?.short);
    options.push({ label: mine.length ? `Иностранный (${mine.join(', ')})` : 'Иностранный', ok: mine.length > 0 });
  }
  return options;
}

/** Экзамены одной строкой; в группе «на выбор» маркером выделен предмет, который у тебя есть. */
function renderExams(p, index, selected) {
  const parts = p.req.map((id) => esc(index.subjects.get(id)?.short ?? id));
  for (const group of p.choice) {
    const options = choiceOptions(group, index, selected);
    parts.push(options.map((o) => (o.ok && options.length > 1 ? `<mark>${esc(o.label)}</mark>` : esc(o.label))).join(' или '));
  }
  const extra = p.extra
    .map((e) => `<span class="exams__extra" title="Вступительное испытание вуза">+ ${esc(e.replace('Внутренний экзамен вуза', 'экзамен вуза'))}</span>`)
    .join(' ');
  return `<p class="exams"><span class="exams__label">ЕГЭ</span> ${parts.join(', ')}${extra ? ` ${extra}` : ''}</p>`;
}

function renderScore(p) {
  if (p.score == null) {
    // «Только БВИ»: бюджет есть, но все места заняли олимпиадники — это не то же самое, что «нет бюджета».
    const label = p.note === 'Только БВИ' ? 'только олимпиадники' : p.note ? 'нет бюджета' : 'нет данных';
    return `<div class="score score--none"><span class="score__value">—</span><span class="score__label">${esc(label)}</span></div>`;
  }
  const history = Object.keys(p.scores).sort().map((y) => `${y}: ${p.scores[y]}`).join(' · ');
  return `
    <div class="score" title="${esc(history)}">
      <span class="score__value">${p.score}</span>
      <span class="score__label">проходной ${esc(p.year)}</span>
    </div>`;
}

/** Шкала шансов: где твоя сумма относительно проходного на бюджет. */
function renderChance(item, state) {
  if (!state.showScores) return '';
  if (item.mine == null) return '<p class="chance chance--none">Впиши баллы по всем экзаменам программы, чтобы посчитать шансы</p>';
  if (item.margin == null) {
    return `<p class="chance chance--none">${item.p.score == null
      ? `Твоя сумма ${item.mine}, проходного на бюджет нет`
      : item.p.dvi
        ? `Твои ЕГЭ: ${item.mine}. В проходной входит экзамен вуза, поэтому сравнить нельзя`
        : `Твои ЕГЭ: ${item.mine}. Проходной ${item.p.score} больше максимума по ЕГЭ: в нём учтены экзамен вуза или дополнительные баллы, поэтому сравнить нельзя`}</p>`;
  }
  const { mine, margin } = item;
  const pass = item.p.score;
  const lo = Math.max(0, Math.min(mine, pass) - 30);
  const hi = Math.max(mine, pass) + 30;
  const pct = (v) => (((v - lo) / (hi - lo)) * 100).toFixed(1);
  const [kind, text] = margin >= 10 ? ['good', `<mark>Проходишь с запасом +${margin}</mark>`]
    : margin >= 0 ? ['edge', `На грани: запас +${margin}`]
      : ['bad', `<span class="pen">Не хватает ${-margin}</span>`];
  return `
    <div class="chance chance--${kind}">
      <div class="chance__bar" aria-hidden="true"><span class="chance__fill" style="width:${pct(mine)}%"></span><span class="chance__pass" style="left:${pct(pass)}%"></span></div>
      <p class="chance__text">${text} <small>твои ${mine}, проходной ${pass}</small></p>
    </div>`;
}

const NOTE_HINTS = {
  'Только БВИ': 'Все бюджетные места заняли поступающие без вступительных испытаний (победители олимпиад)',
  'Только платно': 'Приём только на платной основе: бюджетных мест нет',
};

/** Стабильный ключ программы (не меняется при пересборке данных) — для избранного и сравнения. */
export const progKey = (p) => `${p.pid ?? p.id}-${p.form}`;

const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? u : '');
// Неразрывный пробел перед ₽: знак рубля не переносится на отдельную строку.
const rub = (n) => `${Math.round(n).toLocaleString('ru')} ₽`;
const shortCity = (name) => String(name ?? '').split(' и ')[0];
/** 130 тыс. ₽ / 1,2 млн ₽ — коротко, чтобы влезло в строку вуза на телефоне. */
const shortRub = (n) => (n >= 999500
  ? `${(n / 1e6).toLocaleString('ru', { maximumFractionDigits: 1 })} млн ₽`
  : `${Math.round(n / 1000)} тыс. ₽`);

/**
 * Ссылка «официальная страница программы»: прямых адресов программ нет ни в одном источнике,
 * поэтому открываем поиск Яндекса только по официальному сайту вуза — первая ссылка почти всегда та самая.
 */
export function officialProgramUrl(p, uni) {
  const what = [p.code, p.name, p.profile].filter(Boolean).join(' ');
  let host = '';
  try {
    host = uni?.site ? new URL(uni.site).hostname.replace(/^www\./, '') : '';
  } catch {
    host = '';
  }
  const query = host ? `${what} site:${host}` : `${uni?.fullName ?? ''} ${what} официальный сайт`;
  return `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;
}

/** selected — предметы, которые засчитывают вузы (effectiveSubjects): по ним отмечены экзамены. */
export function renderCard(item, index, state, selected) {
  const { p } = item;
  const uni = p.uniObj ?? { id: 0, name: '—', fullName: '' };
  const site = safeUrl(uni.site);
  const tabUrl = p.pid ? `https://tabiturient.ru/program/n/?${encodeURIComponent(p.pid)}` : safeUrl(uni.url);
  const key = progKey(p);
  const fav = Boolean(state.favs?.has(key));
  const cmp = Boolean(state.cmp?.has(key));
  const meta = [p.code && `<span class="card__code">${esc(p.code)}</span>`, esc(p.level), esc(p.form.toLowerCase())].filter(Boolean).join(' · ');
  const flags = [
    p.dvi && '<span class="flag" title="Проходной балл включает внутренний экзамен вуза">балл с экзаменом вуза</span>',
    p.maxScore && p.maxScore !== 300 && !p.dvi && `<span class="flag">сумма из ${p.maxScore}</span>`,
    p.note && `<span class="flag flag--note"${NOTE_HINTS[p.note] ? ` title="${esc(NOTE_HINTS[p.note])}"` : ''}>${esc(p.note)}</span>`,
  ].filter(Boolean).join('');
  return `
  <li class="card">
    <div class="card__head">
      <div class="card__uni">
        <span class="card__uni-name" title="${esc(uni.fullName)}">${esc(uni.name)}</span>
        ${uni.cityName ? `<span class="card__city" title="${esc(uni.cityName)}">${esc(shortCity(uni.cityName))}</span>` : ''}
      </div>
      ${renderScore(p)}
    </div>
    <h3 class="card__title">${esc(p.name)}</h3>
    ${p.profile ? `<p class="card__profile" title="${esc(p.profile)}">${esc(p.profile)}</p>` : ''}
    <p class="card__meta">${meta}${flags}</p>
    ${renderExams(p, index, selected)}
    ${renderChance(item, state)}
    <p class="card__money">${p.cost ? `Платно: <b>${rub(p.cost)}</b> в год` : '<span class="muted">Цена платного не указана</span>'}</p>
    ${p.faculty ? `<p class="card__faculty" title="${esc(p.faculty)}">${esc(p.faculty)}</p>` : ''}
    <div class="card__foot">
      <div class="card__links">
        ${site ? `<a class="card__link" href="${esc(site)}" target="_blank" rel="noopener noreferrer">Сайт вуза</a>` : ''}
        <a class="card__link" href="${esc(officialProgramUrl(p, uni))}" target="_blank" rel="noopener noreferrer"
          title="Найти страницу программы на ${site ? 'официальном сайте вуза' : 'сайте вуза'} через Яндекс">Найти программу</a>
        ${tabUrl ? `<a class="card__link card__link--quiet" href="${esc(tabUrl)}" target="_blank" rel="noopener noreferrer" title="Страница программы на Табитуриенте">Табитуриент</a>` : ''}
      </div>
      <div class="card__acts">
        <button type="button" class="act act--fav${fav ? ' is-on' : ''}" data-fav="${esc(key)}" aria-pressed="${fav}"
          aria-label="Избранное: ${esc(p.name)}, ${esc(uni.name)}" title="${fav ? 'Убрать из избранного' : 'В избранное'}">${icon('heart')}</button>
        <button type="button" class="act${cmp ? ' is-on' : ''}" data-cmp="${esc(key)}" aria-pressed="${cmp}">${icon('scale')}<span>${cmp ? 'В сравнении' : 'Сравнить'}</span></button>
      </div>
    </div>
  </li>`;
}

// ------------------------------------------------------------------ режим «Вузы»

/** Строка вуза: сколько подходящих программ, разброс проходных, цена от, сколько проходишь. */
export function renderUniRow(g, state) {
  const u = g.uni ?? { name: '—' };
  const n = g.items.length;
  const range = g.minScore == null ? 'нет данных' : g.minScore === g.maxScore ? `${g.minScore}` : `${g.minScore}–${g.maxScore}`;
  const stats = [
    [`${n}`, pluralize(n, 'программа', 'программы', 'программ')],
    [range, 'проходной'],
    [g.minCost ? `от ${shortRub(g.minCost)}` : '—', 'платно в год'],
  ];
  if (state.showScores) stats.push([g.fits ? `<mark>${g.fits}</mark>` : '0', 'проходишь']);
  return `
  <li>
    <button type="button" class="unirow" data-uni="${esc(g.uniId)}">
      <span class="unirow__head">
        <span class="unirow__name" title="${esc(u.fullName ?? '')}">${esc(u.name)}</span>
        <span class="unirow__city">${esc(shortCity(u.cityName))}</span>
      </span>
      <span class="unirow__stats">${stats.map(([v, k]) => `<span class="unirow__stat"><b>${v}</b><small>${k}</small></span>`).join('')}</span>
      <span class="unirow__go">Программы ${icon('arrowRight')}</span>
    </button>
  </li>`;
}
