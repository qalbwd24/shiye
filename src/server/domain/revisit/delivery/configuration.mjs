import { fail } from '../../../http.mjs';
import { digest } from '../sources/identity.mjs';
import { validDailyTime, validSourceDate } from './daily-random.mjs';
import {
  DEFAULT_REVISIT_CONFIG as defaults,
  revisitConfig,
  ensureRevisitState as ensure,
} from './state.mjs';
export function configureRevisit(db, input) {
  if (!input || input.expectedRevision !== revisitConfig(db).revision)
    throw fail(409, '回看设置已变化，请重新读取');
  const config = { ...revisitConfig(db), ...input, version: 1 };
  delete config.expectedRevision;
  if (
    (config.mode !== undefined && !['interval', 'daily-random'].includes(config.mode)) ||
    (config.dailyTime !== undefined && !validDailyTime(config.dailyTime))
  )
    throw fail(400, '回看方式或每日更新时间不正确');
  if (
    ['sourceDateFrom', 'sourceDateTo'].some(
      (key) => config[key] !== undefined && config[key] !== null && !validSourceDate(config[key]),
    ) ||
    (config.sourceDateFrom && config.sourceDateTo && config.sourceDateFrom > config.sourceDateTo)
  )
    throw fail(400, '历史来源范围须为有效YYYY-MM-DD日期，起始不能晚于结束');
  if (
    !['year', 'month', 'day'].includes(config.interval?.unit) ||
    !Number.isInteger(config.interval.count) ||
    config.interval.count < 1 ||
    config.interval.count > 3660
  )
    throw fail(400, '回看间隔不正确');
  if (!['Asia/Shanghai', 'system'].includes(config.timeZone) || typeof config.enabled !== 'boolean')
    throw fail(400, '时区或开关不正确');
  if (
    !Array.isArray(config.categories) ||
    config.categories.some((category) => !db.categories.includes(category))
  )
    throw fail(400, '回看分类已变化');
  if (
    typeof config.title !== 'string' ||
    !config.title.trim() ||
    config.title.length > 80 ||
    typeof config.sender?.name !== 'string' ||
    !config.sender.name.trim() ||
    config.sender.name.length > 80
  )
    throw fail(400, '名称须为1–80个字符');
  if (
    config.sender.avatarAssetId &&
    !db.media.some(
      (asset) => asset.id === config.sender.avatarAssetId && asset.type?.startsWith('image/'),
    )
  )
    throw fail(400, '发送者头像不存在');
  const old = revisitConfig(db);
  const changedRule =
    digest([
      old.interval,
      old.timeZone,
      [...old.categories].sort(),
      old.mode || 'interval',
      old.dailyTime || '08:00',
      old.sourceDateFrom ?? null,
      old.sourceDateTo ?? null,
    ]) !==
    digest([
      config.interval,
      config.timeZone,
      [...config.categories].sort(),
      config.mode || 'interval',
      config.dailyTime || '08:00',
      config.sourceDateFrom ?? null,
      config.sourceDateTo ?? null,
    ]);
  const state = ensure(db);
  state.config = {
    ...defaults,
    title: config.title.trim(),
    enabled: config.enabled,
    revision: old.revision + 1,
    ruleRevision: (old.ruleRevision || 1) + Number(changedRule),
    interval: { unit: config.interval.unit, count: config.interval.count },
    ...(config.sourceDateFrom !== undefined ? { sourceDateFrom: config.sourceDateFrom } : {}),
    ...(config.sourceDateTo !== undefined ? { sourceDateTo: config.sourceDateTo } : {}),
    ...(config.mode !== undefined
      ? { mode: config.mode, dailyTime: config.dailyTime || '08:00' }
      : {}),
    categories: [...new Set(config.categories)],
    timeZone: config.timeZone,
    sender: {
      id: 'revisit',
      name: config.sender.name.trim(),
      avatarAssetId: config.sender.avatarAssetId || null,
    },
  };
  // A changed rule starts a new cursor; existing batches and comments keep their fixed targets.
  if (changedRule || old.enabled !== config.enabled) state.cursor = null;
  return revisitConfig(db);
}
