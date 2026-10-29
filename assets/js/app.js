import {
  buildIndex, computeResults, groupByUni, hasMyScores, hasScoreFilter, normalizeText, pluralize, effectiveSubjects, myTotal, marginFor,
  MIN_SUBJECTS, LOCKED_SUBJECTS, LANGS, SORT_OPTIONS, SORT_SHORT,
} from './filters.js';
import { defaultState, readState, writeState } from './state.js';
import { AREAS, FORMS, REGION_ALIASES } from './catalog.js';
import {
  esc, icon, mountSubjects, updateSubjects, langId, renderCard, renderUniRow, progKey, officialProgramUrl,
} from './render.js';
import { askAssistant, applyPlan, areasLabel } from './assistant.js';

const PAGE_SIZE = 24;
const OPTIONS_LIMIT = 200;
const HINT_AT = 6; // после какой карточки показать подсказку про ИИ-помощника (только когда введены баллы)
const MAX_COMPARE = 4;
const STORE = {
  fav: 'unimatch:fav', cmp: 'unimatch:cmp', last: 'unimatch:last', theme: 'unimatch:theme', hintOff: 'unimatch:hint-off',
};
const $ = (id) => document.getElementById(id);
const el = {
  heroStats: $('heroStats'), demoBanner: $('demoBanner'), stepper: $('stepper'),
  subjects: $('subjectsGrid'), subjectsHint: $('subjectsHint'), resetSubjects: $('resetSubjects'),
  fbar: $('filterBar'), budget: $('budgetToggle'), fits: $('fitsToggle'), resetFilters: $('resetFilters'),
  q: $('q'), sort: $('sort'), summary: $('resultsSummary'), views: $('viewSwitch'), share: $('shareBtn'),
  results: $('results'), list: $('cards'), pager: $('pager'), empty: $('emptyState'), theme: $('themeToggle'),
  pop: $('popover'), popTitle: $('popTitle'), popBody: $('popBody'), popClose: $('popClose'), popBackdrop: $('popBackdrop'),
  sheet: $('filterSheet'), sheetBackdrop: $('fsheetBackdrop'), mFilters: $('mFilters'), mCount: $('mFiltersCount'),
  mChips: $('mChips'), mBudget: $('mBudget'), mFits: $('mFits'), mShow: $('mShow'),
  dataInfo: $('dataInfo'), premiumBtn: $('premiumBtn'), premium: $('premiumDialog'),
  premiumBuy: $('premiumBuy'), premiumThanks: $('premiumThanks'),
  ask: $('askForm'), askInput: $('askInput'), askReply: $('askReply'),
};

let index;
let state;
let results;
let page = 1;
let openPop = null; // { kind, btn }
const lists = {};

async function init() {
  mountIcons();
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
  index.byKey = new Map(index.programs.map((p) => [progKey(p), p]));
  // Ссылка с подборкой важнее: прошлый выбор подставляем, только если адрес пустой.
  state = readState(index, location.search || load(STORE.last) || '');
  state.favs = loadSet(STORE.fav);
  state.cmp = loadSet(STORE.cmp);
  setupStatic();
  bindEvents();
  update();
}

/** <i data-icon="search"></i> в разметке -> svg из общего набора иконок. */
function mountIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((i) => { i.outerHTML = icon(i.dataset.icon); });
}

// ------------------------------------------------------------------ первичная отрисовка

