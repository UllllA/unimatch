import {
  buildIndex, computeResults, hasScoreFilter, normalizeText, pluralize, MIN_SUBJECTS, LOCKED_SUBJECT, SORT_OPTIONS,
} from './filters.js';
import { defaultState, readState, writeState } from './state.js';
import { AREAS, FORMS } from './catalog.js';
import { esc, mountSubjects, updateSubjects, renderCard, progKey, officialProgramUrl } from './render.js';
import { myTotal } from './filters.js';

const PAGE_SIZE = 24;
const OPTIONS_LIMIT = 200;
const $ = (id) => document.getElementById(id);
const el = {
  heroStats: $('heroStats'), demoBanner: $('demoBanner'),
  subjects: $('subjectsGrid'), subjectsHint: $('subjectsHint'), scoresToggle: $('scoresToggle'),
  resetSubjects: $('resetSubjects'),
  fbar: $('filterBar'), budget: $('budgetToggle'), fits: $('fitsToggle'), resetFilters: $('resetFilters'),
  q: $('q'), sort: $('sort'), summary: $('resultsSummary'),
  cards: $('cards'), more: $('moreBtn'), empty: $('emptyState'),
  pop: $('popover'), popTitle: $('popTitle'), popBody: $('popBody'), popClose: $('popClose'), popBackdrop: $('popBackdrop'),
  dataInfo: $('dataInfo'), premiumBtn: $('premiumBtn'), premium: $('premiumDialog'),
  premiumBuy: $('premiumBuy'), premiumThanks: $('premiumThanks'),
};

let index;
let state;
let results;
let shown = PAGE_SIZE;
let openPop = null; // { kind, btn }
const lists = {};

