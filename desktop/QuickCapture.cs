using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Window lifecycle only. The shared web editor owns content, revisions and saving.
internal static class QuickCapture
{
    internal const string DefaultUrl = "http://127.0.0.1:18765";
    const string AppId = "diary-desktop-preview";
    const string NodeFallback = @"D:\软件\Apps\NodeJS\node-v24.18.1-win-x64\node.exe";
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    internal static Uri ParseBaseUrl(string value)
    {
        Uri uri;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.Scheme != "http" ||
            uri.Host != "127.0.0.1" || uri.AbsolutePath != "/" || uri.Query.Length > 0 ||
            uri.Fragment.Length > 0 || uri.UserInfo.Length > 0)
            throw new Exception("快捷窗口地址必须是本机 127.0.0.1 的 HTTP 服务。");
        return uri;
    }

    static bool Ready(Uri url)
    {
        try {
            var request = (HttpWebRequest)WebRequest.Create(new Uri(url, "api/health"));
            request.Proxy = null;
            request.Timeout = 700;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return reader.ReadToEnd().Contains(AppId);
        } catch { return false; }
    }

    static void EnsureService(string root, Uri url, bool isolated)
    {
        if (Ready(url)) return;
        if (isolated) throw new Exception("隔离测试服务未启动；快捷窗口不会替你启动正式工作库。");
        string node = null;
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
            if (String.IsNullOrWhiteSpace(directory)) continue;
            string candidate = Path.Combine(directory.Trim('"'), "node.exe");
            if (File.Exists(candidate)) { node = candidate; break; }
        }
        if (node == null && File.Exists(NodeFallback)) node = NodeFallback;
        if (node == null) throw new Exception("没有找到 Node.js，请检查本机安装。");
        string entry = Path.Combine(root, "server.mjs");
        if (!File.Exists(entry)) throw new Exception("请将快捷启动程序保留在 server.mjs 所在目录。");
        var start = new ProcessStartInfo(node, "\"" + entry + "\"") {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        start.EnvironmentVariables.Remove("DIARY_PORT");
        start.EnvironmentVariables.Remove("DIARY_DATA_DIR");
        Process.Start(start);
        for (int i = 0; i < 50 && !Ready(url); i++) Thread.Sleep(200);
        if (!Ready(url)) throw new Exception("本地日记服务没有启动成功，请检查端口或使用主启动器。");
    }

    static string Identity(string root, Uri url, string stateDirectory)
    {
        using (var sha = SHA256.Create()) {
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant() + "|" + url + "|" + stateDirectory.ToLowerInvariant()));
            return "ShiyeQuick-" + BitConverter.ToString(bytes, 0, 12).Replace("-", "") + "-" + Process.GetCurrentProcess().SessionId;
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        try {
            if (Array.IndexOf(args, "--self-test") >= 0) return SelfTest();
            string root = AppDomain.CurrentDomain.BaseDirectory;
            if (args.Length == 1 && (args[0] == "--startup-status" || args[0] == "--startup-enable" || args[0] == "--startup-disable")) {
                var registration = new QuickStartupRegistration(root, new QuickRegistryStartupStore());
                if (args[0] != "--startup-status") registration.Set(args[0] == "--startup-enable");
                Console.WriteLine(new JavaScriptSerializer().Serialize(new { enabled = registration.Enabled, valueName = registration.ValueName, command = registration.Command }));
                return 0;
            }
            Uri url = ParseBaseUrl(DefaultUrl);
            string stateDirectory = new DesktopPaths(root).StateDirectory;
            string normalStateDirectory = stateDirectory;
            bool isolated = false;
            bool bridgeTest = false;
            bool resident = false, autostart = false, toggle = false, exitHost = false, hostTest = false, newWindow = false;
            string testCommand = null, hostCommand = null;
            foreach (string arg in args) {
                if (arg.StartsWith("--url=", StringComparison.Ordinal)) { url = ParseBaseUrl(arg.Substring(6)); isolated = true; }
                else if (arg.StartsWith("--state-dir=", StringComparison.Ordinal)) stateDirectory = Path.GetFullPath(arg.Substring(12));
                else if (arg == "--bridge-test") bridgeTest = true;
                else if (arg == "--resident") resident = true;
                else if (arg == "--autostart") { resident = true; autostart = true; }
                else if (arg == "--chat") hostCommand = "chat-open";
                else if (arg == "--chat-toggle") hostCommand = "chat-toggle";
                else if (arg == "--host-settings") hostCommand = "settings";
                else if (arg == "--toggle") toggle = true;
                else if (arg == "--exit-host") exitHost = true;
                else if (arg == "--host-test") hostTest = true;
                else if (arg == "--new-window") newWindow = true;
                else if (arg == "--test-expire-background") testCommand = "test-expire";
                else if (arg == "--test-hide-recent") testCommand = "test-hide";
                else if (arg != "--check") throw new Exception("未知的快捷窗口启动参数。");
            }
            if ((bridgeTest || hostTest) && !isolated) throw new Exception("宿主协议测试只允许使用隔离服务。");
            if (testCommand != null && (!isolated || !hostTest)) throw new Exception("测试时钟和收起命令只允许隔离宿主测试。");
            if (autostart && (args.Length != 1 || isolated || stateDirectory != normalStateDirectory)) throw new Exception("自启动只允许固定本机托盘入口。");
            if (isolated && stateDirectory == normalStateDirectory)
                throw new Exception("隔离地址必须同时指定 --state-dir，避免使用正式窗口状态。");
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (Array.IndexOf(args, "--check") >= 0) return 0;
            string identity = Identity(root, url, stateDirectory);
            if (exitHost) return QuickHostContext.Forward(identity, "exit") ? 0 : 1;
            if (testCommand != null) return QuickHostContext.Forward(identity, testCommand) ? 0 : 1;
            // Ordinary launch resumes the recent window; explicit --new-window keeps multi-open.
            using (var hostMutex = new Mutex(false, "Local\\" + identity + "-host")) {
                bool ownsHost = false;
                if (!bridgeTest) {
                    try { ownsHost = hostMutex.WaitOne(0); } catch (AbandonedMutexException) { ownsHost = true; }
                    if (!ownsHost) {
                        if (!QuickHostContext.Forward(identity, hostCommand ?? (resident ? "resident" : toggle ? "toggle" : newWindow ? "open" : "restore")))
                            throw new Exception("后台快捷记录未响应，请通过托盘退出后重试。");
                        return 0;
                    }
                }
                try {
            // Only service startup is serialized. Every invocation owns a separate editor window.
            using (var startup = new Mutex(false, "Local\\" + identity + "-startup")) {
                bool acquired = false;
                try {
                    try { acquired = startup.WaitOne(15000); } catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired) throw new Exception("正在启动本地服务，请稍后再打开快捷窗口。");
                    // Login registration creates only the tray broker; it never starts an API or editor.
                    if (!autostart) EnsureService(root, url, isolated);
                } finally { if (acquired) startup.ReleaseMutex(); }
            }
                try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
                catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Directory.CreateDirectory(stateDirectory);
                if (bridgeTest) using (var slot = WindowSlot.Acquire(identity))
                    Application.Run(new QuickCaptureWindow(root, url, stateDirectory, identity, slot.Index, true));
                else {
                    var context = new QuickHostContext(root, url, stateDirectory, identity, resident || hostCommand != null, hostTest, () => EnsureService(root, url, isolated));
                    if (hostCommand != null) Task.Run(() => QuickHostContext.Forward(identity, hostCommand));
                    Application.Run(context);
                }
                } finally { if (ownsHost) hostMutex.ReleaseMutex(); }
            }
            return 0;
        } catch (Exception error) {
            if (args.Length == 1 && args[0].StartsWith("--startup-", StringComparison.Ordinal)) Console.Error.WriteLine(error.Message);
            else if (Array.IndexOf(args, "--autostart") >= 0) {
                // Login must never steal focus, including when configuration/runtime is unavailable.
                try {
                    string folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "outputs", "desktop-maintenance"); Directory.CreateDirectory(folder);
                    string file = Path.Combine(folder, "autostart-errors.jsonl");
                    if (!File.Exists(file) || new FileInfo(file).Length < 256 * 1024)
                        File.AppendAllText(file, new JavaScriptSerializer().Serialize(new { atUtc = DateTime.UtcNow.ToString("o"), kind = "autostart-failed", exceptionType = error.GetType().Name, message = error.Message }) + Environment.NewLine);
                } catch (Exception) { }
            }
            else if (Array.IndexOf(args, "--check") < 0)
                MessageBox.Show(error.Message, "拾页 · 思绪", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
    }

    static int SelfTest()
    {
        try {
            if (ParseBaseUrl("http://127.0.0.1:18767/").Port != 18767) return 1;
            foreach (string bad in new[] { "https://example.com", "http://localhost:18765", "http://127.0.0.1:18765/other", "http://127.0.0.1:18765/?quick=1" }) {
                bool rejected = false; try { ParseBaseUrl(bad); } catch { rejected = true; }
                if (!rejected) return 2;
            }
            var screen = new Rectangle(0, 0, 1280, 720);
            var bounds = QuickCaptureWindow.FitBounds(new Rectangle(4000, -500, 1800, 1600), screen);
            if (!screen.Contains(bounds) || bounds.Width != 1280 || bounds.Height != 720) return 3;
            var small = QuickCaptureWindow.FitBounds(new Rectangle(80, 80, 600, 600), screen);
            if (small != new Rectangle(80, 80, 600, 600)) return 4;
            var gate = new CloseGate();
            if (gate.AllowClose || !gate.Request() || gate.Request()) return 5;
            gate.Failed(); if (gate.AllowClose || !gate.Request()) return 6;
            gate.Approve(); if (!gate.AllowClose) return 7;
            var offset = QuickCaptureWindow.CascadeBounds(small, screen, 1);
            if (offset.Location == small.Location || !screen.Contains(offset)) return 8;
            var edge = QuickCaptureWindow.CascadeBounds(new Rectangle(680, 120, 600, 600), screen, 1);
            if (edge.Location == new Point(680, 120) || !screen.Contains(edge)) return 9;
            if (!QuickHostContext.Valid(new QuickHostSettings { VirtualKey = 0x7D }) || QuickHostContext.Valid(new QuickHostSettings { VirtualKey = 0x7B })) return 10;
            var hiddenAt = new DateTime(2026, 10, 15, 0, 0, 0, DateTimeKind.Utc);
            if (!QuickResumePolicy.Within(hiddenAt, 5, hiddenAt.AddHours(5).AddTicks(-1)) || QuickResumePolicy.Within(hiddenAt, 5, hiddenAt.AddHours(5))) return 11;
            if (QuickResumePolicy.Within(hiddenAt, 0, hiddenAt) || QuickResumePolicy.Within(hiddenAt, 5, hiddenAt.AddSeconds(-1))) return 12;
            if (QuickHostContext.Valid(new QuickHostSettings { ResumeHours = -1 }) || QuickHostContext.Valid(new QuickHostSettings { ResumeHours = 169 })) return 13;
            var legacyHostSettings = new JavaScriptSerializer().Deserialize<QuickHostSettings>("{\"VirtualKey\":0,\"Modifiers\":0,\"ConfirmClose\":true,\"InputMode\":\"chinese\"}");
            if (!QuickHostContext.Valid(legacyHostSettings) || legacyHostSettings.ResumeHours != 5) return 14;
            if (legacyHostSettings.ChatVirtualKey != 0x7E || QuickHostContext.Valid(new QuickHostSettings { VirtualKey = 0x7E })) return 15;
            if (QuickHostContext.Valid(new QuickHostSettings { ChatVirtualKey = 0x7B }) || !QuickHostContext.Valid(new QuickHostSettings { VirtualKey = 0x7E, Modifiers = 2 })) return 16;
            Console.WriteLine("quick-host: url isolation, independent window bounds and save-before-close checks passed");
            return 0;
        } catch { return 99; }
    }
}