function setupStatic() {
  const { counts, isDemo, generatedAt, source, years } = index.meta;
  el.heroStats.innerHTML = [
    [counts.universities, 'вуз', 'вуза', 'вузов'],
    [counts.programs, 'программа', 'программы', 'программ'],
    [counts.cities, 'регион', 'региона', 'регионов'],
  ]
    .map(([n, ...forms]) => `<b>${n.toLocaleString('ru')}</b> ${pluralize(n, ...forms)}`)
    .concat(years.length ? [`баллы ${years.join(', ')} года`] : [])
    .join(' · ');
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
    .map((c) => ({
      value: c.id, label: c.name, sub: `${uniCount.get(c.id) ?? 0} ${pluralize(uniCount.get(c.id) ?? 0, 'вуз', 'вуза', 'вузов')}`,
      hay: normalizeText(`${c.name} ${REGION_ALIASES[c.name] ?? ''}`),
    }));
  lists.unis = [...index.unis.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((u) => ({
      value: u.id, city: u.city, label: u.name,
      sub: [u.fullName !== u.name ? u.fullName : '', u.cityName].filter(Boolean).join(' · '),
      count: progCount.get(u.id) ?? 0,
      hay: normalizeText(`${u.name} ${u.fullName} ${u.cityName} ${REGION_ALIASES[u.cityName] ?? ''}`),
    }));
}

// ------------------------------------------------------------------ события

function bindEvents() {
  bindSubjects();
  bindAssistant();

  el.stepper.addEventListener('click', (e) => {
    const step = e.target.closest('[data-goto]');
    if (!step) return;
    if (step.dataset.goto === 'subjects') el.subjects.closest('.panel').scrollIntoView({ block: 'start' });
    if (step.dataset.goto === 'results') el.results.scrollIntoView({ block: 'start' });
    if (step.dataset.goto === 'scores') {
      // Первое пустое поле балла у отмеченного предмета, иначе первое поле вообще.
      const inputs = [...el.subjects.querySelectorAll('.is-selected .subject__score:not([hidden])')];
      const target = inputs.find((i) => !i.value) ?? inputs[0];
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    }
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
  el.views.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn || btn.dataset.view === state.view) return;
    state.view = btn.dataset.view;
    update();
  });
  el.share.addEventListener('click', shareSelection);

  // Телефон: все фильтры в шторке снизу, включённые — плашками под поиском
  el.mFilters.addEventListener('click', openSheet);
  $('fsheetClose').addEventListener('click', closeSheet);
  el.sheetBackdrop.addEventListener('click', closeSheet);
  el.sheet.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pop]');
    if (row) togglePop(row.dataset.pop, row);
  });
  el.mBudget.addEventListener('click', () => { state.budgetOnly = !state.budgetOnly; update(); });
  el.mFits.addEventListener('click', () => { state.fits = !state.fits; update(); });
  $('mReset').addEventListener('click', resetFilters);
  el.mShow.addEventListener('click', () => {
    closeSheet();
    el.results.scrollIntoView({ block: 'start' });
  });
  el.mChips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-clear]');
    if (!chip) return;
    const kind = chip.dataset.clear;
    if (kind === 'form') { state.forms.clear(); state.levels.clear(); }
    else if (kind === 'score') { state.min = null; state.max = null; }
    else if (kind === 'budget') state.budgetOnly = false;
    else if (kind === 'fits') state.fits = false;
    else if (kind === 'dir') { state.dir = ''; state.areas.clear(); }
    else state[kind] = null;
    update();
  });

  el.pager.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    page = Number(btn.dataset.page);
    renderList();
    el.results.scrollIntoView({ block: 'start' });
    // Кнопка страницы перерисовалась, фокус улетел бы в начало документа: ставим его на результаты.
    el.results.focus({ preventScroll: true });
  });
  el.list.addEventListener('click', (e) => {
    const uniRow = e.target.closest('[data-uni]');
    if (uniRow) {
      // Из режима «Вузы» — сразу к программам этого вуза.
      state.uni = Number(uniRow.dataset.uni);
      state.city = index.unis.get(state.uni)?.city ?? state.city;
      state.view = 'programs';
      update();
      el.results.scrollIntoView({ block: 'start' });
      return;
    }
    if (e.target.closest('[data-premium]')) openPremium();
    if (e.target.closest('[data-ask]')) focusAssistant();
    if (e.target.closest('[data-dismiss-hint]')) {
      save(STORE.hintOff, '1');
      renderList();
    }
  });
  // Плашка над списком: «Ты проходишь на N — показать только их?» и обратно.
  $('fitsBar').addEventListener('click', (e) => {
    if (!e.target.closest('[data-fits]')) return;
    state.fits = !state.fits;
    update();
    el.results.scrollIntoView({ block: 'start' });
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
    if (e.key !== 'Escape') return;
    if (openPop) closePop(true);
    else if (!el.sheet.hidden) closeSheet();
  });
  const reposition = () => openPop && positionPop();
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, { passive: true });

  // Избранное и сравнение
  const onCardAction = (e) => {
    const fav = e.target.closest('[data-fav]');
    const cmp = e.target.closest('[data-cmp]');
    if (fav) toggleIn(state.favs, fav.dataset.fav, STORE.fav);
    if (cmp) {
      const key = cmp.dataset.cmp;
      if (!state.cmp.has(key) && state.cmp.size >= MAX_COMPARE) {
        showToast(`Сравнивать можно до ${MAX_COMPARE} программ, убери одну`);
        return;
      }
      toggleIn(state.cmp, key, STORE.cmp);
    }
    if (fav || cmp) {
      syncCollections();
      if (fav && $('favDialog').open) renderFavorites();
    }
  };
  el.list.addEventListener('click', onCardAction);
  $('favList').addEventListener('click', (e) => {
    if (e.target.closest('[data-premium]')) {
      $('favDialog').close();
      openPremium();
      return;
    }
    onCardAction(e);
  });
  $('favBtn').addEventListener('click', () => { renderFavorites(); $('favDialog').showModal(); });
  $('cmpOpen').addEventListener('click', () => { renderCompare(); $('cmpDialog').showModal(); });
  $('cmpClear').addEventListener('click', () => { state.cmp.clear(); saveSet(STORE.cmp, state.cmp); syncCollections(); });
  $('cmpTable').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    state.cmp.delete(rm.dataset.rm);
    saveSet(STORE.cmp, state.cmp);
    syncCollections();
    if (state.cmp.size) renderCompare();
    else $('cmpDialog').close();
  });
  for (const d of [$('favDialog'), $('cmpDialog')]) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }

  el.premiumBtn.addEventListener('click', openPremium);
  el.premium.addEventListener('click', (e) => {
    if (e.target === el.premium || e.target.closest('[data-close]')) el.premium.close();
  });
  el.premiumBuy.addEventListener('click', () => { el.premiumThanks.hidden = false; });
  el.theme.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  syncTheme();
}

