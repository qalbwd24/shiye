import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  build,
  transform,
} from '../previews/telegram-chat/vendor/web-a/node_modules/esbuild/lib/main.js';
import { loadWorker } from './helpers/local-program-worker.mjs';

const source = new URL('../previews/telegram-chat/vendor/web-a/src/', import.meta.url);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('util/shiyeMessageOrder.ts', source))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const {
  compareShiyeMessages,
  getShiyeMessageOrderDate,
  getShiyeRenderedMessage,
  getShiyeUniqueMessages,
  getShiyeViewportGroups,
  getShiyeViewportOffset,
  isShiyeViewportNewest,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

test('history before either ACK renders one stable identity per actual send, including identical text', async () => {
  const worker = await loadWorker();
  const seed = {
    users: [],
    chats: [],
    channels: [],
    documents: [],
    dialogFilters: [],
    topPeers: [],
    availableReactions: [],
    dialogs: { active: [{ id: '-1', topMessage: 13 }], archived: [] },
    messages: { '-1': [{ id: 13, date: 90, message: 'history' }] },
  };
  const client = { mockData: structuredClone(seed) };
  const locals = [
    { id: 13.000001, chatId: '-1', date: 100, content: { text: { text: 'same' } } },
    { id: 13.000002, chatId: '-1', date: 100, content: { text: { text: 'same' } } },
  ];
  const sends = locals.map((message, index) => {
    const randomId = BigInt(index + 1);
    worker.registerShiyeSendIdentity(randomId, '-1', message.id, message.date);
    return worker.invokeLocalPreview(
      client,
      new worker.Api.messages.SendMessage({
        randomId,
        peer: { roomId: '-1' },
        message: 'same',
      }),
    );
  });
  // Inspect while IndexedDB writes/ACK promises are still pending.
  const committed = locals.map((local, index) => ({
    ...local,
    id: 14 + index,
    date: 102 + index,
    ...worker.getShiyeSendIdentity('-1', 14 + index),
  }));
  for (const messages of [
    [...locals, ...committed],
    [...committed, ...locals],
    [locals[0], committed[1], committed[0]],
    [committed[0], locals[1], committed[1]],
  ]) {
    const rows = getShiyeUniqueMessages(messages).sort(compareShiyeMessages);
    assert.deepEqual(
      rows.map((message) => message.id),
      [14, 15],
    );
    assert.deepEqual(
      rows.map((message) => message.previousLocalId),
      locals.map((message) => message.id),
    );
    assert.deepEqual(rows.map(getShiyeMessageOrderDate), [100, 100]);
  }
  assert.equal(
    getShiyeUniqueMessages(locals).length,
    2,
    'equal text does not merge independent sends',
  );
  assert.equal(
    worker.getShiyeSendIdentity('-2', 14),
    undefined,
    'other room cannot inherit an alias',
  );
  await Promise.all(sends);
  const reopened = await worker.loadLocalPreview(seed);
  assert.deepEqual(
    reopened.messages['-1'].slice(1).map((message) => message.message),
    ['same', 'same'],
  );
  assert.equal(
    JSON.stringify(reopened, (_key, value) =>
      typeof value === 'bigint' ? String(value) : value,
    ).includes('previousLocal'),
    false,
    'aliases never enter persisted library',
  );
});

test('send identity is room scoped, failure cleanup and retry cannot bind stale random IDs', async () => {
  const worker = await loadWorker();
  worker.registerShiyeSendIdentity(77n, '-1', 3.000001, 10);
  worker.registerShiyeSendIdentity(77n, '-2', 3.000002, 11);
  worker.forgetShiyePendingSend(77n, '-1');
  worker.bindShiyeSendIdentity(77n, '-1', 4);
  worker.bindShiyeSendIdentity(77n, '-2', 4);
  assert.equal(worker.getShiyeSendIdentity('-1', 4), undefined);
  assert.equal(worker.getShiyeSendIdentity('-2', 4).previousLocalId, 3.000002);
  worker.registerShiyeSendIdentity(79n, '-1', 3.000003, 10);
  worker.bindShiyeSendIdentity(79n, '-1', 6);
  worker.forgetShiyePendingSend(79n, '-1', true);
  assert.equal(
    worker.getShiyeSendIdentity('-1', 6),
    undefined,
    'failed persistence releases a bound alias',
  );
  worker.registerShiyeSendIdentity(78n, '-1', 3.000001, 10);
  worker.bindShiyeSendIdentity(78n, '-1', 5);
  const alias = worker.getShiyeSendIdentity('-1', 5);
  const photo = { id: 5, chatId: '-1', date: 12, content: { photo: { id: 'photo' } }, ...alias };
  const localPhoto = { ...photo, id: 3.000001, previousLocalId: undefined };
  assert.deepEqual(getShiyeUniqueMessages([photo, localPhoto]), [photo]);
  const withdrawn = { ...photo, content: { action: { type: 'custom' } }, isDeleting: true };
  assert.deepEqual(getShiyeUniqueMessages([localPhoto, withdrawn]), [withdrawn]);
});

test('replacement worker atomically retains tombstones and original ordering across edit chains and reopen', async () => {
  const worker = await loadWorker();
  const seed = {
    users: [],
    chats: [],
    channels: [],
    documents: [],
    dialogFilters: [],
    topPeers: [],
    availableReactions: [],
    dialogs: { active: [{ id: '-1', topMessage: 3 }], archived: [] },
    messages: {
      '-1': [1, 2, 3].map((id) => ({ id, date: 100, out: true, message: `same-second-${id}` })),
    },
  };
  const client = { mockData: structuredClone(seed) };
  const sendReplacement = async (messageId, rootId, randomId, text) => {
    worker.registerShiyeSendIdentity(randomId, '-1', 3.000001 + Number(randomId) / 1e6, 100, {
      messageId,
      rootId,
      date: 100,
    });
    return worker.invokeLocalPreview(
      client,
      new worker.Api.messages.SendMessage({
        randomId,
        peer: { roomId: '-1' },
        message: text,
      }),
    );
  };
  const first = sendReplacement(2, 2, 1n, 'changed');
  assert.equal(
    client.mockData.messages['-1'].find((message) => message.id === 2).message,
    'same-second-2',
    'the live source survives until the atomic storage operation commits',
  );
  await first;
  assert.deepEqual(
    client.mockData.messages['-1'].map((message) => message.id),
    [1, 3, 4],
  );
  assert.equal(
    client.mockData.messages['-1'].find((message) => message.id === 4).replacesMessageId,
    2,
  );
  await sendReplacement(4, 2, 2n, 'changed-again');
  const reopened = await worker.loadLocalPreview(seed);
  const rows = [
    ...reopened.messages['-1'],
    ...reopened.shiyeWithdrawnMessages.map((item) => ({
      id: Number(item.messageId),
      date: Date.parse(item.sentAt) / 1000,
      orderRootId: item.orderRootId,
    })),
  ].sort(compareShiyeMessages);
  assert.deepEqual(
    rows.map((message) => message.id),
    [1, 2, 4, 5, 3],
  );
  assert.ok(rows.every((message) => message.date === 100));
  assert.equal(reopened.messages['-1'].find((message) => message.id === 5).orderRootId, 2);
  assert.equal(JSON.stringify(reopened.shiyeWithdrawnMessages).includes('same-second-2'), false);
});

test('replacement validation cannot change another room, sender, date or order root', async () => {
  const worker = await loadWorker();
  const seed = {
    users: [],
    chats: [],
    channels: [],
    documents: [],
    dialogs: { active: [], archived: [] },
    messages: {
      '-1': [
        { id: 1, date: 100, out: true, message: 'own' },
        { id: 2, date: 100, out: false, message: 'incoming' },
      ],
      '-2': [{ id: 3, date: 100, out: true, message: 'other-room' }],
    },
  };
  const client = { mockData: structuredClone(seed) };
  for (const [index, replacement] of [
    { messageId: 3, rootId: 3, date: 100 },
    { messageId: 2, rootId: 2, date: 100 },
    { messageId: 1, rootId: 99, date: 100 },
    { messageId: 1, rootId: 1, date: 101 },
  ].entries()) {
    const randomId = BigInt(index + 10);
    worker.registerShiyeSendIdentity(randomId, '-1', 3.000001, replacement.date, replacement);
    await assert.rejects(
      worker.invokeLocalPreview(
        client,
        new worker.Api.messages.SendMessage({
          randomId,
          peer: { roomId: '-1' },
          message: 'must-not-replace',
        }),
      ),
    );
  }
  assert.deepEqual(client.mockData.messages, seed.messages);
  assert.equal(client.mockData.shiyeWithdrawnMessages, undefined);
});

test('concurrent replacement submissions cannot branch and identical request replay keeps its durable ID', async () => {
  const worker = await loadWorker();
  const client = {
    mockData: {
      users: [],
      chats: [],
      channels: [],
      documents: [],
      dialogs: { active: [], archived: [] },
      messages: { '-1': [{ id: 1, date: 100, out: true, message: 'source' }] },
    },
  };
  const send = (randomId, text) => {
    worker.registerShiyeSendIdentity(randomId, '-1', 1.000001 + Number(randomId) / 1e6, 100, {
      messageId: 1,
      rootId: 1,
      date: 100,
    });
    return worker.invokeLocalPreview(
      client,
      new worker.Api.messages.SendMessage({
        randomId,
        peer: { roomId: '-1' },
        message: text,
      }),
    );
  };
  const results = await Promise.allSettled([
    send(20n, 'winner'),
    send(21n, 'conflicting changed text'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(client.mockData.messages['-1'].length, 1);
  const id = client.mockData.messages['-1'][0].id;
  const replay = await worker.invokeLocalPreview(
    client,
    new worker.Api.messages.SendMessage({
      randomId: 20n,
      peer: { roomId: '-1' },
      message: 'winner',
    }),
  );
  assert.equal(replay.id, id);
  assert.equal(client.mockData.messages['-1'].length, 1);
  await assert.rejects(
    worker.invokeLocalPreview(
      client,
      new worker.Api.messages.SendMessage({
        randomId: 20n,
        peer: { roomId: '-1' },
        message: 'different content',
      }),
    ),
    /不能改成不同内容/,
  );
});

// Exercise the actual updater merge, rather than reproducing its field logic.
const updater = await fs.readFile(
  new URL('global/actions/apiUpdaters/messages.ts', source),
  'utf8',
);
const merge = updater.match(
  /global = updateChatMessage\(global, chatId, message.id, \{[\s\S]*?previousLocalDate:[\s\S]*?\n      \}\);/,
)?.[0];
assert.ok(merge);
const confirm = new Function(
  'currentMessage',
  'message',
  'IS_MOCKED_CLIENT',
  'getShiyeMessageOrderDate',
  `let global; const chatId = '-1', localId = currentMessage.id;
   const updateChatMessage = (_global, _chat, _id, value) => value;
   ${merge} return global;`,
);
const ack = (local, id, date, mocked = true) =>
  confirm(local, { ...local, id, date }, mocked, getShiyeMessageOrderDate);
const ordered = (messages) => [...messages].sort(compareShiyeMessages).map((m) => m.name);
const a = { name: 'A', id: 13.000002, date: 100 };
const b = { name: 'B', id: 13.000003, date: 100 };

test('cross-second and either acknowledgement order preserve two local sends', () => {
  const confirmedA = ack(a, 14, 101);
  const confirmedB = ack(b, 15, 103);
  assert.equal(confirmedA.date, 101, 'real acknowledgement date remains available');
  for (const state of [
    [a, b],
    [confirmedA, b],
    [a, confirmedB],
    [confirmedA, confirmedB],
  ]) {
    assert.deepEqual(ordered(state), ['A', 'B']);
    assert.deepEqual(ordered([...state].reverse()), ['A', 'B']);
  }
  const laterB = { ...b, date: 101 };
  assert.deepEqual(ordered([laterB, ack(a, 14, 105)]), ['A', 'B']);
});

test('replacement resolves the root ACK alias before same-second neighbours in all four render phases', () => {
  const root = { id: 12, date: 100, chatId: '-1', previousLocalId: 11.000002, content: {} };
  const neighbour = { id: 13, date: 100, chatId: '-1', previousLocalId: 11.000003, content: {} };
  const pending = { id: 13.000004, date: 100, chatId: '-1', orderRootId: 12, replacesMessageId: 12, content: {} };
  const confirmed = { ...pending, id: 14, previousLocalId: pending.id };
  for (const rows of [
    [root, neighbour],
    [root, neighbour, pending],
    [root, neighbour, confirmed],
    [{ ...root, previousLocalId: undefined }, { ...neighbour, previousLocalId: undefined },
      { ...confirmed, previousLocalId: undefined }],
  ]) {
    const view = getShiyeUniqueMessages(rows).sort(compareShiyeMessages);
    const result = view.map((message) => message.id);
    assert.deepEqual(result, rows.length === 2 ? [12, 13] : [12, rows[2].id, 13]);
  }
  assert.equal(root.orderRootId, undefined);
  assert.equal(confirmed.orderRootId, 12, 'durable root identity is never rewritten to a fractional local alias');
});

test('a third local send based on acknowledged ID remains after the pending second send', () => {
  const c = { name: 'C', id: 14.000004, date: 100 };
  for (const state of [
    [ack(a, 14, 102), b, c],
    [ack(a, 14, 102), ack(b, 15, 103), c],
  ]) {
    assert.deepEqual(ordered([state[2], state[0], state[1]]), ['A', 'B', 'C']);
  }
});

test('history and inserted messages retain date priority; tuple comparison is transitive', () => {
  const messages = [
    { name: 'older-import', id: 80, date: 90 },
    ack(a, 14, 104),
    b,
    { name: 'inserted-between', id: 2, date: 101 },
    { name: 'later', id: -4, date: 110 },
  ];
  assert.deepEqual(ordered(messages), ['older-import', 'A', 'B', 'inserted-between', 'later']);
  for (const x of messages)
    for (const y of messages)
      for (const z of messages) {
        assert.equal(
          Math.sign(compareShiyeMessages(x, y)) + Math.sign(compareShiyeMessages(y, x)),
          0,
        );
        if (compareShiyeMessages(x, y) <= 0 && compareShiyeMessages(y, z) <= 0) {
          assert.ok(compareShiyeMessages(x, z) <= 0);
        }
      }
});

test('non-mock confirmation and rendering retain upstream date/id behavior', async () => {
  assert.equal(ack(a, 14, 101, false).previousLocalDate, undefined);
  const list = await fs.readFile(new URL('components/middle/MessageList.tsx', source), 'utf8');
  const fn = list.match(/function compareRenderedMessages\([\s\S]*?\n\}/)?.[0];
  const js = await transform(fn + '\nexport { compareRenderedMessages };', {
    loader: 'ts',
    format: 'esm',
  });
  const module = await import(
    'data:text/javascript;base64,' +
      Buffer.from(
        'const IS_MOCKED_CLIENT = false; const compareShiyeMessages = () => { throw Error("mock branch"); };\n' +
          js.code,
      ).toString('base64')
  );
  assert.ok(module.compareRenderedMessages(ack(a, 14, 101), b) > 0);
});

test('actual cache projection removes both transient ordering fields', async () => {
  const cache = await fs.readFile(new URL('global/cache.ts', source), 'utf8');
  const fn = cache.match(/function omitLocalMedia\([\s\S]*?\n\}/)?.[0];
  const js = await transform(fn + '\nexport { omitLocalMedia };', { loader: 'ts', format: 'esm' });
  const module = await import(
    'data:text/javascript;base64,' + Buffer.from(js.code).toString('base64')
  );
  const cached = module.omitLocalMedia({ ...ack(a, 14, 101), content: {} });
  const stored = JSON.parse(JSON.stringify(cached));
  assert.equal('previousLocalId' in stored, false);
  assert.equal('previousLocalDate' in stored, false);
  assert.equal(stored.date, 101);
});

test('cross-second and cross-midnight acknowledgement keep actual group identity without mutating global date', async () => {
  const grouped = await build({
    entryPoints: [fileURLToPath(new URL('components/middle/helpers/groupMessages.ts', source))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'group-environment',
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /(?:config|global\/helpers(?:\/replies)?|dates\/oldDateFormat|dates\/shiyeTime)$/,
            },
            (args) => ({ path: args.path, namespace: 'group-environment' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'group-environment' }, () => ({
            loader: 'js',
            contents: `export const IS_MOCKED_CLIENT=true;
            export const getMessageOriginalId=m=>m.previousLocalId??m.id;
            export const isActionMessage=()=>false;
            export const getMessageForumTopicId=()=>undefined;
            export const getDayStartAt=t=>Math.floor(t/86400000)*86400000;
            export const getShiyeTimeGapSeconds=()=>600;`,
          }));
        },
      },
    ],
  });
  const { groupMessages } = await import(
    'data:text/javascript;base64,' + Buffer.from(grouped.outputFiles[0].text).toString('base64')
  );
  for (const date of [100, 86399]) {
    const local = { ...a, date, chatId: '-1', content: {}, isOutgoing: true };
    const confirmed = ack(local, 14, date + 2);
    const before = groupMessages([local]);
    const view = getShiyeRenderedMessage(confirmed);
    const after = groupMessages([view]);
    assert.equal(after[0].datetime, before[0].datetime);
    assert.equal(after[0].originalDate, before[0].originalDate);
    assert.equal(confirmed.date, date + 2);
    assert.notEqual(view, confirmed);
    assert.equal(view.date, date);
  }
  const ordinary = { ...a, content: {} };
  assert.equal(getShiyeRenderedMessage(ordinary), ordinary);
  assert.equal(getShiyeMessageOrderDate({ ...ordinary, previousLocalDate: NaN }), ordinary.date);
  assert.ok(compareShiyeMessages({ ...ordinary, previousLocalDate: NaN }, { ...b, date: 101 }) < 0);
  assert.equal(
    getShiyeRenderedMessage({ ...ordinary, previousLocalDate: NaN }).date,
    ordinary.date,
  );
});

test('actual worker concurrent text sends persist increasing identities and reopen in committed order', async () => {
  const worker = await loadWorker();
  const seed = {
    users: [],
    chats: [],
    channels: [],
    dialogs: { active: [{ id: '-1', topMessage: 13 }], archived: [] },
    messages: { '-1': [{ id: 13, date: 90, message: 'history' }] },
    documents: [],
    dialogFilters: [],
    topPeers: [],
    availableReactions: [],
  };
  const client = { mockData: structuredClone(seed) };
  await Promise.all(
    ['A', 'B', 'C'].map((message) =>
      worker.invokeLocalPreview(
        client,
        new worker.Api.messages.SendMessage({ peer: { roomId: '-1' }, message }),
      ),
    ),
  );
  const reopened = await worker.loadLocalPreview(seed);
  assert.deepEqual(
    reopened.messages['-1'].map((m) => [m.id, m.message]),
    [
      [13, 'history'],
      [14, 'A'],
      [15, 'B'],
      [16, 'C'],
    ],
  );
  assert.deepEqual(
    [...reopened.messages['-1']].sort(compareShiyeMessages).map((m) => m.message),
    ['history', 'A', 'B', 'C'],
  );
  assert.equal(
    reopened.messages['-1'].some((m) => 'previousLocalDate' in m),
    false,
  );
});


test('120-message local viewport keeps replacement chains with their old root across paging and reload', async () => {
  const actions = await fs.readFile(new URL('global/actions/api/messages.ts', source), 'utf8');
  const functions = actions.slice(actions.indexOf('function findClosestIndex('));
  const end = functions.indexOf('\n}', functions.indexOf('function getViewportSlice(')) + 2;
  const js = await transform(functions.slice(0, end) + '\nexport { getViewportSlice };', { loader: 'ts', format: 'esm' });
  const module = await import('data:text/javascript;base64,' + Buffer.from(
    'const MESSAGE_LIST_SLICE=60;const LoadMoreDirection={Around:"around",Backwards:"backwards",Forwards:"forwards"};'
    + 'const getShiyeViewportGroups=' + getShiyeViewportGroups.toString() + ';' + js.code,
  ).toString('base64'));
  const slice = (ids, offset, direction, byId) => module.getViewportSlice(ids, offset, direction, byId).newViewportIds;
  const byId = Object.fromEntries(Array.from({ length: 120 }, (_, index) => {
    const id = index + 1;return [id, { id, chatId: '-1', date: id, content: {} }];
  }));
  byId[121] = { id: 121, date: 10, orderRootId: 10, replacesMessageId: 10 };
  byId[122] = { id: 122, date: 10, orderRootId: 10, replacesMessageId: 121 };
  for (const messages of [byId, structuredClone(byId)]) {
    const ids = Object.keys(messages).map(Number);
    const tail = slice(ids, undefined, 'around', messages);
    assert.ok(tail.includes(120));assert.ok(!tail.includes(10));assert.ok(!tail.includes(121));assert.ok(!tail.includes(122));
    const old = slice(ids, 122, 'around', messages);
    assert.ok([10, 121, 122].every(id => old.includes(id)));
    assert.equal(isShiyeViewportNewest(old, messages, 120), false);
    assert.equal(isShiyeViewportNewest(tail, messages, 120), true);
    assert.equal(getShiyeViewportOffset(old, messages, false), 40);
    const forward = slice(ids, getShiyeViewportOffset(old, messages, false), 'forwards', messages);
    assert.ok(forward.includes(100));assert.ok([10, 121, 122].every(id => forward.includes(id)));
    const final = slice(ids, getShiyeViewportOffset(forward, messages, false), 'forwards', messages);
    assert.ok(final.includes(120));assert.equal(isShiyeViewportNewest(final, messages, 120), true);
    const back = slice(ids, getShiyeViewportOffset(tail, messages, true), 'backwards', messages);
    const earlier = slice(ids, getShiyeViewportOffset(back, messages, true), 'backwards', messages);
    assert.ok([10, 121, 122].every(id => earlier.includes(id)));
  }
  assert.equal(isShiyeViewportNewest([119.1], { 120: { previousLocalId: 119.1 } }, 120), true);
  assert.equal(isShiyeViewportNewest([120], { 120: { previousLocalId: 119.1 } }, 119.1), true);
});


test('actual local viewport cap retains complete root groups rather than numeric replacement tails', async () => {
  const reducer = await fs.readFile(new URL('global/reducers/messages.ts', source), 'utf8');
  const fn = reducer.slice(reducer.indexOf('export function addViewportId'), reducer.indexOf('export function safeReplaceViewportIds'));
  const js = await transform(fn, { loader: 'ts', format: 'esm' });
  const module = await import('data:text/javascript;base64,' + Buffer.from(
    'const IS_MOCKED_CLIENT=true,MESSAGE_LIST_SLICE=60,MESSAGE_LIST_VIEWPORT_LIMIT=120;'
    + 'const selectViewportIds=g=>g.ids;const selectChatMessages=g=>g.byId;'
    + 'const orderHistoryIds=ids=>[...new Set(ids)].sort((a,b)=>a-b);'
    + 'const replaceTabThreadParam=(g,c,t,k,ids)=>({...g,ids});'
    + 'const getCurrentTabId=()=>1;const getShiyeViewportGroups=' + getShiyeViewportGroups.toString() + ';' + js.code,
  ).toString('base64'));
  const byId = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [i + 1, { id: i + 1 }]));
  byId[121] = { id: 121, orderRootId: 10 };
  byId[122] = { id: 122, orderRootId: 10 };
  byId[123] = { id: 123 };
  const ids = Object.keys(byId).map(Number).filter(id => id !== 123);
  const next = module.addViewportId({ ids, byId }, '-1', -1, 123);
  assert.ok(next.ids.includes(120)&&next.ids.includes(123));
  assert.ok([10,121,122].every(id => !next.ids.includes(id)));
  const replacement = module.addViewportId({ ids: ids.filter(id => id !== 122), byId }, '-1', -1, 122);
  assert.ok([10,121,122].every(id => replacement.ids.includes(id)));
  assert.ok(replacement.ids.includes(120));
});
