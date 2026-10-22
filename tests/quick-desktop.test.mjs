import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

const root = fileURLToPath(new URL('../', import.meta.url));

test(
  'Windows quick hosts open independently and each waits for its own web save approval',
  {
    skip:
      process.platform !== 'win32' ||
      (process.env.SHIYE_TEST_NO_DESKTOP === '1' && '本轮只允许数据层与无界面隔离测试'),
    timeout: 60000,
  },
  async (t) => {
    // Never launch the installed executable or use data/. Each run compiles its own host.
    await mkdir(path.join(root, 'tmp'), { recursive: true });
    const folder = await mkdtemp(path.join(root, 'tmp', 'shiye-quick-host-'));
    const executable = path.join(folder, 'QuickCaptureTest.exe');
    const vendor = path.join(root, 'desktop', 'vendor', 'webview2');
    const compiler = path.join(
      process.env.WINDIR,
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    );
    const result = spawnSync(
      compiler,
      [
        '/nologo',
        '/target:winexe',
        '/platform:x64',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Web.dll',
        '/reference:System.Web.Extensions.dll',
        `/reference:${path.join(vendor, 'Microsoft.Web.WebView2.Core.dll')}`,
        `/reference:${path.join(vendor, 'Microsoft.Web.WebView2.WinForms.dll')}`,
        `/out:${executable}`,
        path.join(root, 'desktop', 'QuickCapture.cs'),
        path.join(root, 'desktop', 'QuickHost.cs'),
        path.join(root, 'desktop', 'DesktopPaths.cs'),
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const name of [
      'Microsoft.Web.WebView2.Core.dll',
      'Microsoft.Web.WebView2.WinForms.dll',
      'WebView2Loader.dll',
    ])
      await copyFile(path.join(vendor, name), path.join(folder, name));
    const selfTest = spawnSync(executable, ['--self-test'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(selfTest.status, 0, selfTest.stdout + selfTest.stderr);

    const events = [];
    const released = new Set();
    const controls = new Map();
    let pages = 0;
    async function waitFor(predicate, message) {
      const deadline = Date.now() + 25000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, message);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const server = createServer((req, res) => {
      if (req.url === '/api/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"id":"diary-desktop-preview"}');
      } else if (req.url === '/startup-theme.json?quick=1') {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"theme":"dark"}');
      } else if (req.url.startsWith('/event/')) {
        const event = req.url.slice('/event/'.length);
        events.push(event);
        res.end('ok');
      } else if (req.url.startsWith('/control/')) {
        const page = Number(req.url.slice('/control/'.length));
        res.end(controls.get(page) || (released.has(page) ? 'close' : 'wait'));
      } else if (req.url.startsWith('/?quick=1')) {
        const page = ++pages;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><meta charset="utf-8"><title>Synthetic host test</title><script>
        let attempts = 0, zoomChecked = false;
        async function trace(value) { await fetch('/event/${page}/' + value); }
        chrome.webview.addEventListener('message', async ({data}) => {
          if (data.type === 'backgrounded') await trace('backgrounded');
          if (data.type === 'focus-editor' && ${page} >= 8) await trace('restored');
          if (data.type === 'window-state' && ${page} >= 8) await trace('resume-hours-' + data.resumeHours);
          if (data.type === 'test-zoom-state') {
            if (${page} >= 5) {
              await trace('zoom-observed-' + data.factor);
              const expected = !zoomChecked ? (${page} === 5 ? 1.28 : ${page} === 6 ? 1.32 : 1.36) : (${page} === 5 ? 1.32 : 1.36);
              await trace(Math.abs(data.factor-expected)<0.001?'zoom-restored':'zoom-failed');
              if (!zoomChecked && ${page} < 7) {
                zoomChecked = true;
                chrome.webview.postMessage({type:'zoom-step',step:1});
                chrome.webview.postMessage({type:'test-zoom-state'});
              }
              return;
            }
            if (!zoomChecked) {
              zoomChecked = true;
              await trace(Math.abs(data.factor-1.04)<0.001?'zoom-up':'zoom-failed');
              chrome.webview.postMessage({type:'zoom-step',step:0});
              chrome.webview.postMessage({type:'test-zoom-state'});
            } else await trace(data.factor===1?'zoom-reset':'zoom-failed');
          }
          if (data.type === 'test-theme-state') {
            await trace(data.dark && data.background === '#20292E' ? 'startup-dark' : 'startup-theme-failed');
          }
          if (data.type === 'new-entry') await trace('unexpected-new-entry');
          if (data.type === 'request-close') {
            attempts++;
            await trace('request-close-' + attempts);
            if (attempts === 1) {
              chrome.webview.postMessage({type:'close-failed'});
              setTimeout(async () => {
                await trace('alive-after-failure');
                chrome.webview.postMessage({type:'test-close'});
              }, 250);
            } else {
              await trace('approve');
              chrome.webview.postMessage({type:'close-ready'});
            }
          }
        });
        chrome.webview.postMessage({type:'ready'});
        chrome.webview.postMessage({type:'test-theme-state'});
        if (${page} < 5) chrome.webview.postMessage({type:'zoom-step',step:1});
        chrome.webview.postMessage({type:'test-zoom-state'});
        trace('ready');
        const control = setInterval(async () => {
          const command = await (await fetch('/control/${page}')).text();
          if (command === 'disable-retention') {
            clearInterval(control);
            chrome.webview.postMessage({type:'set-resume-hours',hours:0});
            chrome.webview.postMessage({type:'test-close'});
          } else if (command === 'close') {
            clearInterval(control);
            chrome.webview.postMessage({type:'test-close'});
          }
        }, 100);
      </script>`);
      } else res.end('');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const stateDirectory = path.join(folder, 'state');
    await mkdir(stateDirectory);
    const args = [
      `--url=http://127.0.0.1:${server.address().port}`,
      `--state-dir=${stateDirectory}`,
      '--bridge-test',
    ];
    const children = [];
    t.after(() => {
      for (const child of children) if (child.exitCode === null) child.kill();
    });
    function launch() {
      const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' });
      children.push(child);
      child.once('error', (error) => events.push(`spawn-error:${error.message}`));
      return child;
    }
    async function waitForInitialZoom(page) {
      await waitFor(
        () =>
          events.includes(`${page}/zoom-failed`) ||
          (events.includes(`${page}/zoom-up`) && events.includes(`${page}/zoom-reset`)),
        `Host ${page} did not finish its initial zoom round trip`,
      );
      assert.ok(!events.includes(`${page}/zoom-failed`), `Host ${page} initial zoom failed`);
    }
    const first = launch();
    await waitFor(() => events.includes('1/ready'), 'First host did not initialize WebView2');
    // Both hosts share zoom preferences. ready may arrive while the first has
    // persisted 1.04 but is still awaiting trace() before resetting to 1.00.
    await waitForInitialZoom(1);
    const second = launch();
    await waitFor(
      () => events.includes('2/ready'),
      'Second launch did not open an independent window',
    );
    await waitForInitialZoom(2);
    assert.equal(first.exitCode, null);
    assert.equal(second.exitCode, null);
    assert.notEqual(first.pid, second.pid);
    await waitFor(
      () => events.includes('1/startup-dark') && events.includes('2/startup-dark'),
      'Hosts did not use dark startup surfaces before a page theme message',
    );
    released.add(1);
    await waitFor(() => first.exitCode !== null, 'First host did not close after approval');
    assert.equal(first.exitCode, 0);
    assert.equal(second.exitCode, null, 'Closing the first window must keep the second alive');
    released.add(2);
    await waitFor(() => second.exitCode !== null, 'Second host did not close after approval');
    assert.equal(second.exitCode, 0);
    for (const page of [1, 2]) {
      assert.ok(events.includes(`${page}/zoom-up`) && events.includes(`${page}/zoom-reset`));
      assert.ok(!events.includes(`${page}/zoom-failed`));
      assert.deepEqual(
        events.filter(
          (event) =>
            event.startsWith(`${page}/`) &&
            !event.endsWith('/startup-dark') &&
            !event.includes('/zoom-'),
        ),
        ['ready', 'request-close-1', 'alive-after-failure', 'request-close-2', 'approve'].map(
          (event) => `${page}/${event}`,
        ),
      );
    }
    // A resident broker accepts intents from short-lived launcher processes.
    const residentArgs = args.filter((value) => value !== '--bridge-test');
    const resident = spawn(executable, [...residentArgs, '--host-test', '--resident'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    children.push(resident);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const invoke = (command) =>
      spawnSync(executable, [...residentArgs, command], { encoding: 'utf8', windowsHide: true });
    assert.equal(invoke('--toggle').status, 0);
    await waitFor(() => events.includes('3/ready'), 'Resident toggle did not open a window');
    await waitForInitialZoom(3);
    assert.equal(resident.exitCode, null);
    assert.equal(
      spawnSync(executable, [...residentArgs, '--new-window'], {
        encoding: 'utf8',
        windowsHide: true,
      }).status,
      0,
    );
    await waitFor(
      () => events.includes('4/ready'),
      'New-window intent did not reach the same host',
    );
    await waitForInitialZoom(4);
    released.add(3);
    released.add(4);
    await waitFor(
      () => events.includes('3/approve') && events.includes('4/approve'),
      'Resident windows did not save before close',
    );
    assert.equal(resident.exitCode, null, 'Closing all editors must keep the hotkey broker alive');
    assert.equal(invoke('--exit-host').status, 0);
    await waitFor(() => resident.exitCode !== null, 'Explicit resident exit did not finish');
    assert.equal(resident.exitCode, 0);
    const settings = JSON.parse(
      await readFile(path.join(stateDirectory, 'quick-window.json'), 'utf8'),
    );
    assert.deepEqual(Object.keys(settings).sort(), [
      'Height',
      'TopMost',
      'Width',
      'X',
      'Y',
      'ZoomFactor',
    ]);
    assert.equal(settings.ZoomFactor, 1);
    assert.ok(settings.Width >= 400 && settings.Height >= 360);
    await writeFile(
      path.join(stateDirectory, 'quick-window.json'),
      JSON.stringify({ ...settings, ZoomFactor: 1.28 }),
    );
    const fifth = launch();
    await waitFor(
      () =>
        events.filter((event) => event === '5/zoom-restored').length === 2 ||
        events.includes('5/zoom-failed'),
      'Saved zoom was not restored and adjusted',
    );
    assert.ok(
      !events.includes('5/zoom-failed'),
      'Persisted zoom must survive actual WebView navigation: ' +
        events.filter((event) => event.startsWith('5/')).join(', '),
    );
    // A successful zoom command is durable before any close/debounce timer.
    assert.equal(
      JSON.parse(await readFile(path.join(stateDirectory, 'quick-window.json'), 'utf8')).ZoomFactor,
      1.32,
    );
    const sixth = launch();
    await waitFor(
      () =>
        events.filter((event) => event === '6/zoom-restored').length === 2 ||
        events.includes('6/zoom-failed'),
      'New window did not restore and adjust zoom',
    );
    assert.ok(
      !events.includes('6/zoom-failed'),
      'Closing and reopening must retain the last ratio',
    );
    released.add(6);
    await waitFor(() => sixth.exitCode !== null, 'Reopened zoom editor did not close');
    released.add(5);
    await waitFor(() => fifth.exitCode !== null, 'Older zoom editor did not close after save');
    assert.equal(
      JSON.parse(await readFile(path.join(stateDirectory, 'quick-window.json'), 'utf8')).ZoomFactor,
      1.36,
      'Closing the older window must not overwrite the newer ratio',
    );
    const seventh = launch();
    await waitFor(
      () => events.includes('7/zoom-restored') || events.includes('7/zoom-failed'),
      'Last saved zoom did not survive closing all windows and restarting',
    );
    assert.ok(!events.includes('7/zoom-failed'));
    released.add(7);
    await waitFor(() => seventh.exitCode !== null, 'Final zoom editor did not close');
    const resumeArgs = [...residentArgs, '--host-test'];
    const resumeHost = spawn(executable, [...resumeArgs, '--resident'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    children.push(resumeHost);
    const resumeInvoke = (command) =>
      spawnSync(executable, [...resumeArgs, ...(command ? [command] : [])], {
        encoding: 'utf8',
        windowsHide: true,
      });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(resumeInvoke('--new-window').status, 0);
    await waitFor(() => events.includes('8/ready'), 'Retention window did not open');
    released.add(8);
    await waitFor(
      () => events.includes('8/backgrounded'),
      'Normal close did not save then retain the window',
    );
    assert.ok(
      events.includes('8/alive-after-failure'),
      'Failed save must keep the window before backgrounding',
    );
    assert.equal(resumeInvoke().status, 0);
    await waitFor(
      () => events.includes('8/restored'),
      'Default launch did not resume retained WebView',
    );
    assert.equal(pages, 8, 'Resume must not load a new page');
    assert.equal(resumeInvoke('--test-hide-recent').status, 0);
    await waitFor(
      () => events.filter((event) => event === '8/backgrounded').length === 2,
      'Second close did not retain the same window',
    );
    assert.equal(resumeInvoke('--test-expire-background').status, 0);
    assert.equal(resumeInvoke().status, 0);
    await waitFor(
      () => events.includes('9/ready'),
      'After expiry, opening must load a fresh choice page',
    );
    assert.equal(resumeInvoke('--test-expire-background').status, 0);
    assert.equal(resumeInvoke().status, 0);
    await waitFor(
      () => events.includes('9/restored'),
      'Elapsed time must not discard a still-open editor',
    );
    assert.equal(pages, 9);
    controls.set(9, 'disable-retention');
    await waitFor(() => events.includes('9/approve'), 'Zero-retention window did not save');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      JSON.parse(await readFile(path.join(stateDirectory, 'quick-host.json'), 'utf8')).ResumeHours,
      0,
    );
    assert.equal(resumeInvoke().status, 0);
    await waitFor(() => events.includes('10/ready'), 'Disabled retention must open a new page');
    released.add(10);
    await waitFor(() => events.includes('10/approve'), 'Last editor did not save');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(resumeInvoke('--exit-host').status, 0);
    await waitFor(
      () => resumeHost.exitCode !== null,
      'Explicit exit did not destroy the resident host',
    );
    assert.equal(resumeHost.exitCode, 0);
  },
);
