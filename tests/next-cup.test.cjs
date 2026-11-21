const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const app = scripts.at(-1);

// The app ships without a build step. Exercise the actual recipe, timer and storage code
// with small substitutes for rendering and sound outside the Next Cup card.
function section(from, to) {
  const start = app.indexOf(from);
  const end = app.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, from);
  return app.slice(start, end);
}

function fixtureData(overrides = {}) {
  const source = {
    id: 1001, beanId: 10, mode: 'v60', recipe: 'cascade', coffee: 20, water: 320,
    ratio: 16, pours: [{ time: 0, add: 40 }, { time: 40, add: 186 }, { time: 85, add: 94 }],
    done: true, duration: 130, scheduledDuration: 130, rating: 0, grind: 20, ...overrides
  };
  const beans = [{ id: 10, name: 'Первое', remaining: 250 }, { id: 20, name: 'Второе', remaining: 250 }];
  const storage = new Map([['journal_index', JSON.stringify([source.id])], ['journal_entry_' + source.id, JSON.stringify(source)]]);
  for (const bean of beans) storage.set('bean_' + bean.id, JSON.stringify(bean));
  return storage;
}

async function boot(storage, cloud = false) {
  const listeners = {};
  const card = {
    innerHTML: '', hidden: true,
    addEventListener(name, fn) { listeners[name] = fn; },
    querySelector() { return { focus() {} }; },
    contains() { return false; },
    setAttribute() {}, removeAttribute() {}
  };
  const localStorage = {
    getItem: key => cloud ? null : storage.get(key) ?? null,
    setItem: (key, value) => { if (!cloud) storage.set(key, value); },
    removeItem: key => { if (!cloud) storage.delete(key); }
  };
  const callbacks = {
    getItem: (key, cb) => queueMicrotask(() => cb(null, storage.get(key))),
    setItem: (key, value, cb) => queueMicrotask(() => { storage.set(key, value); cb(null); }),
    removeItem: (key, cb) => queueMicrotask(() => { storage.delete(key); cb(null); }),
    getItems: (keys, cb) => queueMicrotask(() => cb(null, Object.fromEntries(keys.map(key => [key, storage.get(key)]))))
  };
  const context = vm.createContext({
    console, document: { getElementById: () => card }, localStorage,
    window: { Telegram: cloud ? { WebApp: { initData: 'test', CloudStorage: callbacks } } : null },
    FormData: class { constructor(form) { return new Map(Object.entries(form.fields)); } },
    performance: { now: () => 10 },
    readBean: id => JSON.parse(storage.get('bean_' + id))
  });
  const run = code => vm.runInContext(code, context);
  run(`
    const OCT_CFG = { doneSlack:2, legacyMinDur:20 };
    const state = { mode:'v60', ratio:17, recipe:'equal', inputType:'water', value:420 };
    const DEFAULT_RATIO = { v60:16, v60ice:16 };
    const ICE_SHARE = 0.375;
    const cup = { size:'M', custom:420 };
    const tileAnim = {};
    const Themes = { sync(){}, toast(){ throw Error('Unexpected toast'); } };
    let activeBeanId = 10, beans = [readBean(10), readBean(20)];
    let journalOfferedThisBrew, brewDurationPromise, brewEntryPromise, brewEntryDraft, brewFromBest;
    let brewStepLockUntil, brewRingHoldUntil, brewCdShown;
    const tf = {};
    let writes = 0;
    const pg = () => state.mode;
    function isBrewMode(mode = pg()){ return mode === 'v60' || mode === 'v60ice'; }
    function matchCupSize(water){ return water === 320 ? 'M' : 'custom'; }
    function formatEntryDate(id){ return String(id); }
    function fmt(n){ return String(n); }
    function fmtRatio(n){ return String(n); }
    function ua(){}
    function track(){}
    function setText(){}
    function settleCardHeight(){}
    function stageAlert(){}
    function brewCanAnimate(){ return false; }
    function startBrewMusic(){}
    function tickBrew(){}
    function saveCupPrefs(){}
    function saveCustom(){}
    function closeSheet(){}
    function setMode(mode){ state.mode = mode; compute(); }
    function renderPills(){}
    function renderRecipeSeg(){}
    function moReduce(){ return true; }
    function navGoTo(){}
    function renderJournal(){ NextCup.render(); }
    function compute(){ Object.assign(state, Recipe.build(state)); NextCup.render(); }
    async function setActiveBean(id){ activeBeanId = id; NextCup.render(); }
    async function beanUpdateEntry(entry){
      writes++;
      await storeSet('bean_' + entry.id, JSON.stringify(entry));
    }
    ` + [
    section('const BLOOM_TIME', 'const CUSTOM_STORE_KEY'),
    section('function customStepValues', '// Мягкие подсказки'),
    section('const brewClock', 'let brewStepLockUntil'),
    section('function launchBrew()', '/* ================= Смена шага'),
    section('function saveBrewDuration', '/* Полный возврат к рецепту'),
    section('const tgApp = window.Telegram', '/* ---- Дневник: форматирование ----'),
    section('function isCounted', 'const THEME_RULES_V1'),
    section('function legacyPourTime', 'function pluralRu'),
    section('function normId(', 'function journalRowHTML'),
    section('async function createBrewEntry', 'function openEditSheet'),
    section('function brewPours(', 'const jsXp'),
    section('function gramsTransfers(', '/* Сводка по зерну')
  ].join('\n'));
  await run('compute(); journalLoad().then(NextCup.start)');
  const wait = async () => {
    await run('NextCup.enqueue(()=>{})');
    await new Promise(resolve => setImmediate(resolve));
  };
  return {
    card, run,
    json: code => JSON.parse(run('JSON.stringify(' + code + ')')),
    async click(action) {
      listeners.click({ target: { closest: () => ({ dataset: { next: action } }) } });
      await wait();
    },
    async feedback(id, fields) {
      listeners.submit({ preventDefault() {}, target: { dataset: { id }, fields } });
      await wait();
    },
    async grind(value, valid = true) {
      listeners.input({ target: {
        name: 'grind', value: String(value), valueAsNumber: Number(value), validity: { valid }, setAttribute() {}
      } });
      await wait();
    },
    async brew(seconds) {
      run('Brew.beginCountdown(state.schedule); launchBrew(); launchBrew();');
      const entry = await run('Brew.finish(); saveBrewDuration(' + seconds + ')');
      run('Brew.close(); NextCup.render()');
      return entry;
    }
  };
}

