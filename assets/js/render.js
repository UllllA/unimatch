// HTML-шаблоны. Все строки из данных проходят через esc(): данные парсятся со стороннего сайта.
import { pluralize, effectiveSubjects, LOCKED_SUBJECTS } from './filters.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);

const LANGS = ['eng', 'ger', 'fra', 'spa', 'chi'];

export function mountSubjects(container, index) {
  container.innerHTML = index.subjectList
    .map((s) => {
      const locked = LOCKED_SUBJECTS.includes(s.id);
      const isMath = s.id === 'math';
      return `
    <div class="subject${locked ? ' is-locked' : ''}" data-id="${esc(s.id)}">
      <button type="button" class="subject__toggle" aria-pressed="false" title="${esc(isMath ? 'Математика' : s.name)}"
        ${locked ? 'aria-disabled="true"' : ''}>
        <span class="subject__icon" aria-hidden="true">${esc(s.icon)}</span>
        <span class="subject__text">
          <span class="subject__name">${esc(s.short)}</span>
          ${locked ? '<span class="subject__note">обязательный</span>' : ''}
        </span>
        ${!locked || isMath ? '<span class="subject__badge"></span>' : ''}
      </button>
      ${isMath ? `<div class="seg" role="group" aria-label="Уровень математики">
        <button type="button" class="seg__btn" data-math="profile" aria-pressed="true">Профиль</button>
        <button type="button" class="seg__btn" data-math="base" aria-pressed="false">База</button>
      </div>` : ''}
      <label class="subject__score">
        <span class="sr-only">Мой балл ЕГЭ: ${esc(s.name)}</span>
        <input type="number" inputmode="numeric" min="0" max="100" step="1" placeholder="балл" data-score="${esc(s.id)}">
      </label>
    </div>`;
    })
    .join('');
}

export function updateSubjects(container, state, unlock) {
  for (const el of container.querySelectorAll('.subject')) {
    const id = el.dataset.id;
    const on = state.subjects.has(id);
    const base = id === 'math' && state.mathBase;
    el.classList.toggle('is-selected', on);
    el.classList.toggle('is-base', base);
    el.classList.toggle('has-score', on && state.showScores && !base);
    el.querySelector('.subject__toggle').setAttribute('aria-pressed', String(on));
    el.querySelectorAll('[data-math]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.math === 'base') === state.mathBase)));
    const note = el.querySelector('.subject__note');
    if (note && id === 'math') note.textContent = base ? 'база · вузы не учитывают' : 'профильная';
    const badge = el.querySelector('.subject__badge');
    if (badge) {
      // У математики «+N» показывает, сколько программ откроет профильный уровень вместо базы.
      const n = base ? unlock.get(id) ?? 0 : on ? 0 : unlock.get(id) ?? 0;
      badge.textContent = n ? `+${n}` : '';
      badge.title = n ? `${base ? 'С профильной откроет' : 'Добавит'} ${n} ${pluralize(n, 'программу', 'программы', 'программ')}` : '';
    }
    const input = el.querySelector('input');
    input.tabIndex = on && state.showScores && !base ? 0 : -1;
    if (document.activeElement !== input) input.value = state.myScores[id] ?? '';
  }
}

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
    options.push({ label: mine.length ? `Иностранный (${mine.join(', ')})` : 'Иностранный язык', ok: mine.length > 0 });
  }
  return options;
}

function renderExams(p, index, selected) {
  const parts = p.req.map((id) => {
    const ok = selected.has(id);
    return `<li class="exam${ok ? ' is-ok' : ''}">${esc(index.subjects.get(id)?.short ?? id)}</li>`;
  });
  for (const group of p.choice) {
    const options = choiceOptions(group, index, selected);
    const ok = options.some((o) => o.ok);
    const text = options.map((o) => (o.ok ? `<b>${esc(o.label)}</b>` : esc(o.label))).join('<span class="exam__sep"> / </span>');
    const hint = options.length > 1 ? '<span class="exam__or">один из</span> ' : '';
    parts.push(`<li class="exam exam--choice${ok ? ' is-ok' : ''}">${hint}${text}</li>`);
  }
  for (const extra of p.extra) parts.push(`<li class="exam exam--extra" title="Вступительное испытание вуза">+ ${esc(extra)}</li>`);
  return `<ul class="exams" aria-label="Вступительные экзамены">${parts.join('')}</ul>`;
}

const AVATAR_COLORS = ['#6c4cf1', '#ff7a59', '#12a26b', '#2f80ed', '#e0457b', '#f2994a', '#0fa3b1', '#9b51e0'];