async function init() {
  try {
    // В однофайловой сборке (tools/build_single.py) данные встроены в страницу.
    const embedded = document.getElementById('unimatch-data');
    let data;
    if (embedded) {
      data = JSON.parse(embedded.textContent);
    } else {
      const res = await fetch('data/data.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    }
    index = buildIndex(data);
  } catch (err) {
    showFatal(err);
    return;
  }
  state = readState(index);
  index.byKey = new Map(index.programs.map((p) => [progKey(p), p]));
  state.favs = loadSet('unimatch:fav');
  state.cmp = loadSet('unimatch:cmp');
  setupStatic();
  bindEvents();
  update();
}

// ------------------------------------------------------------------ первичная отрисовка

function setupStatic() {
  const { counts, isDemo, generatedAt, source, years } = index.meta;
  el.heroStats.innerHTML = [
    ['🏛️', counts.universities, 'вуз', 'вуза', 'вузов'],
    ['📚', counts.programs, 'программа', 'программы', 'программ'],
    ['📍', counts.cities, 'регион', 'региона', 'регионов'],
  ]
    .map(([icon, n, ...forms]) => `<span><i aria-hidden="true">${icon}</i><b>${n.toLocaleString('ru')}</b> ${pluralize(n, ...forms)}</span>`)
    .join('');
  el.demoBanner.hidden = !isDemo;

  const date = generatedAt ? new Date(generatedAt).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const sourceHtml = isDemo
    ? 'Демо-набор (tools/make_demo.py)'
    : source === 'tabiturient.ru'
      ? '<a href="https://tabiturient.ru/" target="_blank" rel="noopener noreferrer">tabiturient.ru</a>'
      : esc(source);
  el.dataInfo.innerHTML = `
    <dt>Источник</dt><dd>${sourceHtml}</dd>
    <dt>Обновлено</dt><dd>${esc(date)}</dd>
    <dt>Год баллов</dt><dd>${esc(years.join(', ') || '—')}</dd>
    <dt>В базе</dt><dd>${counts.universities} вузов, ${counts.programs.toLocaleString('ru')} программ</dd>`;

  mountSubjects(el.subjects, index);

  const sorts = SORT_OPTIONS.filter(([v]) => v !== 'trend-desc' || years.length > 1);
  el.sort.innerHTML = sorts.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('');

  // Справочники для списков с поиском.
  const uniCount = new Map();
  const progCount = new Map();
  for (const u of index.unis.values()) uniCount.set(u.city, (uniCount.get(u.city) ?? 0) + 1);
  for (const p of index.programs) progCount.set(p.uni, (progCount.get(p.uni) ?? 0) + 1);
  lists.cities = [...index.cities.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((c) => ({ value: c.id, label: c.name, sub: `${uniCount.get(c.id) ?? 0} ${pluralize(uniCount.get(c.id) ?? 0, 'вуз', 'вуза', 'вузов')}` }));
  lists.unis = [...index.unis.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((u) => ({
      value: u.id, city: u.city, label: u.name,
      sub: [u.fullName !== u.name ? u.fullName : '', u.cityName].filter(Boolean).join(' · '),
      count: progCount.get(u.id) ?? 0,
    }));
}

// ------------------------------------------------------------------ события

function bindEvents() {
  el.subjects.addEventListener('click', (e) => {
    const btn = e.target.closest('.subject__toggle');
    if (!btn) return;
    const id = btn.closest('.subject').dataset.id;
    if (id === LOCKED_SUBJECT) return;
    state.subjects.has(id) ? state.subjects.delete(id) : state.subjects.add(id);
    update();
  });
  // Балл ЕГЭ — от 0 до 100: сразу правим поле, чтобы нельзя было ввести 150 или -5.
  el.subjects.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.dataset.score || input.value === '') return;
    const digits = input.value.replace(/\D/g, '').slice(0, 3);
    const fixed = digits === '' ? '' : String(Math.min(100, Number(digits)));
    if (fixed !== input.value) input.value = fixed;
  });
  el.subjects.addEventListener('keydown', (e) => {
    if (e.target.dataset.score && ['-', '+', 'e', 'E', ',', '.'].includes(e.key)) e.preventDefault();
  });
  el.subjects.addEventListener('input', debounce((e) => {
    const id = e.target.dataset.score;
    if (!id) return;
    const value = e.target.value === '' ? null : Math.round(Number(e.target.value));
    if (value == null || Number.isNaN(value)) delete state.myScores[id];
    else state.myScores[id] = Math.min(100, Math.max(0, value));
    update();
  }, 200));
  el.scoresToggle.addEventListener('change', () => {
    state.showScores = el.scoresToggle.checked;
    if (!state.showScores) state.fits = false;
    update();
    if (state.showScores) el.subjects.querySelector('.is-selected input')?.focus();
  });
  el.resetSubjects.addEventListener('click', () => {
    state.subjects = new Set([LOCKED_SUBJECT]);
    state.myScores = {};
    update();
  });

  el.fbar.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-pop]');
    if (pill) togglePop(pill.dataset.pop, pill);
  });
  el.budget.addEventListener('click', () => { state.budgetOnly = !state.budgetOnly; update(); });
  el.fits.addEventListener('click', () => { state.fits = !state.fits; update(); });
  el.resetFilters.addEventListener('click', resetFilters);
  el.q.addEventListener('input', debounce(() => { state.q = el.q.value.trim(); update(); }, 180));
  el.sort.addEventListener('change', () => { state.sort = el.sort.value; update(); });
  el.more.addEventListener('click', () => {
    const from = shown;
    shown += PAGE_SIZE;
    renderCards(from);
  });
  el.empty.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reset-filters"]')) resetFilters();
  });

  // Всплывающие окна фильтров
  el.popClose.addEventListener('click', () => closePop(true));
  el.popBackdrop.addEventListener('click', () => closePop(false));
  document.addEventListener('pointerdown', (e) => {
    if (openPop && !el.pop.contains(e.target) && !e.target.closest('[data-pop]') && !isSheet()) closePop(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openPop) closePop(true);
  });
  const reposition = () => openPop && positionPop();
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, { passive: true });

  // Избранное и сравнение
  const onCardAction = (e) => {
    const fav = e.target.closest('[data-fav]');
    const cmp = e.target.closest('[data-cmp]');
    if (fav) toggleIn(state.favs, fav.dataset.fav, 'unimatch:fav');
    if (cmp) {
      const key = cmp.dataset.cmp;
      if (!state.cmp.has(key) && state.cmp.size >= MAX_COMPARE) {
        showToast(`Сравнивать можно до ${MAX_COMPARE} программ, убери одну`);
        return;
      }
      toggleIn(state.cmp, key, 'unimatch:cmp');
    }
    if (fav || cmp) {
      syncCollections();
      if (fav && $('favDialog').open) renderFavorites();
    }
  };
  el.cards.addEventListener('click', onCardAction);
  $('favList').addEventListener('click', onCardAction);
  $('favBtn').addEventListener('click', () => { renderFavorites(); $('favDialog').showModal(); });
  $('cmpOpen').addEventListener('click', () => { renderCompare(); $('cmpDialog').showModal(); });
  $('cmpClear').addEventListener('click', () => { state.cmp.clear(); saveSet('unimatch:cmp', state.cmp); syncCollections(); });
  $('cmpTable').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    state.cmp.delete(rm.dataset.rm);
    saveSet('unimatch:cmp', state.cmp);
    syncCollections();
    if (state.cmp.size) renderCompare();
    else $('cmpDialog').close();
  });
  for (const d of [$('favDialog'), $('cmpDialog')]) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }

  el.premiumBtn.addEventListener('click', () => {
    el.premiumThanks.hidden = true;
    el.premium.showModal();
  });
  el.premium.addEventListener('click', (e) => {
    if (e.target === el.premium || e.target.closest('[data-close]')) el.premium.close();
  });
  el.premiumBuy.addEventListener('click', () => { el.premiumThanks.hidden = false; });
}