function bindSubjects() {
  el.subjects.addEventListener('click', (e) => {
    const level = e.target.closest('[data-math]');
    if (level) {
      state.mathBase = level.dataset.math === 'base';
      update();
      return;
    }
    const btn = e.target.closest('.subject__toggle');
    if (!btn) return;
    const tile = btn.closest('.subject').dataset.id;
    if (LOCKED_SUBJECTS.includes(tile)) return;
    const id = tile === 'lang' ? langId(el.subjects, state) : tile;
    if (state.subjects.has(id)) state.subjects.delete(id);
    else selectSubject(id);
    update();
  });
  // Другой язык в плашке «Иностранный»: если язык уже отмечен, меняем его вместе с баллом.
  el.subjects.addEventListener('change', (e) => {
    if (!e.target.matches('[data-lang]')) return;
    const next = e.target.value;
    const prev = LANGS.find((l) => state.subjects.has(l));
    if (prev && prev !== next) {
      state.subjects.delete(prev);
      state.subjects.add(next);
      if (state.myScores[prev] != null) state.myScores[next] = state.myScores[prev];
      delete state.myScores[prev];
    }
    update();
  });
  // Балл ЕГЭ — от 0 до 100: сразу правим поле, чтобы нельзя было ввести 150 или буквы.
  // Балл записываем в состояние сразу, а откладываем только перерисовку: иначе при быстром
  // вводе в несколько полей подряд (или автозаполнении) терялись все баллы, кроме последнего.
  const debouncedScoresUpdate = debounce(update, 250);
  el.subjects.addEventListener('input', (e) => {
    const input = e.target;
    const id = input.dataset.score;
    if (!id) return;
    if (input.value !== '') {
      const digits = input.value.replace(/\D/g, '').slice(0, 3);
      const fixed = digits === '' ? '' : String(Math.min(100, Number(digits)));
      if (fixed !== input.value) input.value = fixed;
    }
    if (input.value === '') {
      delete state.myScores[id];
    } else {
      state.myScores[id] = Math.min(100, Math.max(0, Number(input.value)));
      // Вписал балл — значит, сдаёшь: предмет отмечается сам.
      if (!state.subjects.has(id)) selectSubject(id);
    }
    debouncedScoresUpdate();
  });
  el.resetSubjects.addEventListener('click', () => {
    state.subjects = new Set(LOCKED_SUBJECTS);
    state.mathBase = false;
    state.myScores = {};
    update();
  });
}

// ------------------------------------------------------------------ ИИ-помощник

/** Строка «Опиши словами»: фраза -> предметы, баллы и фильтры. Последнее применение можно отменить. */
function bindAssistant() {
  let undo = null;
  const regionNames = () => [...index.cities.values()].map((c) => c.name);
  const run = async (text) => {
    const button = el.ask.querySelector('[type="submit"]');
    button.disabled = true;
    el.ask.classList.add('is-busy');
    el.askReply.hidden = false;
    el.askReply.textContent = 'Думаю…';
    const { plan, source, error } = await askAssistant(text, regionNames());
    button.disabled = false;
    el.ask.classList.remove('is-busy');
    const before = snapshotState();
    const notes = applyPlan(plan, state, index);
    if (!notes.length) {
      Object.assign(state, before);
      el.askReply.innerHTML = `${plan.reply ? `${esc(plan.reply)} ` : ''}Не получилось понять запрос. Назови предметы, баллы, город или профессию, например: «биология и химия, хочу врачом в Казани».`;
      return;
    }
    undo = before;
    update();
    const fallback = error ? `<small class="ask__note">ИИ сейчас недоступен (${esc(error)}), разобрал запрос попроще.</small>` : '';
    const empty = !results.ready ? '<small class="ask__note">Чтобы появился список, отметь ещё хотя бы один предмет по выбору.</small>'
      : !results.items.length ? '<small class="ask__note">Ничего не нашлось. Возможно, не хватает предмета (смотри «+N» у предметов) или фильтры слишком узкие.</small>' : '';
    el.askReply.innerHTML = `
      <p>${plan.reply && source === 'ai' ? `${esc(plan.reply)}<br>` : ''}<b>Понял так:</b> ${esc(notes.join('; '))}.</p>
      ${fallback}${empty}
      <div class="ask__actions">
        <button type="button" class="btn btn--primary btn--sm" data-ask-show>Смотреть программы</button>
        <button type="button" class="btn btn--ghost btn--sm" data-ask-undo>Отменить</button>
      </div>`;
  };
  el.ask.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.askInput.value.trim();
    if (text) run(text);
  });
  el.ask.addEventListener('click', (e) => {
    const example = e.target.closest('[data-example]');
    if (example) {
      el.askInput.value = example.dataset.example;
      run(example.dataset.example);
    }
    if (e.target.closest('[data-ask-show]')) el.results.scrollIntoView({ block: 'start' });
    if (e.target.closest('[data-ask-undo]') && undo) {
      Object.assign(state, undo);
      undo = null;
      update();
      el.askReply.hidden = true;
    }
  });
}