test('All inline scripts parse', () => scripts.forEach(script => new vm.Script(script)));

for (const [rating, taste, expected] of [
  [1, 1, 'крупнее'], [2, 2, 'крупнее'], [3, 1, 'крупнее'],
  [1, -1, 'мельче'], [2, -2, 'мельче'], [3, -1, 'мельче'],
  [4, 1, null], [5, -1, null], [2, '', null], [2, 0, null]
]) {
  test(`Rating ${rating}, taste ${taste === '' ? 'omitted' : taste}`, async () => {
    const y = await boot(fixtureData());
    assert.match(y.card.innerHTML, /Как прошлая чашка/);
    await y.click('rate');
    await y.feedback(1001, { rating, taste: String(taste) });
    assert.equal(y.run('journalEntries[0].rating'), rating);
    assert.equal(y.run('journalEntries[0].nextCup'), undefined);
    if (expected) {
      assert.match(y.card.innerHTML, new RegExp(expected));
      assert.match(y.card.innerHTML, /Это может помочь/);
    } else assert.equal(y.card.hidden, true);
  });
}

test('Deferral persists, history can reopen it, a newer completed cup makes it stale', async () => {
  const storage = fixtureData();
  let y = await boot(storage);
  await y.feedback(1001, { rating: 3, taste: '1' });
  await y.click('defer');
  y = await boot(storage);
  assert.equal(y.card.hidden, true);
  assert.equal(y.run('journalEntries[0].nextCup'), undefined);
  assert.match(y.run('NextCup.historyHTML(1001)'), /Открыть рекомендацию/);
  await y.run('NextCup.openFromHistory(1001)');
  assert.match(y.card.innerHTML, /Попробовать/);
  await y.brew(180);
  assert.equal(y.run('NextCup.historyHTML(1001)'), '');
});