function resetFilters() {
  const fresh = defaultState();
  Object.assign(state, {
    city: fresh.city, uni: fresh.uni, dir: fresh.dir, forms: fresh.forms, levels: fresh.levels,
    min: fresh.min, max: fresh.max, budgetOnly: fresh.budgetOnly, fits: fresh.fits, q: fresh.q,
  });
  closePop(false);
  update();
}

// ------------------------------------------------------------------ всплывающие окна

const POP_TITLES = { city: 'Регион', uni: 'Вуз', dir: 'Направление', form: 'Форма и уровень', score: 'Проходной балл' };
const isSheet = () => matchMedia('(max-width: 720px)').matches;

function togglePop(kind, btn) {
  if (openPop?.kind === kind) {
    closePop(false);
    return;
  }
  closePop(false);
  openPop = { kind, btn };
  btn.setAttribute('aria-expanded', 'true');
  el.popTitle.textContent = POP_TITLES[kind];
  el.pop.hidden = false;
  el.pop.classList.toggle('popover--sheet', isSheet());
  el.popBackdrop.hidden = !isSheet();
  document.body.classList.toggle('pop-open', isSheet());
  renderPopBody();
  positionPop();
  (el.popBody.querySelector('input[type="search"]') ?? el.popBody.querySelector('button, input'))?.focus({ preventScroll: true });
}

function closePop(restoreFocus) {
  if (!openPop) return;
  const { btn } = openPop;
  openPop = null;
  btn.setAttribute('aria-expanded', 'false');
  el.pop.hidden = true;
  el.popBackdrop.hidden = true;
  document.body.classList.remove('pop-open');
  if (restoreFocus) btn.focus({ preventScroll: true });
}

