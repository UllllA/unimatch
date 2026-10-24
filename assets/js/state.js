// Состояние подбора и его синхронизация с адресной строкой (ссылкой на подборку можно поделиться).
import { LOCKED_SUBJECTS } from './filters.js';

export function defaultState() {
  return {
    subjects: new Set(LOCKED_SUBJECTS),
    mathBase: false,
    myScores: {},
    showScores: false,
    city: null,
    uni: null,
    dir: '',
    forms: new Set(),
    levels: new Set(),
    min: null,
    max: null,
    budgetOnly: false,
    fits: false,
    q: '',
    sort: 'score-desc',
  };
}

const list = (value) => (value ? value.split(',').filter(Boolean) : []);
const int = (value) => (value != null && /^\d+$/.test(value) ? Number(value) : null);

export function readState(index, search = location.search) {
  const params = new URLSearchParams(search);
  const state = defaultState();

  for (const id of list(params.get('s'))) if (index.subjects.has(id)) state.subjects.add(id);
  for (const pair of list(params.get('my'))) {
    const [id, value] = pair.split(':');
    const score = int(value);
    if (index.subjects.has(id) && score != null && score <= 100) state.myScores[id] = score;
  }
  state.showScores = params.get('ms') === '1';
  state.mathBase = params.get('mb') === '1';

  const city = int(params.get('city'));
  if (city != null && index.cities.has(city)) state.city = city;
  const uni = int(params.get('uni'));
  if (uni != null && index.unis.has(uni) && (!state.city || index.unis.get(uni).city === state.city)) state.uni = uni;
  const dir = params.get('dir');
  if (dir && index.programs.some((p) => p.dirKey === dir)) state.dir = dir;

  state.forms = new Set(list(params.get('f')));
  state.levels = new Set(list(params.get('l')));
  const { min, max } = index.scoreBounds;
  state.min = clamp(int(params.get('min')), min, max);
  state.max = clamp(int(params.get('max')), min, max);
  if (state.min != null && state.max != null && state.min > state.max) [state.min, state.max] = [state.max, state.min];
  state.budgetOnly = params.get('b') === '1';
  state.fits = params.get('fit') === '1';
  state.q = (params.get('q') ?? '').slice(0, 100);
  state.sort = params.get('sort') ?? state.sort;
  return state;
}

function clamp(value, min, max) {
  return value == null ? null : Math.min(max, Math.max(min, value));
}

export function writeState(state, index) {
  const params = new URLSearchParams();
  const extra = [...state.subjects].filter((s) => !LOCKED_SUBJECTS.includes(s));
  if (extra.length) params.set('s', extra.join(','));
  if (state.mathBase) params.set('mb', '1');
  const scores = Object.entries(state.myScores)
    .filter(([id, v]) => v != null && state.subjects.has(id))
    .map(([id, v]) => `${id}:${v}`);
  if (state.showScores) params.set('ms', '1');
  if (state.showScores && scores.length) params.set('my', scores.join(','));
  if (state.city) params.set('city', state.city);
  if (state.uni) params.set('uni', state.uni);
  if (state.dir) params.set('dir', state.dir);
  if (state.forms.size) params.set('f', [...state.forms].join(','));
  if (state.levels.size) params.set('l', [...state.levels].join(','));
  if (state.min != null && state.min > index.scoreBounds.min) params.set('min', state.min);
  if (state.max != null && state.max < index.scoreBounds.max) params.set('max', state.max);
  if (state.budgetOnly) params.set('b', '1');
  if (state.fits) params.set('fit', '1');
  if (state.q) params.set('q', state.q);
  if (state.sort !== 'score-desc') params.set('sort', state.sort);

  const query = params.toString();
  const url = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  if (url === `${location.pathname}${location.search}${location.hash}`) return;
  try {
    history.replaceState(null, '', url);
  } catch {
    // Некоторые браузеры запрещают менять адрес у страницы, открытой как file://.
  }
}
