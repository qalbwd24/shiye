using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Mutex = System.Threading.Mutex;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Independent UI prototype: no diary API, global hotkey, tray or production profile.
internal static class NotesPreview
{
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string message);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [STAThread]
    static void Main(string[] args)
    {
        try {
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
            catch { try { SetProcessDPIAware(); } catch { } }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string address = "http://127.0.0.1:18770/notes.html";
            string stateDirectory = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "var", "notes-ui-preview"));
            foreach (string argument in args) {
                if (argument.StartsWith("--url=")) address = argument.Substring(6);
                else if (argument.StartsWith("--state-dir=")) stateDirectory = Path.GetFullPath(argument.Substring(12));
                else throw new ArgumentException("不支持的启动参数。");
            }
            Uri url;
            if (!Uri.TryCreate(address, UriKind.Absolute, out url) || url.Scheme != "http" || url.Host != "127.0.0.1" ||
                url.AbsolutePath != "/notes.html" || url.Query.Length > 0 || url.Fragment.Length > 0 || url.UserInfo.Length > 0)
                throw new ArgumentException("便签预览仅允许本机 HTTP 服务的 /notes.html 页面。");
            Directory.CreateDirectory(stateDirectory);
            string identity;
            using (var sha = SHA256.Create()) identity = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(stateDirectory.ToLowerInvariant()))).Replace("-", "");
            uint wakeMessage = RegisterWindowMessage("ShiyeNotesPreview.Wake." + identity);
            bool isFirstInstance;
            using (var instance = new Mutex(true, "Local\\ShiyeNotesPreview-" + identity, out isFirstInstance)) {
                if (!isFirstInstance) { PostMessage(new IntPtr(0xffff), wakeMessage, IntPtr.Zero, IntPtr.Zero); return; }
                try { Application.Run(new NotesWindow(url, stateDirectory, wakeMessage)); }
                finally { instance.ReleaseMutex(); }
            }
        } catch (Exception error) {
            MessageBox.Show("拾页 · 便签无法打开：" + error.Message, "拾页 · 便签", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}

internal sealed class NotesWindow : Form
{
    readonly Uri url;
    readonly string stateDirectory;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly WebView2 web = new WebView2();
    readonly Timer closeTimer = new Timer();
    readonly Timer windowSaveTimer = new Timer();
    readonly NotesWindowFrame frame;
    readonly NotesResizeGrip[] resizeGrips = new NotesResizeGrip[8];
    readonly uint wakeMessage;
    bool allowClose;
    bool closePending;
    bool pageReady;
    bool hasEnteredPage;
    bool windowReady;
    bool windowPreferencesError;
    bool darkFrame = true;
    bool layingOutNativeClient;
    int borderAppearanceResult = -1;
    int backdropAppearanceResult = -1, backdropExtendResult = -1, backdropAlphaResult = -1;
    NotesFramePalette wallpaperPalette;
    bool paletteDark, paletteLoading, paletteAttempted;
    int paletteRequest;
    string requestedFrameMaterial = "wallpaper";
    FormWindowState lastVisibleWindowState = FormWindowState.Normal;

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    [StructLayout(LayoutKind.Sequential)] struct FrameMargins { internal int left, right, top, bottom; }
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref FrameMargins margins);

    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetSystemMenu(IntPtr window, bool revert);
    [DllImport("user32.dll")] static extern uint EnableMenuItem(IntPtr menu, uint item, uint flags);
    [DllImport("user32.dll")] static extern int TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr window, IntPtr parameters);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    protected override CreateParams CreateParams {
        get {
            CreateParams parameters = base.CreateParams;
            // Keep the standard resizable frame and system window commands; the
            // client title strip supplies our pin and caption controls.
            parameters.Style = (parameters.Style & ~0x00C00000) | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000;
            return parameters;
        }
    }

    internal NotesWindow(Uri address, string statePath, uint wakeSignal)
    {
        url = address;
        stateDirectory = statePath;
        wakeMessage = wakeSignal;
        Text = "拾页 · 便签";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        SetStyle(ControlStyles.ResizeRedraw, true);
        MinimumSize = new Size(400, 360);
        Size = new Size(840, 680);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        RestoreWindow();
        web.Dock = DockStyle.None;
        BackColor = Color.FromArgb(41, 45, 48);
        web.DefaultBackgroundColor = BackColor;
        Controls.Add(web);
        frame = new NotesWindowFrame(this, delegate { SetPinned(!TopMost); });
        frame.Dock = DockStyle.None;
        Controls.Add(frame);
        frame.BringToFront();
        BuildResizeGrips();
        LayoutNativeClient();
        HandleCreated += delegate { ApplyFrameTheme(); };
        Activated += delegate { ApplyFrameTheme(); };
        Deactivate += delegate { ApplyFrameTheme(); };
        windowSaveTimer.Interval = 350;
        windowSaveTimer.Tick += delegate { windowSaveTimer.Stop(); SaveWindow(); };
        LocationChanged += delegate { QueueWindowSave(); };
        SizeChanged += delegate {
            if (WindowState != FormWindowState.Minimized) lastVisibleWindowState = WindowState;
            if (frame != null) frame.UpdateState(TopMost, darkFrame);
            LayoutNativeClient();
            ApplyFrameTheme();
            QueueWindowSave();
        };
        DpiChanged += delegate { ApplyFrameTheme(); };
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += DisplaySettingsChanged;
        Shown += async delegate {
            windowReady = true;
            ApplyFrameTheme();
            try {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(stateDirectory, "webview2"), null);
                await web.EnsureCoreWebView2Async(environment);
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
                web.CoreWebView2.Settings.IsZoomControlEnabled = false;
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                web.CoreWebView2.NavigationStarting += NavigationStarting;
                web.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                    if (e.IsSuccess) SendState();
                    else { pageReady = false; hasEnteredPage = false; Text = "拾页 · 便签 · 页面载入失败"; }
                };
                web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
                web.CoreWebView2.DownloadStarting += DownloadStarting;
                web.CoreWebView2.WebMessageReceived += MessageReceived;
                web.CoreWebView2.Navigate(url.AbsoluteUri);
            } catch (Exception error) {
                MessageBox.Show(this, "便签预览初始化失败：" + error.Message, "拾页 · 便签", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        };
        closeTimer.Interval = 15000;
        closeTimer.Tick += delegate {
            closeTimer.Stop();
            closePending = false;
            MessageBox.Show(this, "便签尚未确认保存完成，窗口已保留。请检查保存状态后再次关闭。", "拾页 · 便签", MessageBoxButtons.OK, MessageBoxIcon.Information);
        };
        FormClosing += ClosingWindow;
        FormClosed += delegate {
            windowReady = false;
            Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= DisplaySettingsChanged;
            windowSaveTimer.Dispose(); closeTimer.Dispose(); web.Dispose();
        };
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x0112 && (message.WParam.ToInt64() & 0xfff0) == 0xf100 && message.LParam.ToInt64() == 32) {
            ShowWindowMenu();
            message.Result = IntPtr.Zero;
            return;
        }
        if (wakeMessage != 0 && message.Msg == wakeMessage) {
            if (WindowState == FormWindowState.Minimized) ShowWindow(Handle, 9);
            Show();
            SetForegroundWindow(Handle);
        }
        base.WndProc(ref message);
        if (message.Msg == 0x001A && IsHandleCreated) ReloadWallpaperPalette(true);
        if ((message.Msg == 0x031E || message.Msg == 0x031A || message.Msg == 0x001A) && IsHandleCreated)
            ApplyFrameTheme();
    }

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        if (frame != null) LayoutNativeClient();
    }

    void BuildResizeGrips()
    {
        int[] hitTests = { 13, 12, 14, 10, 11, 16, 15, 17 };
        Cursor[] cursors = { Cursors.SizeNWSE, Cursors.SizeNS, Cursors.SizeNESW, Cursors.SizeWE,
            Cursors.SizeWE, Cursors.SizeNESW, Cursors.SizeNS, Cursors.SizeNWSE };
        string[] names = { "TopLeft", "Top", "TopRight", "Left", "Right", "BottomLeft", "Bottom", "BottomRight" };
        for (int index = 0; index < resizeGrips.Length; index++) {
            resizeGrips[index] = new NotesResizeGrip(this, hitTests[index]) {
                Name = "NotesResize" + names[index], AccessibleName = "调整窗口 " + names[index], Cursor = cursors[index] };
            Controls.Add(resizeGrips[index]);
            resizeGrips[index].BringToFront();
        }
    }

    void LayoutNativeClient()
    {
        if (frame == null || IsDisposed || layingOutNativeClient) return;
        layingOutNativeClient = true;
        try {
        int edge = WindowState == FormWindowState.Maximized ? 0 : Math.Max(6, (int)Math.Round(8 * DeviceDpi / 96.0));
        int corner = Math.Max(edge, (int)Math.Round(18 * DeviceDpi / 96.0));
        int width = ClientSize.Width, height = ClientSize.Height;
        int caption = (int)Math.Round(44 * DeviceDpi / 96.0);
        Rectangle header = new Rectangle(edge, edge, Math.Max(0, width - edge * 2), caption);
        Rectangle content = new Rectangle(edge, edge + caption, Math.Max(0, width - edge * 2), Math.Max(0, height - caption - edge * 2));
        if (frame.Bounds != header) frame.Bounds = header;
        if (web.Bounds != content) web.Bounds = content;
        var bounds = new[] {
            new Rectangle(0, 0, corner, corner), new Rectangle(corner, 0, Math.Max(0, width - corner * 2), edge),
            new Rectangle(Math.Max(0, width - corner), 0, corner, corner),
            new Rectangle(0, corner, edge, Math.Max(0, height - corner * 2)),
            new Rectangle(Math.Max(0, width - edge), corner, edge, Math.Max(0, height - corner * 2)),
            new Rectangle(0, Math.Max(0, height - corner), corner, corner),
            new Rectangle(corner, Math.Max(0, height - edge), Math.Max(0, width - corner * 2), edge),
            new Rectangle(Math.Max(0, width - corner), Math.Max(0, height - corner), corner, corner)
        };
        for (int index = 0; index < resizeGrips.Length; index++) {
            var grip = resizeGrips[index];
            if (grip == null) continue;
            grip.Visible = edge > 0;
            grip.Bounds = bounds[index];
            grip.BackColor = BackColor;
            grip.Material = CurrentPalette != null;
            grip.Palette = CurrentPalette;
            grip.SetCornerRegion(index, edge, corner);
        }
        } finally { layingOutNativeClient = false; }
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (CurrentPalette != null) CurrentPalette.Paint(e.Graphics, this);
        else base.OnPaintBackground(e);
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keyData)
    {
        if (keyData == (Keys.Alt | Keys.Space)) { ShowWindowMenu(); return true; }
        return base.ProcessCmdKey(ref message, keyData);
    }

    void ShowWindowMenu()
    {
        IntPtr menu = GetSystemMenu(Handle, false);
        if (menu == IntPtr.Zero) return;
        bool normal = WindowState == FormWindowState.Normal;
        EnableMenuItem(menu, 0xf120, normal ? 1u : 0u); // Restore
        EnableMenuItem(menu, 0xf010, normal ? 0u : 1u); // Move
        EnableMenuItem(menu, 0xf000, normal ? 0u : 1u); // Size
        EnableMenuItem(menu, 0xf020, WindowState == FormWindowState.Minimized ? 1u : 0u);
        EnableMenuItem(menu, 0xf030, WindowState == FormWindowState.Maximized ? 1u : 0u);
        Point origin = PointToScreen(new Point(0, frame == null ? 0 : frame.Height));
        int command = TrackPopupMenuEx(menu, 0x0102, origin.X, origin.Y, Handle, IntPtr.Zero);
        if (command != 0) PostMessage(Handle, 0x0112, new IntPtr(command), IntPtr.Zero);
    }

    bool Trusted(string source)
    {
        Uri candidate;
        return Uri.TryCreate(source, UriKind.Absolute, out candidate) && candidate.Scheme == url.Scheme &&
            candidate.Host == url.Host && candidate.Port == url.Port && candidate.AbsolutePath == url.AbsolutePath &&
            candidate.Query.Length == 0 && candidate.Fragment.Length == 0 && candidate.UserInfo.Length == 0;
    }

    bool TrustedBlob(string source)
    {
        if (String.IsNullOrEmpty(source) || !source.StartsWith("blob:", StringComparison.Ordinal)) return false;
        Uri origin;
        return Uri.TryCreate(source.Substring(5), UriKind.Absolute, out origin) && origin.Scheme == url.Scheme &&
            origin.Host == url.Host && origin.Port == url.Port && origin.UserInfo.Length == 0;
    }

    void DownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
    {
        e.Cancel = true;
        e.Handled = true;
        if (!pageReady || !Trusted(web.CoreWebView2.Source) || !TrustedBlob(e.DownloadOperation.Uri)) return;
        // Defer before opening a modal dialog: WebView2 callbacks must return before a nested UI loop.
        var deferral = e.GetDeferral();
        try {
            BeginInvoke(new Action(delegate {
                try {
                    if (!pageReady || !Trusted(web.CoreWebView2.Source)) return;
                    string exportDirectory = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "exports"));
                    Directory.CreateDirectory(exportDirectory);
                    using (var dialog = new SaveFileDialog()) {
                        dialog.Title = "拾页 · 便签 · 导出草稿";
                        dialog.InitialDirectory = exportDirectory;
                        dialog.FileName = "拾页便签-界面草稿.json";
                        dialog.Filter = "JSON 草稿文件 (*.json)|*.json";
                        dialog.DefaultExt = "json";
                        dialog.AddExtension = true;
                        dialog.OverwritePrompt = true;
                        dialog.RestoreDirectory = true;
                        if (dialog.ShowDialog(this) != DialogResult.OK) return;
                        e.ResultFilePath = dialog.FileName;
                        e.Cancel = false;
                    }
                } catch (Exception error) {
                    MessageBox.Show(this, "无法导出草稿：" + error.Message, "拾页 · 便签", MessageBoxButtons.OK, MessageBoxIcon.Error);
                } finally { deferral.Complete(); }
            }));
        } catch { deferral.Complete(); }
    }

    void NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (!Trusted(e.Uri)) { e.Cancel = true; return; }
        // Reloading an edited document must go through the frontend save lifecycle.
        if (hasEnteredPage) { e.Cancel = true; return; }
        hasEnteredPage = true;
    }

    void MessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Trusted(e.Source)) return;
        try {
            var message = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
            object rawType;
            if (!message.TryGetValue("type", out rawType)) return;
            string type = rawType as string;
            if (type == "notes-ready") { pageReady = true; Text = "拾页 · 便签"; SendState(); }
            else if (type == "notes-pin") {
                object value;
                if (message.TryGetValue("value", out value) && value is bool) SetPinned((bool)value);
            } else if (type == "notes-window-appearance") {
                object value;
                if (message.TryGetValue("dark", out value) && value is bool) darkFrame = (bool)value;
                if (message.TryGetValue("material", out value) && value is string) requestedFrameMaterial = (string)value == "gray" ? "gray" : "wallpaper";
                ApplyFrameTheme();
            } else if (type == "notes-close-ready" && closePending) {
                closeTimer.Stop();
                allowClose = true;
                Close();
            } else if (type == "notes-close-failed" && closePending) {
                closeTimer.Stop();
                closePending = false;
                MessageBox.Show(this, "便签尚未保存，窗口已保留。请检查页面中的保存提示后重试。", "拾页 · 便签", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        } catch { /* Ignore malformed/unrecognized bridge messages. */ }
    }

    void SendState()
    {
        WriteRuntimeStatus();
        if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = "notes-native-state", topMost = TopMost,
            nativeFrame = true, windowPreferencesError = windowPreferencesError }));
    }

    void SetPinned(bool value)
    {
        TopMost = value;
        frame.UpdateState(TopMost, darkFrame);
        SaveWindow();
        SendState();
    }

    NotesFramePalette CurrentPalette {
        get { return requestedFrameMaterial != "gray" && !SystemInformation.HighContrast && paletteDark == darkFrame ? wallpaperPalette : null; }
    }

    async void ReloadWallpaperPalette(bool force)
    {
        if (requestedFrameMaterial == "gray" || IsDisposed || !IsHandleCreated) return;
        if (!force && (paletteLoading || (paletteAttempted && paletteDark == darkFrame))) return;
        int request = ++paletteRequest;
        bool dark = darkFrame;
        paletteLoading = true;
        NotesFramePalette loaded;
        try { loaded = await Task.Run(delegate { return NotesFramePalette.Load(dark); }); }
        catch { loaded = null; }
        if (IsDisposed || request != paletteRequest) return;
        paletteLoading = false;
        paletteAttempted = true;
        wallpaperPalette = loaded;
        paletteDark = dark;
        ApplyFrameTheme();
        Invalidate(true);
    }

    void ApplyFrameTheme()
    {
        if (!IsHandleCreated) return;
        BackColor = darkFrame ? Color.FromArgb(41, 45, 48) : Color.FromArgb(242, 242, 242);
        ReloadWallpaperPalette(false);
        var palette = CurrentPalette;
        try {
            int dark = darkFrame ? 1 : 0;
            if (DwmSetWindowAttribute(Handle, 20, ref dark, 4) != 0) DwmSetWindowAttribute(Handle, 19, ref dark, 4);
            int border = darkFrame ? 0x0066625D : 0x00C0BCB8;
            if (palette != null && palette.FromWallpaper) {
                Color edge = Color.FromArgb((palette.Left.R + palette.Right.R) / 2, (palette.Left.G + palette.Right.G) / 2, (palette.Left.B + palette.Right.B) / 2);
                border = edge.R | (edge.G << 8) | (edge.B << 16);
            }
            borderAppearanceResult = DwmSetWindowAttribute(Handle, 34, ref border, 4);
            // The tested WinForms path uses opaque wallpaper-derived colours.
            // Do not expose legacy accent-colour glass or duplicate OS captions.
            int backdrop = 1, alpha = 0;
            backdropAlphaResult = DwmSetWindowAttribute(Handle, 39, ref alpha, 4);
            backdropAppearanceResult = DwmSetWindowAttribute(Handle, 38, ref backdrop, 4);
            FrameMargins margins = new FrameMargins();
            backdropExtendResult = DwmExtendFrameIntoClientArea(Handle, ref margins);
            int caption = darkFrame ? 0x00302D29 : 0x00F2F2F2;
            DwmSetWindowAttribute(Handle, 35, ref caption, 4);
        } catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
        if (frame != null) { frame.Material = palette != null; frame.Palette = palette; frame.UpdateState(TopMost, darkFrame); }
        LayoutNativeClient();
        WriteRuntimeStatus();
    }

    void QueueWindowSave()
    {
        if (!windowReady || IsDisposed || windowSaveTimer == null) return;
        windowSaveTimer.Stop();
        windowSaveTimer.Start();
    }

    void WriteRuntimeStatus()
    {
        if (IsDisposed || !IsHandleCreated) return;
        try {
            Rectangle restore = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            string destination = Path.Combine(stateDirectory, "runtime-status.json");
            string temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporary, json.Serialize(new { protocol = 1,
                atUtc = DateTime.UtcNow.ToString("o"), pid = System.Diagnostics.Process.GetCurrentProcess().Id,
                ready = pageReady, frame = "native-title-strip", systemResizeBorder = true,
                x = Left, y = Top, width = Width, height = Height,
                restore = new { x = restore.X, y = restore.Y, width = restore.Width, height = restore.Height },
                windowState = WindowState.ToString(), lastVisibleState = lastVisibleWindowState.ToString(),
                topMost = TopMost, dpi = DeviceDpi,
                captionHeight = frame == null ? 0 : frame.Height,
                captionBottom = frame == null ? 0 : frame.Bottom, webTop = web.Top,
                clientWidth = ClientSize.Width, clientHeight = ClientSize.Height,
                resizeGrips = Array.ConvertAll(resizeGrips, grip => grip == null ? null : new {
                    name = grip.Name, x = grip.Left, y = grip.Top, width = grip.Width, height = grip.Height, visible = grip.Visible }),
                borderColor = darkFrame ? "#5d6266" : "#b8bcc0", borderResult = borderAppearanceResult,
                requestedMaterial = requestedFrameMaterial, frameMaterial = CurrentPalette != null && CurrentPalette.FromWallpaper ? "wallpaper-tint" : "gray",
                backdropResult = backdropAppearanceResult, backdropExtendResult = backdropExtendResult,
                backdropAlphaResult = backdropAlphaResult,
                windowPreferencesError = windowPreferencesError }), new UTF8Encoding(false));
            if (File.Exists(destination)) File.Replace(temporary, destination, null);
            else File.Move(temporary, destination);
        } catch { /* Read-only diagnostics must never block editing or saving. */ }
    }

    void DisplaySettingsChanged(object sender, EventArgs e)
    {
        if (!windowReady || IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(new Action(delegate {
            if (IsDisposed) return;
            if (WindowState == FormWindowState.Normal) Bounds = FitWindowBounds(Bounds, Screen.FromRectangle(Bounds).WorkingArea, MinimumSize);
            QueueWindowSave();
        })); } catch (InvalidOperationException) { }
    }

    internal static Rectangle FitWindowBounds(Rectangle bounds, Rectangle area, Size minimum)
    {
        bounds.Width = Math.Min(Math.Max(minimum.Width, bounds.Width), area.Width);
        bounds.Height = Math.Min(Math.Max(minimum.Height, bounds.Height), area.Height);
        bounds.X = Math.Max(area.Left, Math.Min(bounds.X, area.Right - bounds.Width));
        bounds.Y = Math.Max(area.Top, Math.Min(bounds.Y, area.Bottom - bounds.Height));
        return bounds;
    }

    void ClosingWindow(object sender, FormClosingEventArgs e)
    {
        if (allowClose) { SaveWindow(); return; }
        if (!pageReady) {
            // Once a page has begun loading it might already contain unsaved edits.
            if (!hasEnteredPage) { SaveWindow(); return; }
            e.Cancel = true;
            MessageBox.Show(this, "便签页面尚未就绪，窗口已保留，以免丢失正在恢复的内容。", "拾页 · 便签", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        e.Cancel = true;
        if (closePending) return;
        closePending = true;
        web.CoreWebView2.PostWebMessageAsJson("{\"type\":\"notes-request-close\"}");
        closeTimer.Start();
    }

    void RestoreWindow()
    {
        try {
            var state = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(stateDirectory, "window.json"), Encoding.UTF8));
            var rectangle = new Rectangle(Convert.ToInt32(state["x"]), Convert.ToInt32(state["y"]), Convert.ToInt32(state["width"]), Convert.ToInt32(state["height"]));
            Screen screen = Screen.FromRectangle(rectangle);
            Rectangle area = screen.WorkingArea;
            rectangle = FitWindowBounds(rectangle, area, MinimumSize);
            StartPosition = FormStartPosition.Manual;
            Bounds = rectangle;
            TopMost = Convert.ToBoolean(state["topMost"]);
            if (Convert.ToBoolean(state["maximized"])) {
                lastVisibleWindowState = FormWindowState.Maximized;
                WindowState = FormWindowState.Maximized;
            }
        } catch { /* Missing/corrupt UI preferences safely use defaults. */ }
    }

    void SaveWindow()
    {
        if (windowSaveTimer != null) windowSaveTimer.Stop();
        try {
            Rectangle bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            string destination = Path.Combine(stateDirectory, "window.json");
            string temporary = Path.Combine(stateDirectory, "window." + Guid.NewGuid().ToString("N") + ".pending.json");
            File.WriteAllText(temporary, json.Serialize(new { x = bounds.X, y = bounds.Y, width = bounds.Width, height = bounds.Height,
                maximized = (WindowState == FormWindowState.Minimized ? lastVisibleWindowState : WindowState) == FormWindowState.Maximized,
                topMost = TopMost }), Encoding.UTF8);
            if (File.Exists(destination)) File.Replace(temporary, destination, null);
            else File.Move(temporary, destination);
            bool recovered = windowPreferencesError;
            windowPreferencesError = false;
            WriteRuntimeStatus();
            if (recovered) SendState();
        } catch {
            windowPreferencesError = true;
            SendState();
            // UI preference failures do not override successful content saving.
        }
    }
}