function positionPop() {
  const sheet = isSheet();
  el.pop.classList.toggle('popover--sheet', sheet);
  el.popBackdrop.hidden = !sheet;
  if (sheet) {
    el.pop.style.cssText = '';
    return;
  }
  const r = openPop.btn.getBoundingClientRect();
  const width = Math.min(openPop.kind === 'uni' || openPop.kind === 'dir' ? 440 : 360, innerWidth - 32);
  const left = Math.min(Math.max(16, r.left), innerWidth - width - 16);
  const top = r.bottom + 8;
  el.pop.style.cssText = `left:${left}px; top:${top}px; width:${width}px; max-height:${Math.max(260, innerHeight - top - 16)}px`;
}

function renderPopBody() {
  const { kind } = openPop;
  if (kind === 'city' || kind === 'uni' || kind === 'dir') {
    const placeholder = { city: 'Найти регион…', uni: 'Найти вуз: МИРЭА, МГУ, ВШЭ…', dir: 'Найти направление или код…' }[kind];
    el.popBody.innerHTML = `
      <div class="pop-search"><span aria-hidden="true">🔍</span><input type="search" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off"></div>
      <ul class="options" role="listbox" aria-label="${POP_TITLES[kind]}"></ul>`;
    const input = el.popBody.querySelector('input');
    const list = el.popBody.querySelector('.options');
    fillOptions(list, '');
    input.addEventListener('input', () => fillOptions(list, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('.option')?.focus(); }
      if (e.key === 'Enter') { e.preventDefault(); list.querySelector('.option')?.click(); }
    });
    list.addEventListener('keydown', (e) => {
      const opts = [...list.querySelectorAll('.option')];
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(i + 1, opts.length - 1)]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? input : opts[i - 1]).focus(); }
    });
    list.addEventListener('click', (e) => {
      const opt = e.target.closest('.option');
      if (opt) chooseOption(opt.dataset.value);
    });
  } else if (kind === 'form') {
    const forms = FORMS.filter((f) => index.programs.some((p) => p.form === f));
    const levels = [...new Set(index.programs.map((p) => p.level).filter(Boolean))].sort();
    el.popBody.innerHTML = `
      <p class="pop-label">Форма обучения</p>
      <div class="chips">${forms.map((f) => chip('form', f, state.forms.has(f))).join('')}</div>
      <p class="pop-label">Уровень</p>
      <div class="chips">${levels.map((l) => chip('level', l, state.levels.has(l))).join('')}</div>
      <button type="button" class="btn btn--primary btn--block pop-done">Готово</button>`;
    el.popBody.querySelectorAll('[data-form], [data-level]').forEach((b) => b.addEventListener('click', () => {
      const [set, value] = b.dataset.form ? [state.forms, b.dataset.form] : [state.levels, b.dataset.level];
      set.has(value) ? set.delete(value) : set.add(value);
      b.setAttribute('aria-pressed', String(set.has(value)));
      update();
    }));
    el.popBody.querySelector('.pop-done').addEventListener('click', () => closePop(true));
  } else if (kind === 'score') {
    const { min, max } = index.scoreBounds;
    el.popBody.innerHTML = `
      <p class="range-value" id="scoreLabel"></p>
      <div class="range" id="rangeTrack">
        <input type="range" id="fMin" min="${min}" max="${max}" step="5" aria-label="Проходной балл, от">
        <input type="range" id="fMax" min="${min}" max="${max}" step="5" aria-label="Проходной балл, до">
      </div>
      <div class="range-scale"><span>${min}</span><span>${max}</span></div>
      <p class="pop-label">Быстрый выбор</p>
      <div class="chips">
        ${[[null, null, 'Любой'], [null, 200, 'до 200'], [200, 250, '200–250'], [250, 300, '250–300'], [300, null, 'от 300']]
          .map(([a, b, label]) => `<button type="button" class="chip" data-range="${a ?? ''}-${b ?? ''}">${label}</button>`).join('')}
      </div>
      <p class="pop-hint">При выборе диапазона скрываются программы без проходного балла.</p>
      <button type="button" class="btn btn--primary btn--block pop-done">Готово</button>`;
    const lo = $('fMin');
    const hi = $('fMax');
    lo.value = state.min ?? min;
    hi.value = state.max ?? max;
    const onRange = (changed) => {
      let a = Number(lo.value);
      let b = Number(hi.value);
      if (a > b) changed === 'min' ? (b = a) : (a = b);
      lo.value = a;
      hi.value = b;
      state.min = a <= min ? null : a;
      state.max = b >= max ? null : b;
      syncRange();
      debouncedUpdate();
    };
    lo.addEventListener('input', () => onRange('min'));
    hi.addEventListener('input', () => onRange('max'));
    el.popBody.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
      const [a, c] = b.dataset.range.split('-');
      lo.value = a === '' ? min : Math.max(min, Number(a));
      hi.value = c === '' ? max : Math.min(max, Number(c));
      onRange('min');
    }));
    el.popBody.querySelector('.pop-done').addEventListener('click', () => closePop(true));
    syncRange();
  }
}

