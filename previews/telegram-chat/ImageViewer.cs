using System;
using System.IO;
using System.Drawing;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class ImageViewerBridge : IDisposable
{
    readonly Dictionary<string, FileStream> pending = new Dictionary<string, FileStream>();
    readonly Dictionary<string, string> formats = new Dictionary<string, string>();
    readonly string staging, output, profile;
    readonly Action<string, string> report;
    readonly Action<string> verificationReport;
    readonly bool verify;
    internal ImageViewerBridge(string root, string app, string userProfile, bool verification, Action<string, string> send, Action<string> verified)
    {
        staging = Path.Combine(root, "tmp", "chat-ui-20261016", "image-viewer");
        output = app; profile = userProfile; report = send; verify = verification; verificationReport = verified;
        Directory.CreateDirectory(staging);
    }
    internal void Handle(Dictionary<string, object> message, Form owner)
    {
        string id = Convert.ToString(message["id"]), kind = Convert.ToString(message["kind"]);
        Guid parsed;
        if (!Guid.TryParse(id, out parsed)) return;
        id = parsed.ToString();
        FileStream stream;
        try {
            if (kind == "image-start") {
                if (pending.Count >= 4) throw new InvalidOperationException("图片正在打开，请稍后重试");
                string mime = Convert.ToString(message["mime"]);
                string extension = mime == "image/png" ? ".png" : mime == "image/gif" ? ".gif"
                    : mime == "image/webp" ? ".webp" : mime == "image/bmp" ? ".bmp" : mime == "image/avif" ? ".avif" : ".jpg";
                pending.Add(id, new FileStream(Path.Combine(staging, id + extension), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read));
                formats[id] = mime;
            } else if (pending.TryGetValue(id, out stream)) {
                if (kind == "image-chunk") {
                    byte[] bytes = Convert.FromBase64String(Convert.ToString(message["bytes"]));
                    if (Convert.ToInt64(message["offset"]) != stream.Length || bytes.Length > 262144 || stream.Length + bytes.Length > 128L * 1024 * 1024)
                        throw new InvalidOperationException("图片传输不完整或超过大小上限");
                    stream.Write(bytes, 0, bytes.Length);
                } else {
                    string file = stream.Name, mime = formats[id];
                    stream.Dispose(); pending.Remove(id); formats.Remove(id);
                    if (kind == "image-cancel") { File.Delete(file); return; }
                    var viewer = new ImageViewerWindow(output, profile, file, mime, verify, verificationReport, owner.Bounds,
                        success => report(id,success?null:"独立图片窗口未能加载，可继续在聊天中查看。"));
                    viewer.FormClosed += delegate { report(id, "closed"); };
                    viewer.Show(owner);
                }
            }
        } catch (Exception) {
            if (pending.TryGetValue(id, out stream)) {
                string file = stream.Name; stream.Dispose(); pending.Remove(id); formats.Remove(id);
                try { File.Delete(file); } catch (IOException) { }
            }
            report(id, "独立图片窗口未能打开，可继续在聊天中查看。");
        }
    }
    public void Dispose()
    {
        foreach (var stream in pending.Values) { string file = stream.Name; stream.Dispose(); try { File.Delete(file); } catch (IOException) { } }
        pending.Clear();
    }
}

