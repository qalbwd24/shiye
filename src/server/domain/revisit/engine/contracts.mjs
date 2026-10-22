/** Engine contracts are independent of diary storage, transport and content rendering. */
export const REVISIT_ENGINE_VERSION = 1;

/**
 * @typedef {{entryId:string, unitId:string, snapshot?:string}} SourceRef
 * @typedef {{ref:SourceRef, eventTime:{instant:string}, category:string}} RevisitSource
 * @typedef {{interval:{unit:'year'|'month'|'day',count:number},categories:string[]}} RevisitRule
 * @typedef {{after:number,through:number}} RevisitWindow UTC milliseconds; (after, through].
 * @typedef {{ref:SourceRef,replayAt:string,originalAt:string}} RevisitOccurrence
 * @typedef {{minute:number,occurrences:RevisitOccurrence[]}} RevisitPlanGroup
 */

export function assertInterval(interval) {
  if (
    !['year', 'month', 'day'].includes(interval?.unit) ||
    !Number.isInteger(interval.count) ||
    interval.count < 1 ||
    interval.count > 3660
  )
    throw new RangeError('回看间隔不正确');
}

export function isUTCInstant(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const normalized = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, digits) => `.${(digits || '').padEnd(3, '0')}Z`,
  );
  return new Date(value).toISOString() === normalized;
}

export function assertEngineRequest(request) {
  if (!request || request.version !== REVISIT_ENGINE_VERSION)
    throw new RangeError('不支持的回看引擎契约版本');
  assertInterval(request.rule?.interval);
  if (
    !Array.isArray(request.rule.categories) ||
    request.rule.categories.some((category) => typeof category !== 'string')
  )
    throw new TypeError('回看分类须为字符串列表');
  if (
    !request.window ||
    !Number.isFinite(request.window.after) ||
    !Number.isFinite(request.window.through) ||
    request.window.through < request.window.after
  )
    throw new RangeError('回看时间窗口不正确');
  if (typeof request.timeZone !== 'string' || request.timeZone === 'system')
    throw new RangeError('宿主须先解析回看时区');
  new Intl.DateTimeFormat('en-CA', { timeZone: request.timeZone });
  if (!Array.isArray(request.sources)) throw new TypeError('回看来源须为列表');
  for (const source of request.sources) {
    if (
      !source ||
      typeof source.ref?.entryId !== 'string' ||
      !source.ref.entryId ||
      typeof source.ref.unitId !== 'string' ||
      !source.ref.unitId ||
      typeof source.category !== 'string' ||
      !isUTCInstant(source.eventTime?.instant)
    )
      throw new TypeError('回看来源契约不正确');
  }
}