/** Копия подбора без избранного и сравнения: чтобы отменить то, что выставил помощник. */
function snapshotState() {
  return Object.fromEntries(Object.keys(defaultState()).map((k) => [k, structuredClone(state[k])]));
}

function focusAssistant() {
  el.ask.scrollIntoView({ block: 'center' });
  el.askInput.focus({ preventScroll: true });
}

/** Отметить предмет; иностранный язык может быть только один. */
function selectSubject(id) {
  if (LANGS.includes(id)) for (const l of LANGS) state.subjects.delete(l);
  state.subjects.add(id);
}

function openSheet() {
  el.sheet.hidden = false;
  el.sheetBackdrop.hidden = false;
  document.body.classList.add('sheet-open');
  $('fsheetClose').focus({ preventScroll: true });
}

function closeSheet() {
  if (el.sheet.hidden) return;
  closePop(false);
  el.sheet.hidden = true;
  el.sheetBackdrop.hidden = true;
  document.body.classList.remove('sheet-open');
  el.mFilters.focus({ preventScroll: true });
}

function openPremium() {
  el.premiumThanks.hidden = true;
  el.premium.showModal();
}

// Тема: по умолчанию светлая, выбор запоминается в этом браузере.
function setTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  save(STORE.theme, theme);
  syncTheme();
}

function syncTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  el.theme.setAttribute('aria-checked', String(dark));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12162a' : '#fbfaf5');
}

/** Ссылка на текущую подборку: на телефоне — системное «Поделиться», на компьютере — в буфер обмена. */
async function shareSelection() {
  const url = location.href;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: document.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast('Ссылка на подборку скопирована');
  } catch (err) {
    if (err?.name !== 'AbortError') showToast('Не получилось скопировать. Возьми адрес из строки браузера');
  }
}

function resetFilters() {
  const fresh = defaultState();
  Object.assign(state, {
    city: fresh.city, uni: fresh.uni, dir: fresh.dir, areas: fresh.areas, forms: fresh.forms, levels: fresh.levels,
    min: fresh.min, max: fresh.max, budgetOnly: fresh.budgetOnly, fits: fresh.fits, q: fresh.q,
  });
  closePop(false);
  update();
}

// ------------------------------------------------------------------ всплывающие окна

// Регионы, которые ищут чаще всего: закреплены наверху списка.
const POPULAR_CITIES = ['Москва', 'Санкт-Петербург'];

const POP_TITLES = { sort: 'Сортировка', city: 'Регион', uni: 'Вуз', dir: 'Направление', form: 'Форма и уровень', score: 'Проходной балл' };
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
      <div class="pop-search">${icon('search')}<input type="search" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off"></div>
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
  } else if (kind === 'sort') {
    // На телефоне вместо обрезанного списка — окно с полными названиями сортировки
    el.popBody.innerHTML = `<ul class="options" role="listbox" aria-label="Сортировка">${[...el.sort.options].map((o) => `
      <li><button type="button" class="option${o.value === state.sort ? ' is-selected' : ''}" data-sort="${esc(o.value)}" role="option"
        aria-selected="${o.value === state.sort}"${o.disabled ? ' disabled' : ''}><span class="option__main">${esc(o.textContent)}
        ${o.disabled ? '<small>Сначала впиши свои баллы</small>' : ''}</span></button></li>`).join('')}</ul>`;
    el.popBody.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      state.sort = b.dataset.sort;
      closePop(true);
      update();
    }));
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
  const option = (o, star = '') => {
    const sel = String(o.value) === current;
    const count = o.count != null ? `<span class="option__count">${o.count}</span>` : '';
    return `<li><button type="button" class="option${sel ? ' is-selected' : ''}" data-value="${esc(o.value)}" role="option" aria-selected="${sel}">
      <span class="option__main">${star}${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>${count}</button></li>`;
  };
  if (!words.length) {
    rows.push(`<li><button type="button" class="option${current === '' ? ' is-selected' : ''}" data-value="" role="option" aria-selected="${current === ''}">
      <span class="option__main">${anyLabel}</span><span class="option__count">${all.length}</span></button></li>`);
    if (kind === 'city') {
      const top = POPULAR_CITIES.map((name) => all.find((c) => c.label.startsWith(name))).filter(Boolean);
      if (top.length) {
        rows.push('<li class="options__head">Популярные</li>', ...top.map((o) => option(o, '<span class="option__star" aria-hidden="true">★ </span>')));
        rows.push('<li class="options__head">Все регионы</li>');
      }
    }
  }
  for (const o of found.slice(0, OPTIONS_LIMIT)) rows.push(option(o));
  const example = { city: '«казань» или «татарстан»', uni: '«мирэа» или «казань»', dir: '«экономика» или «09.03»' }[kind];
  if (!found.length) rows.push(`<li class="options__empty">Ничего не нашлось. Попробуй по-другому, например ${example}.</li>`);
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
    state.areas.clear();
  }
  closePop(true);
  update();
}