/** Инициалы вуза для кружка: «МГУ им. Ломоносова» -> «МГУ», «Казанский ГМУ» -> «КГ». */
export function uniInitials(name) {
  const first = String(name || '?').split(/[\s«"(]+/).filter(Boolean)[0] ?? '?';
  if (/^[A-ZА-ЯЁ]{2,}/.test(first)) {
    const clean = first.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
    return clean.length <= 5 ? clean : clean.replace(/[^A-ZА-ЯЁ]/g, '').slice(0, 4);
  }
  const words = String(name).split(/\s+/).filter((w) => /^[A-Za-zА-Яа-яЁё]/.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export function avatarColor(id) {
  return AVATAR_COLORS[Math.abs(Number(id) || 0) % AVATAR_COLORS.length];
}

function renderScore(p, item, state) {
  if (p.score == null) {
    return `<div class="score score--none"><span class="score__value">—</span><span class="score__label">${esc(p.note ? 'нет бюджета' : 'нет данных')}</span></div>`;
  }
  const years = Object.keys(p.scores).sort();
  const history = years.map((y) => `${y}: ${p.scores[y]}`).join(' · ');
  let chance = '';
  if (state.showScores && item.margin != null) {
    chance = item.margin >= 10 ? ' score--good' : item.margin >= 0 ? ' score--edge' : ' score--bad';
  }
  return `
    <div class="score${chance}" title="${esc(history)}">
      <span class="score__value">${p.score}</span>
      <span class="score__label">проходной ${esc(p.year)}</span>
    </div>`;
}

function renderMine(item, state) {
  if (!state.showScores) return '';
  if (item.mine == null) return `<span class="mine mine--none">Введи баллы по нужным предметам</span>`;
  if (item.margin == null) return `<span class="mine mine--none">Твоя сумма: ${item.mine}</span>`;
  const m = item.margin;
  const [cls, text] =
    m >= 10 ? ['good', `🟢 Высокие шансы · запас +${m}`] : m >= 0 ? ['edge', `🟡 На грани · +${m}`] : ['bad', `🔴 Не хватает ${Math.abs(m)}`];
  return `<span class="mine mine--${cls}">${text} <small>(твои ${item.mine})</small></span>`;
}

/** Стабильный ключ программы (не меняется при пересборке данных) — для избранного и сравнения. */
export const progKey = (p) => `${p.pid ?? p.id}-${p.form}`;

const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? u : '');

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

const rub = (n) => `${Math.round(n).toLocaleString('ru')} ₽`;

export function renderCard(item, index, state) {
  const { p } = item;
  const uni = p.uniObj ?? { id: 0, name: '—', fullName: '' };
  const site = safeUrl(uni.site);
  const tabUrl = p.pid ? `https://tabiturient.ru/program/n/?${encodeURIComponent(p.pid)}` : safeUrl(uni.url);
  const searchUrl = officialProgramUrl(p, uni);
  const key = progKey(p);
  const fav = Boolean(state.favs?.has(key));
  const cmp = Boolean(state.cmp?.has(key));
  const tags = [
    p.code && `<span class="tag tag--code">${esc(p.code)}</span>`,
    p.level && `<span class="tag">${esc(p.level)}</span>`,
    `<span class="tag">${esc(p.form)}</span>`,
    p.dvi && '<span class="tag tag--info" title="Проходной балл включает внутренний экзамен вуза">с экзаменом вуза</span>',
    p.maxScore && p.maxScore !== 300 && !p.dvi && `<span class="tag tag--info">сумма из ${p.maxScore}</span>`,
    p.note && `<span class="tag tag--note">${esc(p.note)}</span>`,
  ].filter(Boolean).join('');
  return `
  <li class="card">
    <div class="card__top">
      <span class="avatar" style="--av:${avatarColor(uni.id)}" aria-hidden="true">${esc(uniInitials(uni.name))}</span>
      <div class="card__uni">
        <span class="card__uni-name" title="${esc(uni.fullName)}">${esc(uni.name)}</span>
        ${uni.cityName ? `<span class="card__city" title="${esc(uni.cityName)}">${esc(uni.cityName.split(' и ')[0])}</span>` : ''}
      </div>
      ${renderScore(p, item, state)}
    </div>
    <h3 class="card__title">${esc(p.name)}</h3>
    ${p.profile ? `<p class="card__profile" title="${esc(p.profile)}">${esc(p.profile)}</p>` : ''}
    <div class="card__tags">${tags}</div>
    ${renderExams(p, index, effectiveSubjects(state))}
    <div class="card__money">
      ${p.cost ? `<span class="cost" title="Стоимость платного обучения за год">💰 Платно: <b>${rub(p.cost)}</b> в год</span>`
        : '<span class="cost cost--none">💰 Цена платного: нет данных</span>'}
    </div>
    ${p.faculty || state.showScores ? `<div class="card__foot">
      ${p.faculty ? `<span class="card__faculty" title="${esc(p.faculty)}">${esc(p.faculty)}</span>` : ''}
      ${renderMine(item, state)}
    </div>` : ''}
    <div class="card__links">
      ${site ? `<a class="card__link card__link--main" href="${esc(site)}" target="_blank" rel="noopener noreferrer">🌐 Сайт вуза ↗</a>` : ''}
      <a class="card__link card__link--search" href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer"
        title="Найти страницу этой программы на ${site ? 'официальном сайте вуза' : 'сайте вуза'} через Яндекс">🔍 Найти программу</a>
      ${tabUrl ? `<a class="card__link" href="${esc(tabUrl)}" target="_blank" rel="noopener noreferrer" title="Страница программы на Табитуриенте">📊</a>` : ''}
      <span class="card__acts">
        <button type="button" class="card__act${fav ? ' is-on' : ''}" data-fav="${esc(key)}" aria-pressed="${fav}" title="${fav ? 'Убрать из избранного' : 'В избранное'}" aria-label="Избранное">${fav ? '♥' : '♡'}</button>
        <button type="button" class="card__act${cmp ? ' is-on' : ''}" data-cmp="${esc(key)}" aria-pressed="${cmp}" title="Сравнение">${cmp ? '⚖ В сравнении' : '⚖ Сравнить'}</button>
      </span>
    </div>
  </li>`;
}
