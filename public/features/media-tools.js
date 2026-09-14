import { LIMITS } from '../shared/limits.js';

/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createMediaTools(c) {
  const { $, modal, closeModal, toast, textOf } = c;
  let recorder = null,
    recordStream = null,
    speechParts = [];
  async function recording() {
    if (!c.current() || c.current().deleted) return;
    modal(
      '录音日记',
      '<p>点击开始后申请麦克风权限。音频只保存到本机；单次录音上限 100 MB。</p><button class="primary" id="startRecord">开始录音</button><button class="secondary" id="stopRecord" disabled>停止并保存</button><p role="status" id="recordStatus">尚未开始</p>',
    );
    const status = $('#recordStatus'),
      start = $('#startRecord'),
      stop = $('#stopRecord'),
      entry = c.current();
    start.onclick = async () => {
      start.disabled = true;
      try {
        recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!status.isConnected) {
          recordStream.getTracks().forEach((t) => t.stop());
          return;
        }
        const mime = ['audio/webm;codecs=opus', 'audio/mp4'].find((t) =>
          MediaRecorder.isTypeSupported(t),
        );
        recorder = new MediaRecorder(recordStream, mime ? { mimeType: mime } : {});
        const chunks = [];
        let size = 0;
        recorder.ondataavailable = (e) => {
          if (e.data.size) {
            chunks.push(e.data);
            size += e.data.size;
            status.textContent = '录音中 · ' + (size / 1024).toFixed(0) + ' KB';
            if (size > LIMITS.recordingBytes && recorder.state === 'recording') recorder.stop();
          }
        };
        recorder.onstop = async () => {
          recordStream.getTracks().forEach((t) => t.stop());
          const file = new File(chunks, '录音-' + Date.now() + '.webm', {
            type: recorder.mimeType.split(';')[0],
          });
          try {
            await c.upload([file], entry);
            status.textContent = '录音已保存';
          } catch (e) {
            status.textContent = e.message;
          }
          stop.disabled = true;
        };
        recorder.start(1000);
        stop.disabled = false;
        status.textContent = '正在录音…';
        stop.onclick = () => {
          if (recorder.state === 'recording') recorder.stop();
        };
      } catch (e) {
        start.disabled = false;
        status.textContent = '无法开始录音：' + e.message;
      }
    };
  }
  function draw(imageId = null) {
    if (!c.current() || c.current().deleted) return;
    modal(
      imageId ? '编辑图片副本' : '手绘日记',
      `<div class="filter-row"><input type="color" id="penColor" value="#334455" aria-label="画笔颜色"><input type="range" id="penSize" min="1" max="24" value="3" aria-label="画笔粗细"><button class="secondary" id="drawUndo">撤销</button><button class="secondary" id="drawClear">清空画布</button>${imageId ? '<button class="secondary" id="rotateImage">旋转</button><button class="secondary" id="cropImage">裁剪选区</button>' : ''}</div><p>${imageId ? '拖动选择裁剪范围；保存为新附件，原图保留。' : '按住鼠标或手指绘画，保存为 PNG 附件。'}</p><canvas id="drawing" width="900" height="600" aria-label="绘画画布"></canvas><button class="primary" id="saveDrawing">保存为附件</button><p id="drawStatus" role="status"></p>`,
    );
    const canvas = $('#drawing'),
      ctx = canvas.getContext('2d'),
      undo = [];
    let down = false,
      last,
      origin,
      selection;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const checkpoint = () => {
      undo.push({
        data: ctx.getImageData(0, 0, canvas.width, canvas.height),
        w: canvas.width,
        h: canvas.height,
      });
      if (undo.length > 10) undo.shift();
    };
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      return [
        ((e.clientX - r.left) * canvas.width) / r.width,
        ((e.clientY - r.top) * canvas.height) / r.height,
      ];
    };
    if (imageId) {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = '/media/' + imageId;
    }
    canvas.onpointerdown = (e) => {
      checkpoint();
      down = true;
      last = origin = point(e);
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (!down) return;
      const next = point(e);
      if (imageId) {
        selection = [
          Math.min(origin[0], next[0]),
          Math.min(origin[1], next[1]),
          Math.abs(next[0] - origin[0]),
          Math.abs(next[1] - origin[1]),
        ];
        $('#drawStatus').textContent =
          `选区 ${selection[2].toFixed(0)} × ${selection[3].toFixed(0)}`;
      } else {
        ctx.strokeStyle = $('#penColor').value;
        ctx.lineWidth = Number($('#penSize').value);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(...last);
        ctx.lineTo(...next);
        ctx.stroke();
        last = next;
      }
    };
    canvas.onpointerup = () => (down = false);
    canvas.onpointercancel = () => (down = false);
    $('#drawUndo').onclick = () => {
      const old = undo.pop();
      if (old) {
        canvas.width = old.w;
        canvas.height = old.h;
        ctx.putImageData(old.data, 0, 0);
      }
    };
    $('#drawClear').onclick = () => {
      checkpoint();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    if (imageId) {
      $('#rotateImage').onclick = () => {
        checkpoint();
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        copy.getContext('2d').drawImage(canvas, 0, 0);
        canvas.width = copy.height;
        canvas.height = copy.width;
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(copy, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      };
      $('#cropImage').onclick = () => {
        if (!selection || selection[2] < 2 || selection[3] < 2) return toast('请先拖动选出范围');
        checkpoint();
        const data = ctx.getImageData(...selection.map(Math.round));
        canvas.width = data.width;
        canvas.height = data.height;
        ctx.putImageData(data, 0, 0);
        selection = null;
      };
    }
    $('#saveDrawing').onclick = () => {
      const entry = c.current();
      canvas.toBlob(async (b) => {
        await c.upload(
          [new File([b], '手绘-' + Date.now() + '.png', { type: 'image/png' })],
          entry,
        );
        if (canvas.isConnected) closeModal();
      }, 'image/png');
    };
  }
  function speak() {
    if (!c.current()) return;
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      speechParts = [];
      return;
    }
    const voices = speechSynthesis.getVoices().filter((v) => v.localService),
      voice = voices.find((v) => v.lang.startsWith('zh')) || voices[0];
    if (!voice) return toast('没有可用的本地朗读语音，请先在 Windows 中安装语音包');
    speechParts =
      (c.current().title + '。' + textOf(c.current().content)).match(/[\s\S]{1,180}/g) || [];
    const next = () => {
      const text = speechParts.shift();
      if (!text) return;
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.onend = next;
      speechSynthesis.speak(u);
    };
    next();
  }
  $('#modal').addEventListener('close', () => {
    if (recorder?.state === 'recording') recorder.stop();
  });
  return { recording, draw, speak };
}