// ------------------------------------------------------------------ обновление

function update() {
  state.showScores = hasMyScores(state);
  if (!state.showScores) state.fits = false;
  if (state.sort === 'margin-desc' && !state.showScores) state.sort = 'score-desc';
  if (state.dir && state.uni && !index.programs.some((p) => p.uni === state.uni && p.dirKey === state.dir)) state.dir = '';
  results = computeResults(index, state);
  results.groups = state.view === 'unis' ? groupByUni(results.items, state.sort) : null;
  page = 1;
  syncControls();
  updateSubjects(el.subjects, state, results.unlock);
  renderSubjectsHint();
  renderSummary();
  renderFitsBar();
  renderList();
  writeState(state, index);
  save(STORE.last, location.search);
  syncCollections();
}

const ANY = { city: 'Все регионы', uni: 'Все вузы', dir: 'Все направления', form: 'Любые', score: 'Любой' };

function setPill(kind, value, full = value) {
  const row = el.sheet.querySelector(`[data-pop="${kind}"]`);
  row.classList.toggle('is-active', Boolean(value));
  row.querySelector('.frow__value').textContent = full || ANY[kind];
  const pill = el.fbar.querySelector(`.fpill[data-pop="${kind}"]`);
  pill.classList.toggle('is-active', Boolean(value));
  pill.querySelector('.fpill__label').textContent = value || POP_TITLES[kind];
  pill.title = value ? `${POP_TITLES[kind]}: ${full}` : '';
}

function syncControls() {
  // «Москва и Московская область» -> «Москва»: на кнопке нужно коротко, полное имя в подсказке
  const cityName = state.city ? index.cities.get(state.city)?.name ?? '' : '';
  setPill('city', cityName.split(' и ')[0], cityName);
  setPill('uni', state.uni ? index.unis.get(state.uni)?.name : '');
  setPill('dir', state.dir ? index.programs.find((p) => p.dirKey === state.dir)?.name : areasLabel(state.areas));
  setPill('form', [...state.forms, ...state.levels].join(', '));
  setPill('score', hasScoreFilter(state, index.scoreBounds)
    ? `${state.min ?? index.scoreBounds.min}–${state.max ?? index.scoreBounds.max}` : '');
  for (const [btn, on] of [[el.budget, state.budgetOnly], [el.mBudget, state.budgetOnly], [el.fits, state.fits], [el.mFits, state.fits]]) {
    btn.setAttribute('aria-pressed', String(on));
  }
  el.fits.hidden = !state.showScores;
  el.mFits.hidden = !state.showScores;
  el.resetFilters.hidden = !hasActiveFilters();
  renderChips();
  if (el.q.value.trim() !== state.q) el.q.value = state.q;
  const marginOpt = el.sort.querySelector('[value="margin-desc"]');
  if (marginOpt) marginOpt.disabled = !state.showScores;
  el.sort.value = state.sort;
  $('mSortLabel').textContent = SORT_SHORT[state.sort] ?? 'Балл ↓';
  el.views.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
}

