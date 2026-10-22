import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopController } from './lib/desktop-maintenance.mjs';
import { windowsDesktopRuntime } from './lib/desktop-runtime.mjs';

export function parseControlArguments(args) {
  const [command, ...rest] = args;
  if (
    ![
      'status',
      'doctor',
      'stop',
      'start',
      'restart',
      'upgrade',
      'rollback',
      'recover-lock',
      'help',
    ].includes(command)
  )
    throw Error(
      '用法：desktop-control status|doctor|help [--human]；stop|start|restart|upgrade --from <候选目录>|rollback --backup <备份目录> [--dry-run] [--no-start]',
    );
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i];
    if (value === '--human') {
      if (!['status', 'doctor', 'help'].includes(command))
        throw Error('--human 只用于 status、doctor 或 help');
      if (options.human) throw Error('重复选项：--human');
      options.human = true;
    } else if (value === '--dry-run' || value === '--no-start') {
      if (!['upgrade', 'rollback'].includes(command)) throw Error('此选项只用于升级或回滚');
      const key = value === '--dry-run' ? 'dryRun' : 'noStart';
      if (key in options) throw Error('重复选项：' + value);
      options[key] = true;
    } else if (value === '--from' || value === '--backup') {
      if (
        (value === '--from' && command !== 'upgrade') ||
        (value === '--backup' && command !== 'rollback')
      )
        throw Error('目录选项与命令不匹配');
      if (options.source || !rest[i + 1] || rest[i + 1].startsWith('--'))
        throw Error('缺少或重复目录参数');
      options.source = rest[++i];
    } else throw Error('未知参数：' + value);
  }
  if (['upgrade', 'rollback'].includes(command) && !options.source)
    throw Error('必须指定候选或备份目录');
  return { command, options };
}

export async function runControl(args, controller) {
  const { command, options } = parseControlArguments(args);
  if (command === 'help')
    return {
      commands: [
        'status',
        'doctor',
        'status|doctor|help --human',
        'stop',
        'start',
        'restart',
        'recover-lock',
        'upgrade --from <candidate> [--dry-run] [--no-start]',
        'rollback --backup <snapshot> [--dry-run] [--no-start]',
      ],
      scope: '聊天与托盘；不重启日记 API，不迁移数据',
    };
  if (command === 'upgrade' || command === 'rollback')
    return controller[command](options.source, options);
  if (command === 'recover-lock') return controller.recoverLock();
  return controller[command]();
}

export function formatControlHuman(result) {
  if (result.commands) return result.commands.join('\n') + '\n范围：' + result.scope;
  if (result.readOnly && !result.status)
    return (
      '运行状态未知；未执行任何操作\n' +
      result.issues.map((issue) => `[${issue.code}] ${issue.message}`).join('\n') +
      '\n下一步：' +
      result.nextAction.reason
    );
  const state = result.status || result;
  const hasChat = state.processes?.some(
    (item) => path.basename(item.executablePath || '') === '拾页对话预览.exe',
  );
  const lines = [
    '安装 UI：' + (state.installed?.revision || '未安装'),
    '运行 UI：' + (state.readiness?.runningRevision || (hasChat ? '尚未就绪' : '已退出')),
    '聊天/托盘：' +
      (state.processes?.length ? `${state.processes.length} 个进程` : '已退出，无需保存退出'),
    '日记 API：' +
      (state.api?.reachable ? `运行中 ${state.api.version || '版本未知'}` : '不可达') +
      '（本入口不更新 API）',
    '维护锁：' + (state.maintenanceLock ? '存在，先核对 doctor' : '无'),
  ];
  const operation = state.lastOperation;
  if (operation) {
    lines.push(`最近维护：${operation.id} / ${operation.phase}`);
    if (operation.failedPhase)
      lines.push(
        `失败动作：${operation.failedPhase}；最后成功阶段：${operation.lastSuccessfulPhase || '未知'}`,
      );
    if (operation.backup) lines.push('备份：' + operation.backup);
  }
  for (const issue of result.issues || []) lines.push(`[${issue.code}] ${issue.message}`);
  const next = result.nextAction || operation?.nextAction;
  if (next)
    lines.push(
      `下一步：${next.command || '核对现场'}${next.args?.length ? ' ' + next.args.join(' ') : ''}；${next.reason}；${next.automaticAllowed ? '可由代理按授权继续' : '不可自动恢复或安装'}`,
    );
  return lines.join('\n');
}

export function controlFailure(error) {
  return {
    ok: false,
    error: error.message,
    ...(error.diagnostics || {
      nextAction: {
        command: 'doctor',
        args: [],
        automaticAllowed: false,
        reason: '先只读诊断；未确认的失败不自动重试安装',
      },
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const args = process.argv.slice(2);
    const { options } = parseControlArguments(args);
    const result = await runControl(
      args,
      createDesktopController({ root, runtime: windowsDesktopRuntime(root) }),
    );
    process.stdout.write(
      (options.human ? formatControlHuman(result) : JSON.stringify(result, null, 2)) + '\n',
    );
  } catch (error) {
    process.stderr.write(JSON.stringify(controlFailure(error)) + '\n');
    process.exitCode = 1;
  }
}