internal sealed partial class ImageViewerWindow : Form
{
    internal static readonly Size ImageMinimumDip = new Size(320,260);
    Size ImageMinimumFor(Screen screen) {
        int dpi=DisplayMemory.Dpi(screen,96); var area=screen.WorkingArea;
        return new Size(Math.Min(area.Width,(int)Math.Ceiling(ImageMinimumDip.Width*dpi/96.0)),Math.Min(area.Height,(int)Math.Ceiling(ImageMinimumDip.Height*dpi/96.0)));
    }
    readonly WebView2 browser = new WebView2();
    readonly string output, profile, image, mime;
    readonly bool verify;
    readonly Action<string> verificationReport;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly Action<bool> readyReport;
    bool imageReady, readinessReported;
    readonly System.Windows.Forms.Timer readyTimer=new System.Windows.Forms.Timer {Interval=12000};
    internal ImageViewerWindow(string app, string userProfile, string file, string contentType, bool verification, Action<string> verified, Rectangle ownerBounds, Action<bool> reportReady)
    {
        output = app; profile = userProfile; image = file; mime = contentType; verify = verification; verificationReport = verified;
        readyReport=reportReady;
        Text = "拾页 · 图片"; StartPosition = FormStartPosition.Manual;
        Size = new Size(1000, 760); MinimumSize = ImageMinimumDip;
        Opacity=0;
        RestoreImageBounds(ownerBounds);
        BackColor = Color.FromArgb(23, 32, 36);
        browser.Dock = DockStyle.Fill; browser.DefaultBackgroundColor = BackColor; Controls.Add(browser);
        Shown += async delegate { FitDisplay(null); await LoadImage(); };
        Activated += delegate { if(imageReady) FocusImage(); };
        readyTimer.Tick += delegate { CompleteImageLoad(false); };
        readyTimer.Start();
        FormClosed += delegate { SaveImageSettings(); if(!readinessReported) {readinessReported=true;readyReport(false);} readyTimer.Dispose(); imageMemoryTimer.Dispose(); browser.Dispose(); try { File.Delete(image); } catch (IOException) { } };
    }
    void CompleteImageLoad(bool success) {
        if(readinessReported || IsDisposed || Disposing) return;
        readinessReported=true; readyTimer.Stop(); imageReady=success;
        if(success) { Opacity=1; Activate(); FocusImage(); SaveImageSettings(); readyReport(true); if(verify) verificationReport(json.Serialize(new {kind="image-window-state",width=Width,height=Height,x=Left,y=Top,restored=imageMemoryRestored})); }
        else { readyReport(false); if(!IsDisposed && !Disposing) Close(); }
    }
    void FocusImage() {
        if(IsDisposed || Disposing || browser.IsDisposed || browser.CoreWebView2==null) return;
        browser.Focus();
        browser.Select();
        browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('#stage').focus({preventScroll:true})");
    }
    void FitDisplay(Rectangle? suggested)
    {
        if(WindowState==FormWindowState.Minimized) return;
        var reference = suggested ?? Bounds;
        reference=SelectImageDisplay(reference);
        var area = Screen.FromRectangle(reference).WorkingArea;
        MinimumSize = ImageMinimumFor(Screen.FromRectangle(reference));
        MaximizedBounds = area;
        if (WindowState == FormWindowState.Normal) Bounds = DisplayLayout.Fit(reference, area, MinimumSize);
    }
    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x02E0) {
            var suggested = ((DisplayLayout.NativeRect)Marshal.PtrToStructure(message.LParam, typeof(DisplayLayout.NativeRect))).Bounds;
            base.WndProc(ref message); FitDisplay(suggested); return;
        }
        if(message.Msg==0x0231) { SaveImageSettings(); imageMoving=true; }
        if(message.Msg==0x0232) imageMoving=false;
        base.WndProc(ref message);
        if (message.Msg == 0x007E && IsHandleCreated) BeginInvoke((Action)delegate { if (!IsDisposed) FitDisplay(null); });
    }
    async Task LoadImage()
    {
        try {
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await browser.EnsureCoreWebView2Async(environment);
            if (IsDisposed || Disposing || browser.IsDisposed) return;
            var core = browser.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.SetVirtualHostNameToFolderMapping("shiye-preview.local", Path.Combine(output, "app"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
                if (e.Request.Uri == "https://shiye-image.local/image") {
                    e.Response = environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(image)), 200, "OK", "Content-Type: " + mime);
                } else if (!e.Request.Uri.StartsWith("https://shiye-preview.local/", StringComparison.OrdinalIgnoreCase)) {
                    e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 403, "Local images only", "Content-Type: text/plain");
                }
            };
            core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                if (!e.Uri.StartsWith("https://shiye-preview.local/", StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
            };
            core.WebMessageReceived += async delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
                if (!e.Source.StartsWith("https://shiye-preview.local/", StringComparison.OrdinalIgnoreCase)) return;
                try {
                    var data = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                    string kind = Convert.ToString(data["kind"]);
                    if (verify && kind == "image-verification") { verificationReport(e.WebMessageAsJson); return; }
                    if (verify && kind == "image-verify-input") {
                        string method = Convert.ToString(data["method"]);
                        if (!method.StartsWith("Input.", StringComparison.Ordinal)) return;
                        await core.CallDevToolsProtocolMethodAsync(method, json.Serialize(data["parameters"]));
                        core.PostWebMessageAsJson(json.Serialize(new { kind = "image-verify-input-result", id = data["id"] })); return;
                    }
                    if(verify && kind=="image-verify-remember") {
                        WindowState=FormWindowState.Normal; Size=new Size(720,520); FitDisplay(null); SaveImageSettings();
                        core.PostWebMessageAsJson(json.Serialize(new {kind="image-remembered",width=Width,height=Height})); return;
                    }
                    if (verify && kind == "image-verify-size") {
                        Size = new Size(560,400); FitDisplay(null);
                        core.PostWebMessageAsJson(json.Serialize(new { kind = "image-verify-sized" })); return;
                    }
                    if (kind == "image-ready") CompleteImageLoad(true);
                    else if(kind=="image-load-failed") CompleteImageLoad(false);
                    else if (kind == "image-close") Close();
                    else if (kind == "image-copy") {
                        using (var bitmap = Image.FromFile(image)) Clipboard.SetImage(new Bitmap(bitmap));
                        core.PostWebMessageAsJson(json.Serialize(new { message = "图片已复制" }));
                    } else if (kind == "image-save") {
                        using (var dialog = new SaveFileDialog { FileName = "图片" + Path.GetExtension(image), Filter = "图片原文件|*" + Path.GetExtension(image), AddExtension = true }) {
                            if (dialog.ShowDialog(this) == DialogResult.OK) File.Copy(image, dialog.FileName, true);
                        }
                    }
                } catch (Exception) { core.PostWebMessageAsJson(json.Serialize(new { message = "操作未完成；此格式可尝试另存原文件。" })); }
            };
            if (verify) core.NavigationCompleted += async delegate {
                await core.ExecuteScriptAsync(File.ReadAllText(Path.Combine(DesktopPreview.ProjectRoot,"previews","telegram-chat","verify-image.js")));
            };
            core.Navigate("https://shiye-preview.local/shiye-image-viewer.html?v="+File.GetLastWriteTimeUtc(Path.Combine(output,"app","shiye-image-viewer.js")).Ticks.ToString());
        } catch (Exception) { if (!IsDisposed && !Disposing) CompleteImageLoad(false); }
    }
}