/** Включённые фильтры плашками с крестиком (видны на телефоне под поиском). */
function renderChips() {
  const cityName = state.city ? index.cities.get(state.city)?.name ?? '' : '';
  const chips = [
    state.city && ['city', cityName.split(' и ')[0]],
    state.uni && ['uni', index.unis.get(state.uni)?.name ?? ''],
    state.dir && ['dir', index.programs.find((p) => p.dirKey === state.dir)?.name ?? ''],
    !state.dir && state.areas.size && ['dir', areasLabel(state.areas)],
    (state.forms.size || state.levels.size) && ['form', [...state.forms, ...state.levels].join(', ')],
    hasScoreFilter(state, index.scoreBounds) && ['score', `балл ${state.min ?? index.scoreBounds.min}–${state.max ?? index.scoreBounds.max}`],
    state.budgetOnly && ['budget', 'Только бюджет'],
    state.fits && ['fits', 'Хватает баллов'],
  ].filter(Boolean);
  el.mChips.innerHTML = chips.map(([kind, text]) =>
    `<button type="button" class="mchip" data-clear="${kind}" aria-label="Убрать фильтр: ${esc(text)}"><span>${esc(text)}</span>${icon('x')}</button>`).join('');
  el.mCount.textContent = chips.length;
  el.mCount.hidden = !chips.length;
}

function hasActiveFilters() {
  return Boolean(state.city || state.uni || state.dir || state.areas.size || state.forms.size || state.levels.size || state.q
    || state.budgetOnly || state.fits || hasScoreFilter(state, index.scoreBounds));
}

function renderSubjectsHint() {
  const base = state.mathBase ? ' Базовую математику вузы не засчитывают: покажем программы, где она не нужна.' : '';
  el.subjectsHint.innerHTML = (results.ready
    ? 'Цифра «+N» у предмета — сколько ещё программ он добавит. Впиши баллы, чтобы увидеть свои шансы.'
    : 'Русский и математика уже отмечены. Отметь хотя бы один предмет по выбору, и ниже появятся программы.') + base;
}

/**
 * «Как пользоваться» — это три шага прямо над подбором. Они отмечаются по ходу дела:
 * человек видит и порядок действий, и где он сейчас.
 */
function renderStepper() {
  const fits = state.showScores ? results.items.filter((i) => i.margin != null && i.margin >= 0).length : 0;
  const scoresNote = !state.showScores ? 'необязательно, но покажет шансы'
    : chancesCounted() ? `проходишь на ${fits.toLocaleString('ru')}` : 'впиши баллы по всем предметам';
  const steps = [
    [results.ready, results.ready ? 'готово' : 'отметь хотя бы один по выбору'],
    [state.showScores, scoresNote],
    [state.favs.size > 0, state.favs.size ? `в избранном ${state.favs.size}` : 'фильтры, избранное и сравнение'],
  ];
  const current = steps.findIndex(([done], i) => !done && (i !== 2 || results.ready));
  el.stepper.querySelectorAll('[data-step]').forEach((li, i) => {
    const [done, note] = steps[i];
    li.classList.toggle('is-done', done);
    li.classList.toggle('is-current', i === current);
    li.querySelector('.stepper__n').textContent = done ? '✓' : i + 1;
    li.querySelector('.stepper__note').textContent = note;
  });
}

function renderSummary() {
  const found = results.ready ? results.items.length : 0;
  el.mShow.textContent = results.ready
    ? (found ? `Показать ${found.toLocaleString('ru')} ${pluralize(found, 'программу', 'программы', 'программ')}` : 'Ничего не нашлось')
    : 'Сначала выбери предметы';
  if (!results.ready) {
    el.summary.textContent = 'Здесь появятся программы, когда отметишь предметы';
    return;
  }
  const n = results.items.length;
  const unis = new Set(results.items.map((i) => i.p.uni)).size;
  const fits = state.showScores ? results.items.filter((i) => i.margin != null && i.margin >= 0).length : 0;
  // Пока не вписаны баллы по всем экзаменам хоть одной программы, «проходишь на 0» звучит как приговор.
  const chances = !state.showScores ? ''
    : chancesCounted() ? `, проходишь на ${fits ? `<mark>${fits.toLocaleString('ru')}</mark>` : '0'}`
      : '. Чтобы посчитать шансы, впиши баллы по всем своим предметам';
  el.summary.innerHTML = n
    ? `<b>${n.toLocaleString('ru')}</b> ${pluralize(n, 'программа', 'программы', 'программ')} в <b>${unis}</b> ${pluralize(unis, 'вузе', 'вузах', 'вузах')}${chances}`
    : 'Ничего не нашлось';
}

/** Заметное предложение показать только программы, куда хватает баллов (то же, что «Хватает моих баллов»). */
function renderFitsBar() {
  const bar = $('fitsBar');
  const fits = results.ready && state.showScores ? results.items.filter((i) => i.margin != null && i.margin >= 0).length : 0;
  const total = results.ready ? results.items.length : 0;
  if (state.fits && total) {
    bar.innerHTML = `<span>Показаны только программы, куда хватает твоих баллов: <b>${total.toLocaleString('ru')}</b></span>
      <button type="button" class="btn btn--ghost btn--sm" data-fits>Показать все</button>`;
  } else if (!state.fits && fits && fits < total) {
    bar.innerHTML = `<span>Ты проходишь на <mark>${fits.toLocaleString('ru')}</mark> ${pluralize(fits, 'программу', 'программы', 'программ')} из ${total.toLocaleString('ru')}.</span>
      <button type="button" class="btn btn--primary btn--sm" data-fits>Показать только их</button>`;
  } else {
    bar.innerHTML = '';
  }
  bar.hidden = !bar.innerHTML;
}