test('Try restores the dose, volume, ratio, preset and pours, while preserving the historical recipe', async () => {
  const source = {
    coffee: 19.9, ratio: 16.1,
    pours: [{ time: 0, add: 39 }, { time: 40, add: 186 }, { time: 85, add: 95 }]
  };
  const y = await boot(fixtureData(source));
  await y.feedback(1001, { rating: 3, taste: '1' });
  await y.click('try');
  await y.click('try');
  assert.match(y.card.innerHTML, /Рецепт прошлой чашки восстановлен/);
  assert.deepEqual(y.json('[state.coffee, state.water, state.ratio, state.recipe]'), [19.9, 320, 16.1, 'cascade']);
  assert.deepEqual(y.json('brewPours(state.schedule)'), source.pours);
  assert.equal(y.run('journalEntries.length'), 1);
  assert.equal(y.run('journalEntries[0].grind'), 20);
  assert.equal(y.run('journalEntries[0].nextCup.status'), 'planned');
});

test('Repeat restores custom values and off-grid waits, and supports numeric legacy pours', async () => {
  const pours = [{ time: 0, add: 0 }, { time: 35, add: 180 }, { time: 143, add: 140 }];
  const y = await boot(fixtureData({ recipe: 'equal', pours, duration: 198, scheduledDuration: undefined }));
  assert.equal(y.run('repeatEntryRecipe(journalEntries[0])'), true);
  assert.equal(y.run('state.recipe'), 'custom');
  assert.deepEqual(y.json('brewPours(state.schedule)'), pours);
  assert.equal(y.run('state.schedule.at(-1).time'), 198);
  const old = await boot(fixtureData({ pours: [40, 186, 94], scheduledDuration: undefined, done: undefined }));
  assert.equal(old.run('repeatEntryRecipe(journalEntries[0])'), true);
  assert.deepEqual(old.json('brewPours(state.schedule).map(p => p.time)'), [0, 40, 85]);
});

for (const cloud of [false, true]) {
  test(`Normal brew creates one entry, deducts once, and resumes the plan via ${cloud ? 'Telegram adapter' : 'localStorage'}`, async () => {
    const storage = fixtureData();
    let y = await boot(storage, cloud);
    await y.feedback(1001, { rating: 3, taste: '1' });
    await y.click('try');
    await y.grind(24);
    y = await boot(storage, cloud);
    assert.match(y.card.innerHTML, /value="24"/);
    await y.click('restore');
    const stopped = await y.brew(15);
    assert.equal(stopped.done, false);
    assert.match(y.card.innerHTML, /Помол, клики/);
    assert.equal(y.run('writes'), 1);
    assert.equal(y.run('journalEntries.length'), 2);
    const trial = await y.brew(130);
    assert.equal(trial.done, true);
    assert.equal(trial.experimentSourceId, 1001);
    assert.equal(trial.grind, 24);
    assert.equal(y.run('writes'), 2);
    assert.equal(y.run('journalEntries.length'), 3);
    assert.equal(y.run('beans[0].remaining'), 210);
    assert.deepEqual(y.json('journalEntries[0].pours'), y.json('journalEntries.at(-1).pours'));
    y = await boot(storage, cloud);
    assert.match(y.card.innerHTML, /Как получилась новая чашка/);
    await y.click('trial');
    await y.click('later');
    assert.match(y.card.innerHTML, /Как получилась новая чашка/);
    await y.feedback(trial.id, { rating: 4, taste: '0', confirmed: 'yes', changed: 'no' });
    assert.match(y.card.innerHTML, /Было 3\/5 · стало 4\/5 · \+1/);
    assert.match(y.card.innerHTML, /Изменение помола могло помочь/);
    await y.click('done');
    assert.equal(y.card.hidden, true);
    assert.match(y.run('NextCup.historyHTML(1001)'), /Оценка выросла/);
  });
}