const chip = (kind, value, on) =>
  `<button type="button" class="chip" data-${kind}="${esc(value)}" aria-pressed="${on}">${esc(value)}</button>`;

function syncRange() {
  const lo = $('fMin');
  const hi = $('fMax');
  if (!lo) return;
  const { min, max } = index.scoreBounds;
  const a = Number(lo.value);
  const b = Number(hi.value);
  const pct = (v) => ((v - min) / (max - min || 1)) * 100;
  const track = $('rangeTrack');
  track.style.setProperty('--from', `${pct(a)}%`);
  track.style.setProperty('--to', `${pct(b)}%`);
  lo.style.zIndex = a > (min + max) / 2 ? '2' : '';
  $('scoreLabel').textContent = a <= min && b >= max ? 'Любой балл' : `от ${a} до ${b}`;
  const current = `${a <= min ? '' : a}-${b >= max ? '' : b}`;
  el.popBody.querySelectorAll('[data-range]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.range === current)));
}

function optionsFor(kind, query) {
  if (kind === 'city') return lists.cities;
  if (kind === 'uni') {
    // Без запроса — вузы выбранного региона; с запросом ищем по всей стране.
    return state.city && !query ? lists.unis.filter((u) => u.city === state.city) : lists.unis;
  }
  const dirs = new Map();
  for (const p of index.programs) {
    if ((state.city && p.cityId !== state.city) || (state.uni && p.uni !== state.uni)) continue;
    const d = dirs.get(p.dirKey);
    if (d) d.count += 1;
    else dirs.set(p.dirKey, { value: p.dirKey, label: p.name, code: p.code, sub: [p.code, AREAS[p.area]].filter(Boolean).join(' · '), count: 1 });
  }
  return [...dirs.values()].sort((a, b) => (a.code || '99').localeCompare(b.code || '99') || a.label.localeCompare(b.label, 'ru'));
}

function fillOptions(list, query) {
  const { kind } = openPop;
  const words = normalizeText(query).split(' ').filter(Boolean);
  const all = optionsFor(kind, words.length > 0);
  const found = words.length
    ? all.filter((o) => {
        const hay = o.hay ?? (o.hay = normalizeText(`${o.label} ${o.sub ?? ''}`));
        return words.every((w) => hay.includes(w));
      })
    : all;
  const current = String(state[kind] ?? '');
  const anyLabel = { city: 'Все регионы', uni: state.city ? 'Все вузы региона' : 'Все вузы', dir: 'Все направления' }[kind];
  const rows = [];
  if (!words.length) {
    rows.push(`<li><button type="button" class="option${current === '' ? ' is-selected' : ''}" data-value="" role="option" aria-selected="${current === ''}">
      <span class="option__main">${anyLabel}</span><span class="option__count">${all.length}</span></button></li>`);
  }
  for (const o of found.slice(0, OPTIONS_LIMIT)) {
    const sel = String(o.value) === current;
    const count = o.count != null ? `<span class="option__count">${o.count}</span>` : '';
    rows.push(`<li><button type="button" class="option${sel ? ' is-selected' : ''}" data-value="${esc(o.value)}" role="option" aria-selected="${sel}">
      <span class="option__main">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>${count}</button></li>`);
  }
  if (!found.length) rows.push('<li class="options__empty">Ничего не нашлось. Попробуй по-другому, например «мирэа» или «казань».</li>');
  if (found.length > OPTIONS_LIMIT) rows.push(`<li class="options__empty">Показаны первые ${OPTIONS_LIMIT} из ${found.length}, уточни поиск</li>`);
  list.innerHTML = rows.join('');
}

function chooseOption(value) {
  const { kind } = openPop;
  if (kind === 'city') {
    state.city = value ? Number(value) : null;
    if (state.uni && state.city && index.unis.get(state.uni)?.city !== state.city) state.uni = null;
  } else if (kind === 'uni') {
    state.uni = value ? Number(value) : null;
    if (state.uni) state.city = index.unis.get(state.uni)?.city ?? state.city;
  } else {
    state.dir = value;
  }
  closePop(true);
  update();
}

// ------------------------------------------------------------------ обновление

function update() {
  if (state.sort === 'margin-desc' && !state.showScores) state.sort = 'score-desc';
  if (state.dir && state.uni && !index.programs.some((p) => p.uni === state.uni && p.dirKey === state.dir)) state.dir = '';
  results = computeResults(index, state);
  shown = PAGE_SIZE;
  syncControls();
  updateSubjects(el.subjects, state, results.unlock);
  renderSubjectsHint();
  renderSummary();
  renderCards(0);
  writeState(state, index);
  syncCollections();
}

function setPill(kind, value) {
  const pill = el.fbar.querySelector(`[data-pop="${kind}"]`);
  pill.classList.toggle('is-active', Boolean(value));
  pill.querySelector('.fpill__label').textContent = value || POP_TITLES[kind];
  pill.title = value ? `${POP_TITLES[kind]}: ${value}` : '';
}

function syncControls() {
  setPill('city', state.city ? index.cities.get(state.city)?.name : '');
  setPill('uni', state.uni ? index.unis.get(state.uni)?.name : '');
  setPill('dir', state.dir ? index.programs.find((p) => p.dirKey === state.dir)?.name : '');
  setPill('form', [...state.forms, ...state.levels].join(', '));
  setPill('score', hasScoreFilter(state, index.scoreBounds)
    ? `${state.min ?? index.scoreBounds.min}–${state.max ?? index.scoreBounds.max}` : '');
  el.budget.setAttribute('aria-pressed', String(state.budgetOnly));
  el.fits.hidden = !state.showScores;
  el.fits.setAttribute('aria-pressed', String(state.fits));
  el.resetFilters.hidden = !hasActiveFilters();
  el.scoresToggle.checked = state.showScores;
  if (el.q.value.trim() !== state.q) el.q.value = state.q;
  const marginOpt = el.sort.querySelector('[value="margin-desc"]');
  if (marginOpt) marginOpt.disabled = !state.showScores;
  el.sort.value = state.sort;
}

function hasActiveFilters() {
  return Boolean(state.city || state.uni || state.dir || state.forms.size || state.levels.size || state.q
    || state.budgetOnly || state.fits || hasScoreFilter(state, index.scoreBounds));
}

function renderSubjectsHint() {
  const n = state.subjects.size;
  const left = MIN_SUBJECTS - n;
  el.subjectsHint.innerHTML = left > 0
    ? `Выбрано <b>${n}</b>. Добавь ещё ${left} ${pluralize(left, 'предмет', 'предмета', 'предметов')}: нужно минимум ${MIN_SUBJECTS}, считая русский.`
    : `Выбрано <b>${n}</b> ${pluralize(n, 'предмет', 'предмета', 'предметов')}. Зелёное «+N» — сколько ещё программ откроет предмет.`;
}

function renderSummary() {
  if (!results.ready) {
    el.summary.textContent = 'Выбери предметы, чтобы увидеть направления';
    return;
  }
  const n = results.items.length;
  const unis = new Set(results.items.map((i) => i.p.uni)).size;
  el.summary.innerHTML = n
    ? `Нашли <b>${n.toLocaleString('ru')}</b> ${pluralize(n, 'программу', 'программы', 'программ')} в <b>${unis}</b> ${pluralize(unis, 'вузе', 'вузах', 'вузах')}`
    : 'Ничего не нашлось';
}

function renderCards(from) {
  if (!results.ready) {
    el.cards.innerHTML = '';
    el.more.hidden = true;
    const left = MIN_SUBJECTS - state.subjects.size;
    el.empty.hidden = false;
    el.empty.innerHTML = `
      <div class="empty__icon" aria-hidden="true">👆</div>
      <p class="empty__title">Отметь ещё ${left} ${pluralize(left, 'предмет', 'предмета', 'предметов')}</p>
      <p>Русский язык уже учтён, он нужен везде. Зелёные цифры на предметах подскажут, какой выбор откроет больше программ.</p>`;
    return;
  }
  if (!results.items.length) {
    el.cards.innerHTML = '';
    el.more.hidden = true;
    el.empty.hidden = false;
    const filtered = hasActiveFilters();
    el.empty.innerHTML = `
      <div class="empty__icon" aria-hidden="true">🔍</div>
      <p class="empty__title">Подходящих программ нет</p>
      <p>${filtered ? 'Попробуй ослабить фильтры или поменять набор предметов.' : 'С этим набором предметов ничего не нашлось. Попробуй добавить предмет с зелёной цифрой.'}</p>
      ${filtered ? '<button type="button" class="btn btn--primary" data-action="reset-filters">Сбросить фильтры</button>' : ''}`;
    return;
  }
  el.empty.hidden = true;
  const html = results.items.slice(from, shown).map((item) => renderCard(item, index, state)).join('');
  if (from === 0) el.cards.innerHTML = html;
  else el.cards.insertAdjacentHTML('beforeend', html);
  const rest = results.items.length - shown;
  el.more.hidden = rest <= 0;
  el.more.textContent = `Показать ещё ${Math.min(rest, PAGE_SIZE)} · осталось ${rest.toLocaleString('ru')}`;
}

function showFatal(err) {
  console.error(err);
  const fileMode = location.protocol === 'file:';
  el.empty.hidden = false;
  el.summary.textContent = 'Данные не загрузились';
  el.empty.innerHTML = `
    <div class="empty__icon" aria-hidden="true">⚠️</div>
    <p class="empty__title">Не удалось загрузить data/data.json</p>
    <p>${fileMode
      ? 'Страница открыта как файл, а браузер не даёт так читать JSON. Запустите <code>start.bat</code> или откройте dist/unimatch.html.'
      : `Проверьте, что файл data/data.json опубликован рядом с index.html. (${esc(err.message)})`}</p>`;
}

// ------------------------------------------------------------------ избранное и сравнение

const MAX_COMPARE = 4;

function loadSet(key) {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((k) => index.byKey.has(k)) : []);
  } catch {
    return new Set();
  }
}

function saveSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // приватный режим: просто не сохраняем между визитами
  }
}

function toggleIn(set, key, storageKey) {
  set.has(key) ? set.delete(key) : set.add(key);
  saveSet(storageKey, set);
}

/** Обновляет счётчики, панель сравнения и кнопки на уже нарисованных карточках. */
function syncCollections() {
  $('favCount').textContent = state.favs.size;
  $('favCount').hidden = !state.favs.size;
  const n = state.cmp.size;
  $('cmpBar').hidden = n === 0;
  document.body.classList.toggle('has-cmpbar', n > 0);
  $('cmpText').innerHTML = `⚖ В сравнении <b>${n}</b> из ${MAX_COMPARE}` + (n < 2 ? ' · добавь ещё одну' : '');
  $('cmpOpen').disabled = n < 2;
  document.querySelectorAll('[data-fav]').forEach((b) => {
    const on = state.favs.has(b.dataset.fav);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '♥ В избранном' : '♡ В избранное';
  });
  document.querySelectorAll('[data-cmp]').forEach((b) => {
    const on = state.cmp.has(b.dataset.cmp);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '⚖ В сравнении' : '⚖ Сравнить';
  });
}

function itemFor(p) {
  const mine = state.showScores ? myTotal(p, state.subjects, state.myScores) : null;
  return { p, mine, margin: mine != null && p.score != null ? mine - p.score : null };
}

