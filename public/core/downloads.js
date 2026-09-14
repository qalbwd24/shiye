export function download(name, type, content, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.' + ext;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