test('Other beans and insufficient stock do not use the plan', async () => {
  const y = await boot(fixtureData());
  await y.feedback(1001, { rating: 3, taste: '-1' });
  await y.click('try');
  await y.grind(24);
  await y.run('setActiveBean(20)');
  assert.equal((await y.brew(180)).experimentSourceId, undefined);
  await y.run('setActiveBean(10)');
  y.run('beans[0].remaining = 10; NextCup.render()');
  assert.match(y.card.innerHTML, /не хватает зерна/);
  assert.equal((await y.brew(180)).experimentSourceId, undefined);
  assert.equal(y.run('journalEntries.at(-1).nextCup.status'), 'planned');
});

test('Actual recipe changes override self-report and equal clicks leave the hypothesis untested', async () => {
  const y = await boot(fixtureData());
  await y.feedback(1001, { rating: 3, taste: '1' });
  await y.click('try');
  await y.grind(24);
  y.run('state.value = 350; compute()');
  const trial = await y.brew(180);
  await y.feedback(trial.id, { rating: 5, taste: '-1', confirmed: 'yes', changed: 'no' });
  assert.match(y.card.innerHTML, /Вклад помола неизвестен/);
  const same = await boot(fixtureData());
  await same.feedback(1001, { rating: 3, taste: '1' });
  await same.click('try');
  await same.grind(20);
  const unchanged = await same.brew(130);
  await same.feedback(unchanged.id, { rating: 4, taste: '0', confirmed: 'yes', changed: 'no' });
  assert.match(same.card.innerHTML, /Гипотеза не проверена/);
});

test('Deleting the trial restores the plan, deleting its source clears it, and archiving cancels it', async () => {
  const y = await boot(fixtureData());
  await y.feedback(1001, { rating: 3, taste: '1' });
  await y.click('try');
  const trial = await y.brew(130);
  await y.run('journalDeleteEntry(' + trial.id + ')');
  assert.match(y.card.innerHTML, /Помол, клики/);
  await y.run('journalDeleteEntry(1001)');
  assert.equal(y.card.hidden, true);
  const z = await boot(fixtureData());
  await z.feedback(1001, { rating: 3, taste: '1' });
  await z.click('try');
  await z.run('beans[0].archived = true; NextCup.cancelForBean(10)');
  assert.equal(z.run('journalEntries[0].nextCup.status'), 'cancelled');
  assert.equal(z.card.hidden, true);
});

test('Legacy journal editing still saves, unknown grind differs from explicitly entered zero', async () => {
  const y = await boot(fixtureData({ grind: 0, taste: undefined, rating: undefined }));
  assert.equal(y.run('knownGrind(journalEntries[0])'), null);
  await y.run('NextCup.saveJournalEdit({ ...journalEntries[0], rating:2, taste:2, note:"Test" })');
  assert.equal(y.run('journalEntries[0].note'), 'Test');
  y.run('renderJournal()');
  assert.match(y.card.innerHTML, /крупнее/);
  await y.click('try');
  await y.grind(100, false);
  assert.equal(y.run('journalEntries[0].nextCup.targetGrind'), null);
  await y.grind(0);
  const trial = await y.brew(130);
  assert.equal(trial.grind, 0);
  assert.equal(y.run('knownGrind(journalEntries[0])'), 0);
  await y.run('NextCup.saveJournalEdit({ ...journalEntries[0], grind:17 })');
  assert.equal(y.run('knownGrind(journalEntries[0])'), 17);
});
