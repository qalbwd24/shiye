import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './helpers.mjs';
import { createRoutes, resolveVideoRuntime } from '../src/server/routes/media-compression.mjs';
const exec = promisify(execFile);
let runtime;
try {
  runtime = await resolveVideoRuntime();
} catch {
  /* Optional external runtime is not bundled. */
}
const skip = runtime ? false : 'External FFmpeg/FFprobe runtime not installed';
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function upload(base, bytes, quality = 'balanced') {
  const response = await fetch(base + '/api/media-compression-upload?quality=' + quality, {
    method: 'POST',
    headers: {
      'X-Diary-Client': 'desktop',
      'Content-Type': 'video/mp4',
      'X-File-Name': encodeURIComponent('合成测试视频.mp4'),
      'X-File-Last-Modified': '1609459200000',
    },
    body: bytes,
  });
  assert.equal(response.status, 202);
  return response.json();
}
async function finished(request, id) {
  for (let i = 0; i < 300; i++) {
    const response = await request('/api/media-compression/' + id);
    assert.equal(response.status, 200);
    const value = await response.json();
    if (['done', 'error'].includes(value.state)) return value;
    await delay(100);
  }
  throw Error('Synthetic video job timed out');
}
test(
  'done and error stay unpublished while staged-file cleanup is blocked',
  { skip, timeout: 10000 },
  async (t) => {
    for (const terminal of ['done', 'error']) {
      await t.test(terminal, async (subtest) => {
        const { dir } = await fixture(subtest);
        const staging = path.join(dir, 'media-staging');
        const bytes = Buffer.from('synthetic duplicate upload');
        const existing = {
          id: 'existing-media',
          originalSha256: createHash('sha256').update(bytes).digest('hex'),
          compressionQuality: 'balanced',
        };
        const entered = deferred(),
          release = deferred(),
          unlinked = deferred();
        const unlink = fs.unlink;
        subtest.mock.method(fs, 'unlink', async (file) => {
          if (path.dirname(file) === staging && file.endsWith('.uploading')) {
            entered.resolve();
            await release.promise;
            try {
              return await unlink(file);
            } finally {
              unlinked.resolve();
            }
          }
          return unlink(file);
        });
        const route = createRoutes({
          dataDir: dir,
          getDb: () => {
            if (terminal === 'error') throw Error('Synthetic processing failure');
            return { media: [existing] };
          },
          mutate: () => assert.fail('Duplicate/failed job must not mutate media'),
          reply: (res, status, value) => {
            res.status = status;
            res.value = value;
          },
          fail: (status, message) => Object.assign(Error(message), { status }),
        });
        const accepted = {};
        await route(
          {
            method: 'POST',
            url: '/api/media-compression-upload?quality=balanced',
            headers: { 'content-type': 'video/mp4' },
            async *[Symbol.asyncIterator]() {
              yield bytes;
            },
          },
          accepted,
          '/api/media-compression-upload',
        );
        assert.equal(accepted.status, 202);
        const request = async (url) => {
          const res = {};
          await route({ method: 'GET' }, res, url);
          return { status: res.status, json: async () => res.value };
        };
        try {
          await entered.promise;
          const during = await (
            await request('/api/media-compression/' + accepted.value.id)
          ).json();
          assert.equal(during.state, 'processing');
          assert.ok(during.progress < 1);
          assert.deepEqual(await fs.readdir(staging), [accepted.value.id + '.uploading']);
        } finally {
          release.resolve();
          await unlinked.promise;
        }
        const result = await finished(request, accepted.value.id);
        assert.equal(result.state, terminal);
        assert.deepEqual(await fs.readdir(staging), []);
        if (terminal === 'done') assert.equal(result.media.id, existing.id);
        else assert.match(result.error, /Synthetic processing failure/);
      });
    }
  },
);
test(
  'video compression retains frame rate, audio and capture time and registers only the smaller result',
  { skip },
  async (t) => {
    const { dir, base, request } = await fixture(t);
    const input = path.join(dir, 'synthetic-source.mp4');
    await exec(
      runtime.ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1600x900:rate=12',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '0',
        '-c:a',
        'aac',
        '-metadata',
        'creation_time=2001-02-03T04:05:06Z',
        input,
      ],
      { windowsHide: true, timeout: 30000 },
    );
    const bytes = await fs.readFile(input);
    const accepted = await upload(base, bytes);
    assert.ok(['queued', 'processing'].includes(accepted.state));
    const done = await finished(request, accepted.id);
    assert.equal(done.state, 'done', done.error);
    assert.ok(done.media.size < bytes.length);
    assert.equal(done.media.compressed, true);
    assert.equal(done.media.originalSize, bytes.length);
    assert.equal(done.media.lastModified, 1609459200000);
    assert.equal(Date.parse(done.media.creationTime), Date.parse('2001-02-03T04:05:06Z'));
    const output = path.join(dir, 'media', done.media.id);
    const probe = JSON.parse(
      (
        await exec(
          runtime.ffprobe,
          ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output],
          { windowsHide: true },
        )
      ).stdout,
    );
    const video = probe.streams.find((s) => s.codec_type === 'video');
    assert.equal(video.codec_name, 'h264');
    assert.ok(Math.max(video.width, video.height) <= 1280);
    assert.equal(video.r_frame_rate, '12/1');
    assert.ok(probe.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'));
    assert.equal(Date.parse(probe.format.tags.creation_time), Date.parse('2001-02-03T04:05:06Z'));
    const again = await finished(request, (await upload(base, bytes)).id);
    assert.equal(again.media.id, done.media.id);
    assert.equal((await (await request('/api/library')).json()).media.length, 1);
    assert.deepEqual(await fs.readdir(path.join(dir, 'media-staging')), []);
    assert.deepEqual(await fs.readFile(input), bytes);
  },
);
test('failed video jobs clean staging and do not register broken media', { skip }, async (t) => {
  const { dir, base, request } = await fixture(t);
  const done = await finished(request, (await upload(base, Buffer.from('not a video'))).id);
  assert.equal(done.state, 'error');
  assert.ok(done.error);
  assert.equal((await (await request('/api/library')).json()).media.length, 0);
  assert.deepEqual(await fs.readdir(path.join(dir, 'media-staging')), []);
  const invalid = await fetch(base + '/api/media-compression-upload?quality=impossible', {
    method: 'POST',
    headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'video/mp4' },
    body: Buffer.from('invalid'),
  });
  assert.equal(invalid.status, 400);
});
test(
  'tiny video stays byte-identical when transcoding would increase its size',
  { skip },
  async (t) => {
    const { dir, base, request } = await fixture(t);
    const input = path.join(dir, 'tiny-source.mp4');
    await exec(
      runtime.ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:size=16x16:rate=1',
        '-frames:v',
        '1',
        '-c:v',
        'libx264',
        '-preset',
        'veryslow',
        '-crf',
        '51',
        '-an',
        '-bsf:v',
        'filter_units=remove_types=6',
        input,
      ],
      { windowsHide: true, timeout: 30000 },
    );
    const bytes = await fs.readFile(input);
    const done = await finished(request, (await upload(base, bytes, 'high')).id);
    assert.equal(done.state, 'done', done.error);
    assert.equal(done.media.compressed, false);
    assert.equal(done.media.size, bytes.length);
    assert.equal(done.reason, '压缩结果未变小，已保存原件');
    assert.deepEqual(await fs.readFile(path.join(dir, 'media', done.media.id)), bytes);
    assert.deepEqual(await fs.readdir(path.join(dir, 'media-staging')), []);
  },
);