function renderFavorites() {
  const items = [...state.favs].map((k) => index.byKey.get(k)).filter(Boolean).map(itemFor);
  $('favList').innerHTML = items.length
    ? items.map((item) => renderCard(item, index, state)).join('')
    : '<li class="empty"><div class="empty__icon">♡</div><p class="empty__title">Здесь пока пусто</p><p>Нажми «♡ В избранное» на карточке программы, чтобы сохранить её. Список хранится в этом браузере.</p></li>';
}

function examText(p) {
  const name = (id) => index.subjects.get(id)?.short ?? id;
  const parts = p.req.map(name);
  for (const g of p.choice) parts.push(g.length > 4 ? 'иностранный' : g.map(name).join(' / '));
  return parts.join(', ') + (p.extra.length ? ' + экзамен вуза' : '');
}

function renderCompare() {
  const items = [...state.cmp].map((k) => index.byKey.get(k)).filter(Boolean).map(itemFor);
  const best = Math.min(...items.map((i) => i.p.score ?? Infinity));
  const rows = [
    ['Вуз', (i) => `<b>${esc(i.p.uniObj?.name)}</b><small>${esc(i.p.uniObj?.cityName ?? '')}</small>`],
    ['Направление', (i) => `<b>${esc(i.p.name)}</b><small>${esc([i.p.code, i.p.profile].filter(Boolean).join(' · '))}</small>`],
    ['Проходной балл', (i) => (i.p.score == null
      ? `<span class="muted">${esc(i.p.note ?? 'нет данных')}</span>`
      : `<span class="cmp-score${i.p.score === best && items.length > 1 ? ' is-best' : ''}">${i.p.score}</span><small>${i.p.year}${i.p.dvi ? ' · с экзаменом вуза' : ''}</small>`)],
  ];
  if (state.showScores) {
    rows.push(['Мои шансы', (i) => (i.margin == null ? '<span class="muted">введи баллы</span>'
      : `<span class="mine mine--${i.margin >= 10 ? 'good' : i.margin >= 0 ? 'edge' : 'bad'}">${i.margin >= 0 ? `запас +${i.margin}` : `не хватает ${-i.margin}`}</span>`)]);
  }
  rows.push(
    ['Экзамены', (i) => esc(examText(i.p))],
    ['Форма и уровень', (i) => esc(`${i.p.form}, ${i.p.level || '—'}`)],
    ['Факультет', (i) => esc(i.p.faculty || '—')],
    ['', (i) => `<a class="card__link" href="${esc(officialProgramUrl(i.p, i.p.uniObj))}" target="_blank" rel="noopener noreferrer">Сайт вуза ↗</a>
      <button type="button" class="card__act" data-rm="${esc(progKey(i.p))}">✕ Убрать</button>`],
  );
  $('cmpTable').innerHTML = `<table class="cmp"><tbody>${rows.map(([label, cell]) =>
    `<tr><th scope="row">${label}</th>${items.map((i) => `<td>${cell(i)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="pop-hint">Зелёным отмечен самый низкий проходной: туда поступить проще всего.</p>`;
}

let toastTimer;
function showToast(text) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

const debouncedUpdate = debounce(() => update(), 120);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Запуск в конце файла: все константы выше уже объявлены (важно для однофайловой сборки).
init();