/** Посчитана ли сумма баллов хотя бы для одной найденной программы. */
const chancesCounted = () => results.items.some((i) => i.mine != null);

function renderList() {
  el.pager.hidden = true;
  el.list.classList.toggle('cards--unis', state.view === 'unis');
  if (!results.ready) {
    el.list.innerHTML = '';
    el.empty.hidden = false;
    el.empty.innerHTML = `
      <p class="empty__title">Отметь хотя бы один предмет по выбору</p>
      <p>Русский и математика уже учтены, они обязательны. Цифра «+N» на предмете подскажет, сколько программ он откроет.</p>`;
    return;
  }
  if (!results.items.length) {
    el.list.innerHTML = '';
    el.empty.hidden = false;
    const filtered = hasActiveFilters();
    el.empty.innerHTML = `
      <p class="empty__title">Подходящих программ нет</p>
      <p>${filtered ? 'Попробуй ослабить фильтры или поменять набор предметов.'
        : state.mathBase ? 'С базовой математикой и этими предметами программ не нашлось. Добавь предмет с цифрой «+N» или переключи математику на профиль.'
          : 'С этим набором предметов ничего не нашлось. Попробуй добавить предмет с цифрой «+N».'}</p>
      ${filtered ? '<button type="button" class="btn btn--primary" data-action="reset-filters">Сбросить фильтры</button>' : ''}`;
    return;
  }
  el.empty.hidden = true;
  const rows = state.view === 'unis' ? results.groups : results.items;
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  page = Math.min(Math.max(1, page), pages);
  const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = effectiveSubjects(state);
  const html = state.view === 'unis'
    ? slice.map((g) => renderUniRow(g, state))
    : slice.map((item) => renderCard(item, index, state, selected));
  const hint = state.view === 'programs' && page === 1 ? strategyHint() : '';
  if (hint && html.length > HINT_AT + 2) html.splice(HINT_AT, 0, hint);
  el.list.innerHTML = html.join('');
  renderPager(pages, rows.length, state.view === 'unis' ? ['вуз', 'вуза', 'вузов'] : ['программа', 'программы', 'программ']);
}

/**
 * Премиум предлагаем к месту: когда баллы введены и уже понятно, на что человек проходит.
 * Подсказку можно закрыть, и она больше не появится.
 */
function strategyHint() {
  if (!state.showScores || load(STORE.hintOff)) return '';
  const fits = results.items.filter((i) => i.margin != null && i.margin >= 0).length;
  if (!fits) return '';
  return `
  <li class="hint-card">
    <p class="hint-card__text"><b>Твои баллы проходят на ${fits.toLocaleString('ru')} ${pluralize(fits, 'программу', 'программы', 'программ')}.</b>
      Не знаешь, какие выбрать? Опиши ИИ-помощнику, чего хочешь, и он сузит список.</p>
    <button type="button" class="btn btn--primary btn--sm" data-ask>Спросить ИИ</button>
    <button type="button" class="icon-btn" data-dismiss-hint aria-label="Скрыть подсказку">${icon('x')}</button>
  </li>`;
}

/** Номера страниц: ← 1 … 4 5 6 … 20 → */
function renderPager(pages, total, forms) {
  if (pages <= 1) return;
  const sorted = [...new Set([1, pages, page - 1, page, page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const num = (n) => `<button type="button" class="pager__btn${n === page ? ' is-current' : ''}" data-page="${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`;
  const arrow = (n, label, text, off) => `<button type="button" class="pager__btn" data-page="${n}" aria-label="${text}"${off ? ' disabled' : ''}>${label}</button>`;
  const parts = [arrow(page - 1, '←', 'Предыдущая страница', page === 1)];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) parts.push('<span class="pager__gap">…</span>');
    parts.push(num(n));
  });
  parts.push(arrow(page + 1, '→', 'Следующая страница', page === pages));
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  el.pager.innerHTML = `<div class="pager__btns">${parts.join('')}</div>
    <span class="pager__info">${from}–${to} из ${total.toLocaleString('ru')} ${pluralize(total, ...forms)}</span>`;
  el.pager.hidden = false;
}

function showFatal(err) {
  console.error(err);
  const fileMode = location.protocol === 'file:';
  el.empty.hidden = false;
  el.summary.textContent = 'Данные не загрузились';
  el.empty.innerHTML = `
    <p class="empty__title">Не удалось загрузить данные</p>
    <p>${fileMode
      ? 'Страница открыта как файл, а браузер не даёт так читать JSON. Запустите <code>start.bat</code> или откройте dist/unimatch.html.'
      : `Обнови страницу через минуту. Если не помогает, проверь интернет или зайди позже.</p>
    <p class="muted">Для автора сайта: data/data.json должен лежать рядом с index.html (${esc(err.message)}).`}</p>`;
}