// A held OS mutex reserves a cascade position, and releases automatically after a crash.
internal sealed class WindowSlot : IDisposable
{
    readonly Mutex mutex;
    internal int Index { get; private set; }
    WindowSlot(Mutex handle, int index) { mutex = handle; Index = index; }
    internal static WindowSlot Acquire(string identity)
    {
        for (int index = 0; index < 1000; index++) {
            bool created;
            var handle = new Mutex(true, "Local\\" + identity + "-window-" + index, out created);
            if (created) return new WindowSlot(handle, index);
            handle.Dispose();
        }
        throw new Exception("已打开过多快捷窗口，请先关闭部分窗口。");
    }
    public void Dispose() { mutex.ReleaseMutex(); mutex.Dispose(); }
}

internal sealed class CloseGate
{
    public bool AllowClose { get; private set; }
    public bool Pending { get; private set; }
    public bool Request() { if (Pending || AllowClose) return false; Pending = true; return true; }
    public void Failed() { Pending = false; }
    public void Approve() { AllowClose = true; Pending = false; }
}

internal sealed class WindowSettings
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool TopMost { get; set; }
    public double ZoomFactor { get; set; }
}

internal sealed class QuickCaptureWindow : Form
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    readonly string root;
    readonly Uri baseUrl;
    readonly string stateDirectory;
    readonly string settingsMutexName;
    readonly bool bridgeTest;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly WebView2 web = new WebView2();
    readonly CloseGate closeGate = new CloseGate();
    readonly ToolStripStatusLabel status = new ToolStripStatusLabel("正在打开…");
    readonly StatusStrip bar = new StatusStrip { SizingGrip = true };
    readonly System.Windows.Forms.Timer settingsTimer = new System.Windows.Forms.Timer();
    readonly System.Windows.Forms.Timer closeTimer = new System.Windows.Forms.Timer();
    bool pageReady;
    bool disposed;
    bool initialized;
    bool darkTheme;
    double zoomFactor = 1;
    bool zoomDirty, inputPending = true, permanentClose;
    internal Func<string> InputMode = () => "chinese";
    internal Func<double> ResumeHours = () => 5;
    internal Func<DateTime> Now = () => DateTime.UtcNow;
    internal Func<bool> BackgroundOnClose;
    internal DateTime? HiddenAtUtc { get; private set; }
    internal Action<double> ResumeHoursRequested;
    internal Action NewWindowRequested;
    internal Action CloseBlocked;
    internal Action SettingsRequested;

    public QuickCaptureWindow(string appRoot, Uri url, string stateDir, string identity, int windowIndex, bool testMode)
    {
        root = appRoot; baseUrl = url; stateDirectory = stateDir; settingsMutexName = "Local\\" + identity + "-settings";
        bridgeTest = testMode;
        if (bridgeTest) { Opacity = 0; ShowInTaskbar = false; }
        Text = "拾页 · 思绪";
        MinimumSize = new Size(400, 360);
        AutoScaleMode = AutoScaleMode.Dpi;
        StartPosition = FormStartPosition.Manual;
        var work = Screen.PrimaryScreen.WorkingArea;
        Bounds = FitBounds(new Rectangle(work.Right - 700, work.Top + 60, 640, 760), work);
        string iconPath = Path.Combine(root, "public", "icons", "shiye-hd.ico");
        if (File.Exists(iconPath)) Icon = new Icon(iconPath);
        LoadSettings();
        Bounds = CascadeBounds(Bounds, Screen.FromRectangle(Bounds).WorkingArea, windowIndex);
        web.Dock = DockStyle.Fill;
        Controls.Add(web);
        web.Visible = false;
        HandleCreated += delegate { ApplyTitleTheme(); };
        ApplyTheme(ReadStartupTheme());
        status.Spring = true; status.TextAlign = ContentAlignment.MiddleLeft;
        bar.Items.Add(status); Controls.Add(bar);
        settingsTimer.Interval = 350;
        settingsTimer.Tick += delegate { settingsTimer.Stop(); SaveSettings(); };
        closeTimer.Interval = 12000;
        closeTimer.Tick += delegate {
            closeTimer.Stop(); closeGate.Failed(); permanentClose = false;
            if (CloseBlocked != null) CloseBlocked();
            status.Text = "仍未确认保存；请检查页面提示，完成后再次关闭。";
        };
        LocationChanged += delegate { QueueSettings(); };
        SizeChanged += delegate { QueueSettings(); };
        Activated += delegate { inputPending = true; };
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += DisplayChanged;
        Shown += async delegate { initialized = true; await InitializeWeb(); };
        FormClosing += ClosingSafely;
        FormClosed += delegate {
            disposed = true; settingsTimer.Dispose(); closeTimer.Dispose(); SaveSettings(); web.Dispose();
            Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= DisplayChanged;
        };
    }

    internal static Rectangle FitBounds(Rectangle bounds, Rectangle screen)
    {
        int width = Math.Min(Math.Max(bounds.Width, 400), screen.Width);
        int height = Math.Min(Math.Max(bounds.Height, 360), screen.Height);
        return new Rectangle(Math.Max(screen.Left, Math.Min(bounds.X, screen.Right - width)),
            Math.Max(screen.Top, Math.Min(bounds.Y, screen.Bottom - height)), width, height);
    }

    internal static Rectangle CascadeBounds(Rectangle bounds, Rectangle screen, int index)
    {
        bounds = FitBounds(bounds, screen);
        if (index == 0) return bounds;
        int offset = 28 * (1 + (index - 1) % 8);
        int x = bounds.X + offset, y = bounds.Y + offset;
        if (x + bounds.Width > screen.Right) x = Math.Max(screen.Left, bounds.X - offset);
        if (y + bounds.Height > screen.Bottom) y = Math.Max(screen.Top, bounds.Y - offset);
        return FitBounds(new Rectangle(x, y, bounds.Width, bounds.Height), screen);
    }

    void LoadSettings()
    {
        try {
            string path = Path.Combine(stateDirectory, "quick-window.json");
            if (!File.Exists(path)) return;
            var saved = json.Deserialize<WindowSettings>(File.ReadAllText(path, Encoding.UTF8));
            if (saved == null) return;
            zoomFactor = saved.ZoomFactor >= 0.5 && saved.ZoomFactor <= 2.5 ? saved.ZoomFactor : 1;
            if (saved.Width <= 0 || saved.Height <= 0) return;
            var rectangle = new Rectangle(saved.X, saved.Y, saved.Width, saved.Height);
            Bounds = FitBounds(rectangle, Screen.FromRectangle(rectangle).WorkingArea);
            TopMost = saved.TopMost;
        } catch { /* Corrupt layout must not prevent access to the diary. */ }
    }

    void QueueSettings() { if (initialized && !disposed) { settingsTimer.Stop(); settingsTimer.Start(); } }

    void SaveSettings()
    {
        try {
            var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var saved = new WindowSettings { X = bounds.X, Y = bounds.Y, Width = bounds.Width, Height = bounds.Height, TopMost = TopMost, ZoomFactor = zoomFactor };
            string path = Path.Combine(stateDirectory, "quick-window.json");
            // Each window may persist geometry at the same time. Serialize atomic replacement
            // and use a unique temporary name so concurrent writers never share partial JSON.
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            using (var mutex = new Mutex(false, settingsMutexName)) {
                bool acquired = false;
                try {
                    try { acquired = mutex.WaitOne(2000); } catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired) throw new IOException("Window settings busy");
                    if (!zoomDirty && File.Exists(path)) {
                        var previous = json.Deserialize<WindowSettings>(File.ReadAllText(path, Encoding.UTF8));
                        if (previous != null && previous.ZoomFactor >= 0.5 && previous.ZoomFactor <= 2.5) saved.ZoomFactor = previous.ZoomFactor;
                    }
                    File.WriteAllText(temp, json.Serialize(saved), new UTF8Encoding(false));
                    if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
                    zoomDirty = false;
                } finally {
                    if (File.Exists(temp)) File.Delete(temp);
                    if (acquired) mutex.ReleaseMutex();
                }
            }
        } catch { if (!disposed) status.Text = "窗口偏好暂未记住；日记保存不受影响。"; }
    }

    async Task InitializeWeb()
    {
        try {
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(stateDirectory, "quick-webview"));
            await web.EnsureCoreWebView2Async(environment);
            web.ZoomFactor = zoomFactor;
            // Our commands own the saved ratio. Browser profile/navigation zoom
            // notifications must not replace it with a default or another tab's value.
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.WebMessageReceived += MessageReceived;
            web.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                // Keep the correctly colored native surface until the document is ready.
                web.Visible = true;
                if (!e.IsSuccess) status.Text = "页面加载失败，请检查本地服务后重试。";
                else { web.ZoomFactor = zoomFactor; FocusPage(); SendWindowState(); }
            };
            web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                Uri target;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || !TrustedPage(target)) e.Cancel = true;
            };
            web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            web.CoreWebView2.ProcessFailed += delegate { pageReady = false; status.Text = "页面进程异常，窗口未关闭。请保留本窗口并检查保存状态。"; };
            web.Source = new Uri(baseUrl, "?quick=1");
        } catch {
            status.Text = "无法打开编辑页面。请确认 WebView2 与本地服务可用。";
            // No web document was mounted, hence no unsaved entry can exist here.
            closeGate.Approve();
        }
    }

    bool TrustedPage(Uri uri)
    {
        return uri.Scheme == baseUrl.Scheme && uri.Host == baseUrl.Host && uri.Port == baseUrl.Port &&
            uri.AbsolutePath == "/" && System.Web.HttpUtility.ParseQueryString(uri.Query)["quick"] == "1";
    }

    void MessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        Uri source;
        if (!Uri.TryCreate(args.Source, UriKind.Absolute, out source) || !TrustedPage(source)) return;
        try {
            var message = json.Deserialize<Dictionary<string, object>>(args.WebMessageAsJson);
            object kind;
            if (message == null || !message.TryGetValue("type", out kind)) return;
            switch (kind as string) {
                case "theme":
                    object theme;
                    if (message.TryGetValue("value", out theme) && ((theme as string) == "dark" || (theme as string) == "light"))
                        ApplyTheme((theme as string) == "dark");
                    break;
                case "ready":
                    pageReady = true; status.Text = "只管记录，自动保存";
                    if (web.Visible) FocusPage();
                    if (closeGate.Pending) Send("request-close");
                    break;
                case "close-ready":
                    closeTimer.Stop();
                    object resume;
                    bool resumable = !message.TryGetValue("resume", out resume) || (resume is bool && (bool)resume);
                    if (!permanentClose && resumable && BackgroundOnClose != null && BackgroundOnClose()) {
                        closeGate.Failed(); SaveSettings(); HiddenAtUtc = Now(); Hide(); Send("backgrounded");
                    } else { closeGate.Approve(); Close(); }
                    break;
                case "close-failed":
                    closeTimer.Stop(); closeGate.Failed(); permanentClose = false;
                    if (CloseBlocked != null) CloseBlocked();
                    status.Text = "未收起：请先处理页面中的保存或冲突提示。"; break;
                case "zoom-step":
                    object step;
                    if (message.TryGetValue("step", out step) && (step is int || step is long)) {
                        int value = Convert.ToInt32(step); if (value >= -1 && value <= 1) ChangeZoom(value);
                    }
                    break;
                case "input-focus":
                    if (!bridgeTest && inputPending) {
                        if (QuickInputMode.Request(InputMode(), Handle)) inputPending = false;
                        else status.Text = "输入法未确认切换，仍可手动切换（热键与输入）";
                    }
                    break;
                case "host-settings": if (SettingsRequested != null) SettingsRequested(); break;
                case "new-window": if (NewWindowRequested != null) NewWindowRequested(); break;
                case "close-permanently": ClosePermanently(); break;
                case "set-resume-hours":
                    object hours;
                    try {
                        if (!message.TryGetValue("hours", out hours) || !(hours is int || hours is long || hours is double || hours is decimal)) throw new Exception("请输入 0–168 小时。");
                        double number = Convert.ToDouble(hours);
                        if (number < 0 || number > 168 || Double.IsNaN(number)) throw new Exception("请输入 0–168 小时。");
                        if (ResumeHoursRequested != null) ResumeHoursRequested(number);
                        SendWindowState();
                    } catch (Exception error) {
                        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = "window-settings-error", message = error.Message }));
                    }
                    break;
                case "get-window-state": SendWindowState(); break;
                case "set-topmost":
                    object topMost;
                    if (message.TryGetValue("value", out topMost) && topMost is bool) {
                        TopMost = (bool)topMost; QueueSettings(); SendWindowState();
                    }
                    break;
                case "open-main":
                    object entryId;
                    if (message.TryGetValue("id", out entryId)) OpenMain(entryId as string);
                    break;
                case "test-close": if (bridgeTest) Close(); break;
                case "test-zoom-state":
                    if (bridgeTest) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = "test-zoom-state", factor = web.ZoomFactor }));
                    break;
                case "test-theme-state":
                    if (bridgeTest) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {
                        type = "test-theme-state", dark = darkTheme, background = ColorTranslator.ToHtml(BackColor)
                    }));
                    break;
            }
        } catch { status.Text = "操作未完成，请检查页面提示后重试。"; }
    }

    bool ReadStartupTheme()
    {
        string choice = "system";
        try {
            var request = (HttpWebRequest)WebRequest.Create(new Uri(baseUrl, "startup-theme.json?quick=1"));
            request.Proxy = null; request.Timeout = 700; request.ReadWriteTimeout = 700;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) {
                var value = json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                object theme;
                if (value != null && value.TryGetValue("theme", out theme)) choice = theme as string;
            }
        } catch { /* Offline/older servers fall back to the system application theme. */ }
        if (choice == "dark") return true;
        if (choice == "light") return false;
        try {
            return Convert.ToInt32(Microsoft.Win32.Registry.GetValue(
                @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "AppsUseLightTheme", 1)) == 0;
        } catch { return false; }
    }

    void ApplyTitleTheme()
    {
        if (!IsHandleCreated) return;
        int value = darkTheme ? 1 : 0;
        if (DwmSetWindowAttribute(Handle, 20, ref value, 4) != 0)
            DwmSetWindowAttribute(Handle, 19, ref value, 4);
        // Keep the native frame neutral in both active and inactive states instead
        // of inheriting the user's Windows accent colour. Unsupported attributes
        // return an HRESULT and retain the normal system frame on older Windows.
        int border = ColorTranslator.ToWin32(darkTheme ? Color.FromArgb(93, 98, 102) : Color.FromArgb(184, 188, 192));
        int caption = ColorTranslator.ToWin32(darkTheme ? Color.FromArgb(41, 45, 48) : Color.FromArgb(242, 242, 242));
        DwmSetWindowAttribute(Handle, 34, ref border, 4); // DWMWA_BORDER_COLOR
        DwmSetWindowAttribute(Handle, 35, ref caption, 4); // DWMWA_CAPTION_COLOR
    }

    void ApplyTheme(bool dark)
    {
        darkTheme = dark;
        var background = dark ? Color.FromArgb(32, 41, 46) : Color.FromArgb(242, 248, 248);
        var foreground = dark ? Color.FromArgb(227, 236, 238) : Color.FromArgb(43, 54, 60);
        BackColor = bar.BackColor = background;
        bar.ForeColor = status.ForeColor = foreground;
        web.DefaultBackgroundColor = background;
        // Unsupported Windows builds may ignore this cosmetic title-bar hint.
        ApplyTitleTheme();
        bar.Invalidate();
    }

    void Send(string type)
    {
        if (pageReady && web.CoreWebView2 != null)
            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = type }));
    }

    void ChangeZoom(int step)
    {
        if (web.CoreWebView2 == null) return;
        zoomFactor = step == 0 ? 1 : Math.Max(0.5, Math.Min(2.5, Math.Round((zoomFactor + step * 0.04) * 100) / 100));
        web.ZoomFactor = zoomFactor;
        zoomDirty = true;
        SaveSettings(); // Commit user intent immediately, including before a fast close.
        SendWindowState();
    }
    void SendWindowState()
    {
        if (web.CoreWebView2 != null)
            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = "window-state", factor = zoomFactor, topMost = TopMost, resumeHours = ResumeHours() }));
    }
    void FocusPage()
    {
        // The page can focus its input while WebView is still hidden. Give the
        // visible control OS keyboard focus once ready, without stealing other apps' focus.
        if (!bridgeTest && GetForegroundWindow() == Handle) { web.Focus(); Send("focus-editor"); }
    }
    internal void RestoreEditor()
    {
        HiddenAtUtc = null;
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        if (!bridgeTest) { BringToFront(); Activate(); web.Focus(); }
        Send("focus-editor");
    }
    internal void ClosePermanently()
    {
        permanentClose = true;
        // Hidden windows have already completed the save handshake and cannot
        // receive user edits. Do not await requestAnimationFrame in a hidden page.
        if (HiddenAtUtc.HasValue) closeGate.Approve();
        Close();
    }
    void DisplayChanged(object sender, EventArgs args)
    {
        try {
            if (!disposed && IsHandleCreated) BeginInvoke((Action)delegate {
                if (IsDisposed) return;
                if (WindowState == FormWindowState.Normal) Bounds = FitBounds(Bounds, Screen.FromRectangle(Bounds).WorkingArea);
            });
        } catch (InvalidOperationException) { /* The window closed during the system notification. */ }
    }

    void ClosingSafely(object sender, FormClosingEventArgs args)
    {
        if (closeGate.AllowClose) return;
        args.Cancel = true;
        if (!closeGate.Request()) return;
        status.Text = "正在确认保存…";
        Send("request-close"); closeTimer.Start();
    }

    void OpenMain(string id)
    {
        Guid parsed;
        if (!Guid.TryParse(id, out parsed)) { status.Text = "日记尚未保存，暂时无法在主页面打开。"; return; }
        string destination = new Uri(baseUrl, "?entry=" + Uri.EscapeDataString(id)).AbsoluteUri;
        string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe");
        if (File.Exists(edge)) Process.Start(new ProcessStartInfo(edge, "--app=\"" + destination + "\" --window-size=1440,940") { UseShellExecute = true });
        else Process.Start(new ProcessStartInfo(destination) { UseShellExecute = true });
    }
}