// ------------------------------------------------------------------ хранилище браузера

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим: просто не сохраняем между визитами
  }
}

function loadSet(key) {
  try {
    const list = JSON.parse(load(key) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((k) => index.byKey.has(k)) : []);
  } catch {
    return new Set();
  }
}

const saveSet = (key, set) => save(key, JSON.stringify([...set]));

function toggleIn(set, key, storageKey) {
  set.has(key) ? set.delete(key) : set.add(key);
  saveSet(storageKey, set);
}

// ------------------------------------------------------------------ избранное и сравнение

/** Обновляет счётчики, шаги, панель сравнения и кнопки на уже нарисованных карточках. */
function syncCollections() {
  $('favCount').textContent = state.favs.size;
  $('favCount').hidden = !state.favs.size;
  // На телефоне от кнопки видно только сердечко и число: проговариваем число и для скринридера.
  $('favBtn').setAttribute('aria-label', state.favs.size ? `Избранное: ${state.favs.size}` : 'Избранное');
  const n = state.cmp.size;
  $('cmpBar').hidden = n === 0;
  document.body.classList.toggle('has-cmpbar', n > 0);
  $('cmpText').innerHTML = `Сравнение: <b>${n}</b> из ${MAX_COMPARE}` + (n < 2 ? ' · добавь ещё' : '');
  $('cmpOpen').disabled = n < 2;
  document.querySelectorAll('[data-fav]').forEach((b) => {
    const on = state.favs.has(b.dataset.fav);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Убрать из избранного' : 'В избранное';
  });
  document.querySelectorAll('[data-cmp]').forEach((b) => {
    const on = state.cmp.has(b.dataset.cmp);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('span').textContent = on ? 'В сравнении' : 'Сравнить';
  });
  renderStepper();
}

function itemFor(p) {
  const mine = state.showScores ? myTotal(p, effectiveSubjects(state), state.myScores) : null;
  return { p, mine, margin: marginFor(p, mine) };
}

function renderFavorites() {
  const items = [...state.favs].map((k) => index.byKey.get(k)).filter(Boolean).map(itemFor);
  const selected = effectiveSubjects(state);
  // Три и больше программ в избранном — самое время сохранить подборку в PDF или спросить ИИ.
  const nudge = items.length >= 3 ? `
    <li class="hint-card">
      <p class="hint-card__text"><b>У тебя ${items.length} ${pluralize(items.length, 'программа', 'программы', 'программ')} в избранном.</b>
        В Премиуме их можно сохранить в PDF и показать родителям или спросить ИИ-помощника, куда подать.</p>
      <button type="button" class="btn btn--primary btn--sm" data-premium>Подробнее</button>
    </li>` : '';
  $('favList').innerHTML = items.length
    ? nudge + items.map((item) => renderCard(item, index, state, selected)).join('')
    : '<li class="empty"><p class="empty__title">Здесь пока пусто</p><p>Нажми на сердечко на карточке программы, чтобы сохранить её. Список хранится в этом браузере.</p></li>';
}

function examText(p) {
  const name = (id) => index.subjects.get(id)?.short ?? id;
  const parts = p.req.map(name);
  for (const g of p.choice) parts.push(g.length > 4 ? 'иностранный' : g.map(name).join(' или '));
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
    rows.push(['Мои шансы', (i) => (i.margin == null
      ? `<span class="muted">${i.mine == null ? 'впиши баллы' : i.p.score == null ? 'нет проходного' : i.p.dvi ? 'не сравнить: экзамен вуза' : 'не сравнить: доп. баллы'}</span>`
      : i.margin >= 0 ? `<mark>запас +${i.margin}</mark>` : `<span class="pen">не хватает ${-i.margin}</span>`)]);
  }
  rows.push(
    ['Экзамены', (i) => esc(examText(i.p))],
    ['Платно в год', (i) => (i.p.cost ? `<b>${i.p.cost.toLocaleString('ru')} ₽</b>` : '<span class="muted">нет данных</span>')],
    ['Форма и уровень', (i) => esc(`${i.p.form}, ${i.p.level || '—'}`)],
    ['Факультет', (i) => esc(i.p.faculty || '—')],
    ['', (i) => `<a class="card__link" href="${esc(officialProgramUrl(i.p, i.p.uniObj))}" target="_blank" rel="noopener noreferrer">Найти программу</a>
      <button type="button" class="act" data-rm="${esc(progKey(i.p))}">${icon('x')}<span>Убрать</span></button>`],
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
