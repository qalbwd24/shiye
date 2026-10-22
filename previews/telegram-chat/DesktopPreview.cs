using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal enum HostSaveOutcome { Saved, Busy, TimedOut, Failed, Interrupted }
internal enum HostExitDisposition { None, LocalSaveAck, ExplicitRecoveryClose, NeverReadyInitialClose }

// One deadline covers dispatch and acknowledgement; a late page response cannot complete a later attempt.
internal sealed class HostSaveLifecycle
{
    internal bool Pending { get; private set; }
    internal string Ticket { get; private set; }
    TaskCompletionSource<bool> acknowledgement, interrupted;
    internal void Acknowledge(string ticket, bool saved)
    {
        if (Pending && ticket == Ticket && acknowledgement != null) acknowledgement.TrySetResult(saved);
    }
    internal void Interrupt() { if (interrupted != null) interrupted.TrySetResult(true); }
    internal async Task<HostSaveOutcome> SaveAsync(Func<string, Task> dispatch, int timeoutMs)
    {
        if (Pending) return HostSaveOutcome.Busy;
        Pending = true; Ticket = Guid.NewGuid().ToString("N");
        acknowledgement = new TaskCompletionSource<bool>(); interrupted = new TaskCompletionSource<bool>();
        var saved = acknowledgement.Task; var stopped = interrupted.Task; var deadline = Task.Delay(timeoutMs);
        try {
            var dispatching = dispatch(Ticket);
            var first = await Task.WhenAny(dispatching, deadline, stopped);
            if (first != dispatching) {
                ObserveFailure(dispatching);
                return first == stopped ? HostSaveOutcome.Interrupted : HostSaveOutcome.TimedOut;
            }
            await dispatching;
            if (stopped.IsCompleted) return HostSaveOutcome.Interrupted;
            var second = await Task.WhenAny(saved, deadline, stopped);
            if (second == stopped) return HostSaveOutcome.Interrupted;
            if (second != saved) return HostSaveOutcome.TimedOut;
            return await saved ? HostSaveOutcome.Saved : HostSaveOutcome.Failed;
        } catch (Exception) { return HostSaveOutcome.Failed; }
        finally { Pending = false; Ticket = null; acknowledgement = null; interrupted = null; }
    }
    internal static void ObserveFailure(Task task)
    {
        task.ContinueWith(failed => { var ignored = failed.Exception; }, CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
    }
    internal static async Task<string> ExecuteAsync(Func<Task<string>> execute, int timeoutMs)
    {
        var pending = execute();
        if (await Task.WhenAny(pending, Task.Delay(timeoutMs)) != pending) {
            ObserveFailure(pending);
            throw new TimeoutException();
        }
        return await pending;
    }
}

internal static class DesktopPreview
{
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);
    internal static readonly string ProjectRoot = ResolveRoot();
    internal static readonly DesktopPaths Paths = new DesktopPaths(ProjectRoot);
    internal static bool Development { get { return !Paths.Production && File.Exists(Path.Combine(ProjectRoot, "WORKSPACE.md")); } }
    internal static string EventName(string intent) {
        string suffix = "";
        if (Development) using (var hash = System.Security.Cryptography.SHA256.Create())
            suffix = "-" + BitConverter.ToString(hash.ComputeHash(System.Text.Encoding.UTF8.GetBytes(ProjectRoot.ToLowerInvariant()))).Replace("-", "").Substring(0, 12);
        return @"Local\ShiyeChatPreview" + intent + "V1" + suffix;
    }
    static string ResolveRoot() {
        var directory = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
        while (directory != null) {
            if (File.Exists(Path.Combine(directory.FullName, "package.json")) && Directory.Exists(Path.Combine(directory.FullName, "previews", "telegram-chat"))) return directory.FullName;
            directory = directory.Parent;
        }
        throw new DirectoryNotFoundException("请将聊天程序保留在拾页项目的 outputs 目录内。");
    }
    [STAThread]
    static void Main(string[] args)
    {
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
        catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs error) {
            RecordException(error.Exception);
            using (var dialog = new ThreadExceptionDialog(error.Exception)) {
                if (dialog.ShowDialog() == DialogResult.Abort) Application.Exit();
            }
        };
        AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs error) {
            RecordException(error.ExceptionObject as Exception);
        };
        if (Array.IndexOf(args, "--self-test") >= 0) {
            var area = new Rectangle(-1920, 40, 1920, 1040);
            var left = PreviewWindow.SnapBounds(new Rectangle(-1910, 200, 700, 600), area, 16);
            var right = PreviewWindow.SnapBounds(new Rectangle(-708, 200, 700, 600), area, 16);
            var corner = PreviewWindow.SnapBounds(new Rectangle(-1910, 48, 700, 600), area, 16);
            var bottom = PreviewWindow.SnapBounds(new Rectangle(-1000, 475, 700, 600), area, 16);
            var far = new Rectangle(-1000, 200, 700, 600);
            var minimum = PreviewWindow.MinimumDip;
            var resizeBase = new Rectangle(-1500,200,900,700);
            bool resized = PreviewWindow.ResizeBounds(resizeBase,-80,0,10,minimum) == new Rectangle(-1580,200,980,700)
                && PreviewWindow.ResizeBounds(resizeBase,80,0,11,minimum) == new Rectangle(-1500,200,980,700)
                && PreviewWindow.ResizeBounds(resizeBase,0,-80,12,minimum) == new Rectangle(-1500,120,900,780)
                && PreviewWindow.ResizeBounds(resizeBase,0,80,15,minimum) == new Rectangle(-1500,200,900,780)
                && PreviewWindow.ResizeBounds(resizeBase,-80,-80,13,minimum) == new Rectangle(-1580,120,980,780)
                && PreviewWindow.ResizeBounds(resizeBase,80,-80,14,minimum) == new Rectangle(-1500,120,980,780)
                && PreviewWindow.ResizeBounds(resizeBase,-80,80,16,minimum) == new Rectangle(-1580,200,980,780)
                && PreviewWindow.ResizeBounds(resizeBase,80,80,17,minimum) == new Rectangle(-1500,200,980,780)
                && PreviewWindow.ResizeBounds(resizeBase,9999,9999,13,minimum).Size == minimum
                && PreviewWindow.ResizeBounds(resizeBase,-9999,-9999,17,minimum).Size == minimum;
            bool passed = left.Left == area.Left && right.Right == area.Right && corner.Location == area.Location && bottom.Bottom == area.Bottom && PreviewWindow.SnapBounds(far, area, 16) == far;
            bool displayGeometry = true;
            int displayCases = 0;
            foreach (var resolution in new Size[] { new Size(800,600), new Size(1280,720), new Size(1920,1080), new Size(2560,1440), new Size(3840,2160) })
                foreach (int dpi in new int[] {96,120,144,192}) {
                    var work = new Rectangle(-resolution.Width, 40, resolution.Width, resolution.Height-40);
                    var fit = DisplayLayout.Fit(new Rectangle(8000,-500,4000,3000), work, new Size(PreviewWindow.MinimumDip.Width*dpi/96,PreviewWindow.MinimumDip.Height*dpi/96));
                    displayGeometry &= work.Contains(fit) && fit.Width > 0 && fit.Height > 0;
                    displayCases++;
                }
            var firstScreen = new Rectangle(0,0,1920,1080);
            var secondScreen = new Rectangle(1920,0,2560,1440);
            var screens = new Rectangle[] { firstScreen, secondScreen };
            displayGeometry &= !DisplayLayout.IsExterior(firstScreen,new Rectangle(1220,100,700,600),"right",screens)
                && DisplayLayout.IsExterior(firstScreen,new Rectangle(0,100,700,600),"left",screens)
                && !DisplayLayout.IsExterior(secondScreen,new Rectangle(1920,100,700,600),"left",screens);
            displayGeometry &= DisplayMemory.SelfTest();
            string reportDir = Path.Combine(ProjectRoot,"outputs","2026-10-16-聊天UI优化"); Directory.CreateDirectory(reportDir);
            File.WriteAllText(Path.Combine(reportDir,"display-geometry.json"),new JavaScriptSerializer().Serialize(new {
                passed = passed && resized && displayGeometry, resolutionDpiCases = displayCases,
                displayMemoryPassed=DisplayMemory.SelfTest(), adjacentEdgesPassed = displayGeometry, screens = Array.ConvertAll(Screen.AllScreens, screen => new { device = screen.DeviceName, identity=DisplayMemory.Identity(screen), dpi=DisplayMemory.Dpi(screen,96), bounds = screen.Bounds.ToString(), workArea = screen.WorkingArea.ToString(), primary = screen.Primary })
            }));
            Environment.ExitCode = passed && resized && displayGeometry ? 0 : 1; return;
        }
        if (Array.IndexOf(args, "--verify") >= 0 || Array.IndexOf(args, "--verify-lifecycle") >= 0) { Application.Run(new PreviewWindow(args)); return; }
        string intent = Array.IndexOf(args, "--exit") >= 0 ? "Exit" : Array.IndexOf(args, "--toggle") >= 0 ? "Toggle" : Array.IndexOf(args, "--hide") >= 0 ? "Hide" : "Wake";
        var broker = Path.Combine(ProjectRoot, "拾页快捷记录.exe");
        if (intent != "Exit" && intent != "Hide" && !Development && File.Exists(broker)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(broker, "--resident") { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(broker) }).Dispose();
        using (var instance = new Mutex(false, EventName("Instance"))) {
            bool owns;
            try { owns = instance.WaitOne(0); } catch (AbandonedMutexException) { owns = true; }
            if (!owns) {
                foreach (var process in System.Diagnostics.Process.GetProcessesByName(Path.GetFileNameWithoutExtension(Application.ExecutablePath))) {
                    try { if (process.Id != System.Diagnostics.Process.GetCurrentProcess().Id && process.MainModule.FileName == Application.ExecutablePath) AllowSetForegroundWindow(process.Id); } catch { }
                    finally { process.Dispose(); }
                }
                for (int attempt = 0; attempt < 10; attempt++) {
                    try { using (var wake = EventWaitHandle.OpenExisting(EventName(intent))) wake.Set(); return; }
                    catch (WaitHandleCannotBeOpenedException) { Thread.Sleep(50); }
                }
                return;
            }
            if (intent == "Exit" || intent == "Hide") { instance.ReleaseMutex(); return; }
            try { using (var wake = new EventWaitHandle(false, EventResetMode.AutoReset, EventName("Wake"))) {
                using (var toggle = new EventWaitHandle(false, EventResetMode.AutoReset, EventName("Toggle")))
            using (var hide = new EventWaitHandle(false, EventResetMode.AutoReset, EventName("Hide")))
            using (var exit = new EventWaitHandle(false, EventResetMode.AutoReset, EventName("Exit"))) {
                var window = new PreviewWindow(args);
                var poll = new System.Windows.Forms.Timer { Interval = 150 };
                poll.Tick += delegate { if (exit.WaitOne(0)) window.ExitEditor(); else if (hide.WaitOne(0)) window.HideFromHost(); else if (toggle.WaitOne(0)) window.ToggleEditor(); else if (wake.WaitOne(0)) window.RestoreEditor(); };
                poll.Start(); Application.Run(window); poll.Dispose(); }
            } } finally { instance.ReleaseMutex(); }
        }
    }
    static void RecordException(Exception error)
    {
        try {
            string folder = Path.Combine(ProjectRoot,"outputs","2026-10-16-聊天UI优化"); Directory.CreateDirectory(folder);
            File.AppendAllText(Path.Combine(folder,"native-exceptions.jsonl"),new JavaScriptSerializer().Serialize(new {
                at = DateTime.UtcNow.ToString("o"), type = error == null ? "Unknown" : error.GetType().FullName,
                stack = error == null ? "" : error.StackTrace
            }) + Environment.NewLine);
        } catch (Exception) { }
    }
}

internal sealed partial class PreviewWindow : Form
{
    internal static readonly Size MinimumDip = new Size(360, 600);
    readonly WebView2 web = new WebView2();
    readonly string root = DesktopPreview.ProjectRoot;
    readonly bool development = DesktopPreview.Development;
    ImageViewerBridge imageBridge;
    bool uiOnly;
    readonly string output;
    readonly bool verify, diagnostics, workspaceOnly, frameOnly, journalOnly, lifecycleOnly;
    readonly ChatJournalBridge journalBridge;
    System.Windows.Forms.Timer captureTimer;
    readonly System.Windows.Forms.Timer settingsTimer = new System.Windows.Forms.Timer { Interval = 350 };
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    PreviewWindowSettings saved = new PreviewWindowSettings();
    string focusedTarget = "", focusReportedAtUtc;
    bool pageHasFocus;
    readonly Panel chrome = new Panel();
    int nativeDpi = 96;
    FrameGlyphButton pinButton, maximizeButton, quickWorkspaceButton, notesWorkspaceButton;
    Label chromeCaption;
    FlowLayoutPanel chromeActions;
    readonly Panel[] resizeGrips = new Panel[8];
    bool isResizing;
    Point resizeOrigin;
    Rectangle resizeOriginBounds;
    int resizeHit;
    Panel activeResizeGrip;
    Size lastLayoutSize;
    int lastLayoutDpi;
    FormWindowState lastLayoutState;
    readonly ToolTip chromeTip = new ToolTip();
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, int message, IntPtr first, IntPtr second);
    bool inputPending = true;
    bool ready;
    bool localStoreReady;
    bool exiting;
    bool everReady, initialLoadPending = true, pageNavigationStarted, formClosed;
    int shutdownFallbackArmed;
    HostExitDisposition exitDisposition;
    string lifecyclePhase = "initializing";
    readonly HostSaveLifecycle saveLifecycle = new HostSaveLifecycle();
    bool hidePending { get { return saveLifecycle.Pending; } }
    string pageFailure;
    bool restoring, activating, recoveryReloadPending, recoverySavePending, pageProcessExited;
    int lifecycleLogCount, routineLifecycleLogCount, pageGeneration;
    ulong currentNavigationId;
    readonly Panel recoveryPanel = new Panel { Visible = false, BackColor = Color.FromArgb(39, 51, 57) };
    readonly Label recoveryLabel = new Label { ForeColor = Color.White, AutoSize = false };
    readonly Button recoveryReload = new Button { Text = "重新加载页面", UseVisualStyleBackColor = true };
    readonly Button recoveryClose = new Button { Text = "关闭窗口", UseVisualStyleBackColor = true };
    readonly Button recoverySave = new Button { Text = "重试保存", UseVisualStyleBackColor = true };
    internal Func<string, Task<string>> LifecycleVerificationScript;
    Task<string> ExecutePageScript(string script)
    {
        return lifecycleOnly && LifecycleVerificationScript != null ? LifecycleVerificationScript(script) : web.CoreWebView2.ExecuteScriptAsync(script);
    }
    string runtimeRevision;
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    string SettingsPath { get { return lifecycleOnly ? Path.Combine(output, "probe-state", "window.json") : verify ? Path.Combine(root, "tmp", "telegram-preview-20261015", "verification-window.json") : Path.Combine(DesktopPreview.Paths.StateDirectory, "telegram-chat-preview", "window.json"); } }

    internal PreviewWindow(string[] args)
    {
        string executableDirectory = AppDomain.CurrentDomain.BaseDirectory;
        lifecycleOnly = Array.IndexOf(args, "--verify-lifecycle") >= 0;
        output = lifecycleOnly || Directory.Exists(Path.Combine(executableDirectory, "app")) ? executableDirectory : Path.Combine(root, "outputs", "2026-10-15-Telegram聊天预览");
        verify = lifecycleOnly || Array.IndexOf(args, "--verify") >= 0;
        diagnostics = Array.IndexOf(args, "--diagnostics") >= 0;
        workspaceOnly = Array.IndexOf(args, "--verify-workspace") >= 0;
        frameOnly = Array.IndexOf(args, "--verify-frame") >= 0;
        journalOnly = Array.IndexOf(args, "--verify-journal") >= 0;
        uiOnly = Array.IndexOf(args, "--verify-ui") >= 0;
        journalBridge = new ChatJournalBridge(root, verify, journalOnly, development);
        json.MaxJsonLength = 8 * 1024 * 1024;
        Text = verify ? "拾页 · 随想 · 自动验收（合成数据）" : development ? "拾页 · 随想 · 开发版" : "拾页 · 随想";
        ClientSize = new Size(1180, 820);
        MinimumSize = MinimumDip;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(41, 45, 48);
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        Padding = new Padding(1);
        AutoScaleMode = AutoScaleMode.Dpi;
        using (var graphics = CreateGraphics()) {
            nativeDpi = (int)Math.Round(graphics.DpiX);
            var scale = nativeDpi / 96.0;
            var area = Screen.FromControl(this).WorkingArea;
            ClientSize = new Size(Math.Min((int)(1180 * scale), (int)(area.Width * 0.94)), Math.Min((int)(820 * scale), (int)(area.Height * 0.9)));
        }
        Icon = new Icon(Path.Combine(root, "public", "icons", "shiye-hd.ico"));
        web.Dock = DockStyle.None;
        web.DefaultBackgroundColor = Color.FromArgb(32, 41, 46);
        Controls.Add(web);
        BuildChrome();
        BuildRecoveryArea();
        BuildResizeGrips();
        RestoreSettings();
        RestoreDisplayAtStartup();
        InitializeDock();
        AdaptDisplay(nativeDpi, null);
        UpdatePin();
        settingsTimer.Tick += delegate {
            settingsTimer.Stop();
            if(!nativeMoving && !isResizing) {
                var reference=dockHidden || dockAnimating?expandedBounds:Bounds;
                if(SelectDisplay(reference,nativeDpi)) AdaptDisplay(nativeDpi,null);
                SaveSettings();
            }
        };
        Move += delegate { if (ready && !dockAnimating && !adaptingDisplay && !switchingDisplay) { settingsTimer.Stop(); settingsTimer.Start(); } };
        ResizeEnd += delegate { SnapToEdge(); SaveSettings(); };
        Activated += async delegate {
            inputPending = true;
            if (!restoring && !activating && ready && pageFailure == null && web.CoreWebView2 != null) {
                activating = true;
                int generation = pageGeneration;
                try {
                web.Focus();
                await HostSaveLifecycle.ExecuteAsync(() => ExecutePageScript("window.dispatchEvent(new Event('shiye-resume'))"), 3000);
                } catch (Exception error) { if (generation == pageGeneration) SetPageFailure("页面恢复输入未完成", "activation", error); }
                finally { activating = false; }
            }
        };
        FormClosing += async delegate(object sender, FormClosingEventArgs e) {
            if (verify || exiting || e.CloseReason == CloseReason.WindowsShutDown) return;
            e.Cancel = true; await HideEditor(false);
        };
        FormClosed += delegate {
            formClosed = true; lifecyclePhase = "form-closed";
            LogLifecycle("form-closed", null, null, null, null);
            try { SaveSettings(); } catch (Exception) { }
            try { WriteRuntimeStatus(false); } catch (Exception) { }
            if (exiting && exitDisposition != HostExitDisposition.None && Interlocked.Exchange(ref shutdownFallbackArmed, 1) == 0)
                ArmClosedProcessFallback(Path.Combine(output, "native-shutdown.jsonl"), System.Diagnostics.Process.GetCurrentProcess().Id, exitDisposition.ToString(), runtimeRevision);
            settingsTimer.Dispose(); chromeTip.Dispose(); journalBridge.Dispose(); if (imageBridge != null) imageBridge.Dispose();
        };
        Shown += async delegate { await LoadPreview(); };
    }

    void BuildChrome()
    {
        chrome.BackColor = Color.FromArgb(41, 45, 48);
        chromeCaption = new Label { Text = "拾页", ForeColor = Color.FromArgb(202, 208, 212), TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(12, 0, 0, 0), Font = new Font("Microsoft YaHei UI", (float)(12 * nativeDpi / 96.0), GraphicsUnit.Pixel) };
        quickWorkspaceButton = CaptionButton(FrameGlyph.QuickWrite, "打开思绪", delegate { OpenWorkspace("quick"); });
        quickWorkspaceButton.Name = "ShiyeQuickWorkspace";
        notesWorkspaceButton = CaptionButton(FrameGlyph.Notes, "打开便签", delegate { OpenWorkspace("notes"); });
        notesWorkspaceButton.Name = "ShiyeNotesWorkspace";
        chromeActions = new FlowLayoutPanel { Dock = DockStyle.Right, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0), Padding = new Padding(0) };
        pinButton = CaptionButton(FrameGlyph.Pin, "窗口置顶", delegate { TopMost = saved.TopMost = !TopMost; UpdatePin(); SaveSettings(); if (ready) SendWindowState(); RestoreEditor(); });
        pinButton.Name = "ShiyePin";
        chromeActions.Controls.Add(pinButton);
        chromeActions.Controls.Add(CaptionButton(FrameGlyph.Minimize, "最小化", delegate { WindowState = FormWindowState.Minimized; }));
        maximizeButton = CaptionButton(FrameGlyph.Maximize, "最大化", ToggleMaximized);
        chromeActions.Controls.Add(maximizeButton);
        chromeActions.Controls.Add(CaptionButton(FrameGlyph.Close, "保存并退到托盘", delegate { Close(); }));
        MouseEventHandler drag = delegate(object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Left) { if (e.Clicks == 2) { ToggleMaximized(); return; } ReleaseCapture(); SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero); } };
        chrome.MouseDown += drag; chromeCaption.MouseDown += drag;
        chrome.Controls.Add(chromeCaption); chrome.Controls.Add(quickWorkspaceButton); chrome.Controls.Add(notesWorkspaceButton);
        chrome.Controls.Add(chromeActions); Controls.Add(chrome);
        chromeCaption.BringToFront(); chrome.BringToFront();
    }
    FrameGlyphButton CaptionButton(FrameGlyph glyph, string name, Action action)
    {
        var button = new FrameGlyphButton { Glyph = glyph, AccessibleName = name, Margin = new Padding(0), TabStop = false, ScaleFactor = nativeDpi / 96f };
        button.Click += delegate { action(); }; chromeTip.SetToolTip(button, name); return button;
    }
    async void OpenWorkspace(string kind)
    {
        var button=kind=="quick"?quickWorkspaceButton:notesWorkspaceButton;
        if(!button.Enabled) return;
        button.Enabled=false; button.UseWaitCursor=true; button.IsActive=true; button.Invalidate();
        try {
            var plan = await WorkspaceLauncher.LaunchAsync(root, development, kind, verify);
            if(IsDisposed || Disposing) return;
            if (verify) File.AppendAllText(Path.Combine(output,"workspace-launch-plans.jsonl"),json.Serialize(plan)+Environment.NewLine);
            if (ready) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {kind="workspace-launch-result",workspace=kind,verification=verify,plan=verify?plan:null}));
        } catch (Exception error) {
            if (ready && !web.IsDisposed) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {kind="workspace-launch-result",workspace=kind,error=error.Message}));
        } finally {
            if(!button.IsDisposed) {button.Enabled=true;button.UseWaitCursor=false;button.IsActive=false;button.Invalidate();}
        }
    }
    object WorkspaceHeaderState()
    {
        return new {
            noOverlap=quickWorkspaceButton.Right<=notesWorkspaceButton.Left && notesWorkspaceButton.Right<=chromeActions.Left,
            compact=String.IsNullOrEmpty(quickWorkspaceButton.CaptionText),
            buttons=Array.ConvertAll(new FrameGlyphButton[]{quickWorkspaceButton,notesWorkspaceButton},button=>new {
                workspace=button==quickWorkspaceButton?"quick":"notes", name=button.AccessibleName,
                x=chrome.Left+button.Left,y=chrome.Top+button.Top,width=button.Width,height=button.Height,
                caption=button.CaptionText
            })
        };
    }
    void BuildResizeGrips()
    {
        var cursors = new Cursor[] { Cursors.SizeWE, Cursors.SizeWE, Cursors.SizeNS, Cursors.SizeNS, Cursors.SizeNWSE, Cursors.SizeNESW, Cursors.SizeNESW, Cursors.SizeNWSE };
        for (int index = 0; index < resizeGrips.Length; index++) {
            int hit = new int[] {10,11,12,15,13,14,16,17}[index];
            var grip = new Panel { Cursor = cursors[index], TabStop = false, BackColor = Color.FromArgb(41,45,48), Name = "ResizeGrip" + hit };
            grip.MouseDown += delegate(object sender, MouseEventArgs e) {
                if (e.Button != MouseButtons.Left || WindowState != FormWindowState.Normal) return;
                BeginResize((Panel)sender,hit);
            };
            grip.MouseMove += delegate {
                if (!isResizing || activeResizeGrip != grip) return;
                var current = Cursor.Position;
                Bounds = ResizeBounds(resizeOriginBounds, current.X-resizeOrigin.X, current.Y-resizeOrigin.Y, resizeHit, MinimumSize);
            };
            grip.MouseUp += delegate(object sender, MouseEventArgs e) { if(e.Button==MouseButtons.Left) EndResize(); };
            grip.MouseCaptureChanged += delegate { if(isResizing && activeResizeGrip==grip && !grip.Capture) EndResize(); };
            resizeGrips[index] = grip; Controls.Add(grip); grip.BringToFront();
        }
    }
    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        if (chrome == null || web == null || chromeActions == null) return;
        if (lastLayoutSize == ClientSize && lastLayoutDpi == nativeDpi && lastLayoutState == WindowState) return;
        lastLayoutSize = ClientSize; lastLayoutDpi = nativeDpi; lastLayoutState = WindowState;
        int edge = WindowState == FormWindowState.Normal ? ScaleDip(8) : 0;
        int corner = ScaleDip(18), header = ScaleDip(36), top = 0;
        chrome.Bounds = new Rectangle(edge, top, Math.Max(0, ClientSize.Width-2*edge), header);
        chromeActions.Width = ScaleDip(44) * 4;
        bool compactWorkspaces = ClientSize.Width < ScaleDip(440);
        chromeCaption.Bounds = new Rectangle(0,0,ScaleDip(48),header);
        quickWorkspaceButton.CaptionText = compactWorkspaces ? "" : "思绪";
        notesWorkspaceButton.CaptionText = compactWorkspaces ? "" : "便签";
        quickWorkspaceButton.Bounds = new Rectangle(ScaleDip(48),0,ScaleDip(compactWorkspaces?44:72),header);
        notesWorkspaceButton.Bounds = new Rectangle(quickWorkspaceButton.Right,0,ScaleDip(44),header);
        quickWorkspaceButton.ScaleFactor = notesWorkspaceButton.ScaleFactor = nativeDpi/96f;
        quickWorkspaceButton.Invalidate(); notesWorkspaceButton.Invalidate();
        foreach (FrameGlyphButton button in chromeActions.Controls) {
            button.Size = new Size(ScaleDip(44), header); button.ScaleFactor = nativeDpi/96f; button.Invalidate();
        }
        maximizeButton.Glyph = WindowState == FormWindowState.Maximized ? FrameGlyph.Restore : FrameGlyph.Maximize;
        maximizeButton.AccessibleName = WindowState == FormWindowState.Maximized ? "还原窗口" : "最大化";
        chromeTip.SetToolTip(maximizeButton, maximizeButton.AccessibleName);
        web.Bounds = new Rectangle(edge, top+header, Math.Max(0, ClientSize.Width-2*edge), Math.Max(0, ClientSize.Height-top-header-edge));
        LayoutRecoveryArea();
        var bounds = new Rectangle[] {
            new Rectangle(0,corner,edge,Math.Max(0,ClientSize.Height-2*corner)),
            new Rectangle(ClientSize.Width-edge,corner,edge,Math.Max(0,ClientSize.Height-2*corner)),
            new Rectangle(corner,0,Math.Max(0,ClientSize.Width-2*corner),edge),
            new Rectangle(corner,ClientSize.Height-edge,Math.Max(0,ClientSize.Width-2*corner),edge),
            new Rectangle(0,0,corner,corner),new Rectangle(ClientSize.Width-corner,0,corner,corner),
            new Rectangle(0,ClientSize.Height-corner,corner,corner),new Rectangle(ClientSize.Width-corner,ClientSize.Height-corner,corner,corner)
        };
        for (int i=0;i<resizeGrips.Length;i++) if (resizeGrips[i]!=null) {
            resizeGrips[i].Bounds=bounds[i]; resizeGrips[i].Visible=WindowState==FormWindowState.Normal;
            if (i >= 4) {
                int width = resizeGrips[i].Width, height = resizeGrips[i].Height;
                bool right = i == 5 || i == 7, bottom = i >= 6;
                var region = new Region(new Rectangle(right ? width-edge : 0, 0, edge, height));
                region.Union(new Rectangle(0, bottom ? height-edge : 0, width, edge));
                var oldRegion = resizeGrips[i].Region; resizeGrips[i].Region = region;
                if (oldRegion != null) oldRegion.Dispose();
            }
            resizeGrips[i].BringToFront();
        }
    }
    int ScaleDip(int value) { return Math.Max(1,(int)Math.Round(value*nativeDpi/96.0)); }
    void UpdatePin()
    {
        if (pinButton == null) return;
        pinButton.AccessibleName = TopMost ? "取消窗口置顶" : "窗口置顶";
        pinButton.IsActive = TopMost;
        chromeTip.SetToolTip(pinButton, pinButton.AccessibleName); pinButton.Invalidate();
    }
    void ToggleMaximized()
    {
        MaximizedBounds = Screen.FromControl(this).WorkingArea;
        WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
        if (WindowState == FormWindowState.Normal) AdaptDisplay(nativeDpi, null);
        SaveSettings(); RestoreEditor();
    }
    internal static Rectangle SnapBounds(Rectangle bounds, Rectangle area, int distance)
    {
        if (bounds.Width <= area.Width) {
            if (Math.Abs(bounds.Left-area.Left) <= distance) bounds.X = area.Left;
            else if (Math.Abs(bounds.Right-area.Right) <= distance) bounds.X = area.Right-bounds.Width;
        }
        if (bounds.Height <= area.Height) {
            if (Math.Abs(bounds.Top-area.Top) <= distance) bounds.Y = area.Top;
            else if (Math.Abs(bounds.Bottom-area.Bottom) <= distance) bounds.Y = area.Bottom-bounds.Height;
        }
        // Keep an overshot edge reachable even after it leaves the magnetic threshold.
        bounds.X = bounds.Width <= area.Width ? Math.Max(area.Left, Math.Min(area.Right-bounds.Width, bounds.X)) : area.Left;
        bounds.Y = bounds.Height <= area.Height ? Math.Max(area.Top, Math.Min(area.Bottom-bounds.Height, bounds.Y)) : area.Top;
        return bounds;
    }
    void SnapToEdge()
    {
        if (!saved.EdgeSnap || WindowState != FormWindowState.Normal) return;
        if (dockHidden || dockAnimating) return;
        Bounds = SnapBounds(Bounds, Screen.FromRectangle(Bounds).WorkingArea, (int)(16 * nativeDpi / 96.0));
        UpdateDockEdge();
    }
    void BeginResize(Panel grip,int hit)
    {
        if(WindowState!=FormWindowState.Normal || (Control.MouseButtons & MouseButtons.Left)==0) return;
        StopDockAnimation(); dockHidden = false; dockEdge = null;
        activeResizeGrip=grip;resizeHit=hit;
        resizeOrigin=Cursor.Position;resizeOriginBounds=Bounds;
        isResizing=true;activeResizeGrip.Capture=true;
    }
    void EndResize()
    {
        if(!isResizing) return;
        isResizing=false;
        if(activeResizeGrip!=null) activeResizeGrip.Capture=false;
        activeResizeGrip=null;
        SnapToEdge(); SaveSettings();
    }
    internal static Rectangle ResizeBounds(Rectangle original, int dx, int dy, int hit, Size minimum)
    {
        int left=original.Left, right=original.Right, top=original.Top, bottom=original.Bottom;
        if(hit==10 || hit==13 || hit==16) left=Math.Min(original.Left+dx,right-minimum.Width);
        if(hit==11 || hit==14 || hit==17) right=Math.Max(original.Right+dx,left+minimum.Width);
        if(hit==12 || hit==13 || hit==14) top=Math.Min(original.Top+dy,bottom-minimum.Height);
        if(hit==15 || hit==16 || hit==17) bottom=Math.Max(original.Bottom+dy,top+minimum.Height);
        return Rectangle.FromLTRB(left,top,right,bottom);
    }

    internal async void ExitEditor()
    {
        try {
            if (pageFailure != null) { ShowRecoveryArea(); return; }
            if (await PrepareToHide()) { exiting = true; Close(); }
        } catch (Exception error) { SetPageFailure("页面退出未完成", "exit", error); }
    }
    internal async void HideFromHost() { await HideEditor(true); }
    internal async void ToggleEditor()
    {
        if (hidePending) return;
        if (dockHidden) { RestoreEditor(); return; }
        if (Visible && GetForegroundWindow() == Handle) await HideEditor(true);
        else RestoreEditor();
    }
    internal async void RestoreEditor(bool startup = false, bool hover = false)
    {
        if (IsDisposed || Disposing || restoring) return;
        restoring = true;
        int generation = pageGeneration;
        try {
        if (!hover) RevealDock();
        Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate(); BringToFront(); web.Focus(); inputPending = true;
        if (pageFailure != null) { ShowRecoveryArea(); return; }
        if (ready) await HostSaveLifecycle.ExecuteAsync(() => ExecutePageScript(startup
            ? "window.dispatchEvent(new Event('shiye-startup-focus'))"
            : hover ? "window.dispatchEvent(new Event('shiye-hover-resume'))"
            : "window.dispatchEvent(new Event('shiye-hotkey-resume'))"), 3000);
        RecordHostState();
        } catch (Exception error) { if (generation == pageGeneration) SetPageFailure("页面恢复未完成", "restore", error); }
        finally { restoring = false; }
    }
    async void ConfirmLocalStoreReady()
    {
        // Verify against the current document and generation; an old page's queued
        // readiness message cannot arm automatic retraction after navigation.
        int generation = pageGeneration;
        try {
            string value = await HostSaveLifecycle.ExecuteAsync(() => ExecutePageScript("window.shiyeLocalStoreReady === true"), 3000);
            if (generation != pageGeneration || IsDisposed || Disposing || value != "true" || localStoreReady) return;
            localStoreReady = true; WriteRuntimeStatus(ready); LogLifecycle("local-store-ready", null, null, null, null);
        } catch (Exception error) { if (generation == pageGeneration && !IsDisposed && !Disposing) LogLifecycle("local-store-probe", error.GetType().Name, null, null, null); }
    }
    async Task HideEditor(bool fromHotkey)
    {
        if (hidePending) return;
        if (pageFailure != null) { ShowRecoveryArea(); return; }
        if (fromHotkey && saved.ConfirmHide && MessageBox.Show(this, "保存草稿并收起聊天窗口？", "拾页 · 随想", MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button1) != DialogResult.OK) return;
        if (await PrepareToHide()) { SaveSettings(); if (dockEdge != null && saved.EdgeSnap) AnimateDock(true); else Hide(); RecordHostState(); }
    }
    async Task<bool> PrepareToHide()
    {
        if (hidePending) return false;
        exitDisposition = HostExitDisposition.None;
        if (pageFailure != null) { ShowRecoveryArea(); return false; }
        if (!ready) {
            if (!everReady && initialLoadPending && !pageNavigationStarted) { exitDisposition = HostExitDisposition.NeverReadyInitialClose; return true; }
            SetPageFailure("页面尚未就绪，保存未得到确认，窗口继续保留", "save-not-ready", null); return false;
        }
        int generation = pageGeneration;
        lifecyclePhase = "save-start"; WriteRuntimeStatus(ready); LogLifecycle("save-start", null, null, null, null);
        var outcome = await saveLifecycle.SaveAsync(ticket => ExecutePageScript(
            "window.dispatchEvent(new CustomEvent('shiye-before-hide',{detail:'" + ticket + "'}))"), 10000);
        if (generation != pageGeneration || IsDisposed || Disposing) return false;
        if (outcome == HostSaveOutcome.Saved) exitDisposition = HostExitDisposition.LocalSaveAck;
        lifecyclePhase = "save-" + outcome.ToString(); WriteRuntimeStatus(ready); LogLifecycle(lifecyclePhase, null, null, null, null);
        if (outcome == HostSaveOutcome.Saved) return true;
        if (outcome != HostSaveOutcome.Busy)
            SetPageFailure("草稿保存未得到确认，窗口继续保留", "save-" + outcome.ToString(), null);
        return false;
    }

    // Only a closed, explicitly permitted form reaches this static background path.
    // Snapshots contain no Form/WebView objects; log latency cannot hold up Exit.
    static void ArmClosedProcessFallback(string logPath, int pid, string disposition, string revision)
    {
        Task.Run(async delegate {
            await Task.Delay(5000);
            var logging = Task.Run(delegate {
                try {
                    if (File.Exists(logPath) && new FileInfo(logPath).Length >= 256*1024) return;
                    File.AppendAllText(logPath, new JavaScriptSerializer().Serialize(new {
                        atUtc=DateTime.UtcNow.ToString("o"), stage="shutdown-timeout", forced=true,
                        pid=pid, disposition=disposition, uiRevision=revision
                    }) + Environment.NewLine);
                } catch (Exception) { }
            });
            await Task.WhenAny(logging, Task.Delay(150));
            Environment.Exit(0);
        });
    }

    void BuildRecoveryArea()
    {
        recoveryPanel.AccessibleName = "页面恢复";
        recoveryPanel.Controls.Add(recoveryLabel); recoveryPanel.Controls.Add(recoveryReload); recoveryPanel.Controls.Add(recoveryClose); recoveryPanel.Controls.Add(recoverySave);
        recoverySave.Click += async delegate { await RetryRecoverySave(); };
        recoveryReload.Click += delegate {
            if (recoveryReloadPending || recoverySavePending || IsDisposed || Disposing) return;
            recoveryReloadPending = true; recoveryReload.Enabled = false;
            recoveryLabel.Text = "正在重新加载页面；未保存输入可能已经丢失。若仍无法恢复，可关闭窗口后重开。";
            try { web.CoreWebView2.Reload(); }
            catch (Exception error) { SetPageFailure("重新加载未完成，请关闭窗口后重开", "reload", error); }
        };
        recoveryClose.Click += delegate {
            // This explicit native action does not claim an unresponsive page saved its draft.
            exitDisposition = HostExitDisposition.ExplicitRecoveryClose;
            exiting = true; saveLifecycle.Interrupt(); SaveSettings(); Close();
        };
        Controls.Add(recoveryPanel);
    }
    async Task RetryRecoverySave()
    {
        if (recoverySavePending || recoveryReloadPending || pageProcessExited || IsDisposed || Disposing) return;
        recoverySavePending = true; recoverySave.Enabled = false; recoveryReload.Enabled = false;
        int generation = pageGeneration;
        recoveryLabel.Text = "正在重试保存当前页面，不会重新加载或清空输入。";
        try {
            var outcome = await saveLifecycle.SaveAsync(ticket => ExecutePageScript(
                "window.dispatchEvent(new CustomEvent('shiye-before-hide',{detail:'" + ticket + "'}))"), 10000);
            if (generation != pageGeneration || IsDisposed || Disposing) return;
            if (outcome != HostSaveOutcome.Saved) { SetPageFailure("重试保存仍未得到确认，当前页面继续保留", "retry-"+outcome.ToString(), null); return; }
            string revision = json.Deserialize<string>(await HostSaveLifecycle.ExecuteAsync(() => ExecutePageScript("window.shiyeFrameUiVersion || null"), 3000));
            if (generation != pageGeneration || IsDisposed || Disposing) return;
            if (String.IsNullOrEmpty(revision)) { SetPageFailure("保存已确认，但页面版本尚未就绪", "retry-revision", null); return; }
            runtimeRevision = revision; pageFailure = null; ready = true; everReady = true; initialLoadPending = false; lifecyclePhase = "ready"; recoveryPanel.Visible = false; WriteRuntimeStatus(true);
            LogLifecycle("retry-saved", null, null, null, null);
        } catch (Exception error) {
            if (generation == pageGeneration) SetPageFailure("重试保存未完成，当前页面继续保留", "retry-script", error);
        } finally {
            recoverySavePending = false;
            if (!IsDisposed && !Disposing) { recoverySave.Enabled = !pageProcessExited; recoveryReload.Enabled = !recoveryReloadPending; }
        }
    }
    void LayoutRecoveryArea()
    {
        int padding = ScaleDip(12), buttonHeight = ScaleDip(32);
        recoveryPanel.Bounds = new Rectangle(web.Left, web.Top, web.Width, Math.Min(web.Height, ScaleDip(180)));
        recoveryLabel.Bounds = new Rectangle(padding, padding, Math.Max(0,recoveryPanel.Width-padding*2), Math.Max(0,recoveryPanel.Height-padding*3-buttonHeight));
        int available = Math.Max(0,recoveryPanel.Width-padding*4);
        int saveWidth = available*100/330, reloadWidth = available*130/330;
        recoverySave.Bounds = new Rectangle(padding,recoveryPanel.Height-padding-buttonHeight,saveWidth,buttonHeight);
        recoveryReload.Bounds = new Rectangle(recoverySave.Right+padding,recoverySave.Top,reloadWidth,buttonHeight);
        recoveryClose.Bounds = new Rectangle(recoveryReload.Right+padding,recoveryReload.Top,available-saveWidth-reloadWidth,buttonHeight);
    }
    void ShowRecoveryArea()
    {
        if (IsDisposed || Disposing) return;
        RevealDock(); Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        LayoutRecoveryArea(); recoveryPanel.Visible = true; recoveryPanel.BringToFront(); chrome.BringToFront();
    }
    void SetPageFailure(string description, string stage, Exception error)
    {
        if (IsDisposed || Disposing) return;
        bool first = pageFailure == null;
        pageFailure = description; ready = false; initialLoadPending = false; lifecyclePhase = "page-failure"; pageGeneration++; saveLifecycle.Interrupt();
        recoveryReloadPending = false; recoveryReload.Enabled = true;
        recoverySave.Enabled = !pageProcessExited && !recoverySavePending;
        recoveryLabel.Text = description + "。可先重试保存；页面进程已退出时不能重试。重新加载或关闭窗口可能丢失未保存输入，请自行选择；不会自动重载。";
        WriteRuntimeStatus(false);
        LogLifecycle(stage, error == null ? null : error.GetType().Name, null, null, null);
        if (first || !recoveryPanel.Visible) ShowRecoveryArea();
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LifecycleMemory
    {
        internal uint Length, Load;
        internal ulong TotalPhysical, AvailablePhysical, TotalCommit, AvailableCommit, TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx(ref LifecycleMemory memory);
    void LogLifecycle(string stage, string exceptionType, int? failureKind, int? reason, int? exitCode)
    {
        bool routine = stage == "save-start" || stage == "save-Saved";
        if (routine ? routineLifecycleLogCount++ >= 8 : lifecycleLogCount++ >= 32 && stage != "form-closed") return;
        try {
            string file = Path.Combine(output, "native-lifecycle.jsonl");
            if (File.Exists(file) && new FileInfo(file).Length >= 256*1024) return;
            var memory = new LifecycleMemory { Length = (uint)Marshal.SizeOf(typeof(LifecycleMemory)) };
            bool memoryAvailable = GlobalMemoryStatusEx(ref memory);
            using (var process = System.Diagnostics.Process.GetCurrentProcess())
                File.AppendAllText(file,json.Serialize(new { atUtc=DateTime.UtcNow.ToString("o"), stage=stage,
                    exceptionType=exceptionType, failureKind=failureKind, reason=reason, exitCode=exitCode,
                    disposition=exitDisposition.ToString(), phase=lifecyclePhase,
                    privateBytes=process.PrivateMemorySize64, workingSetBytes=process.WorkingSet64,
                    memoryAvailable=memoryAvailable, physicalLoad=memory.Load, availablePhysical=memory.AvailablePhysical,
                    commitLimit=memory.TotalCommit, commitAvailable=memory.AvailableCommit }) + Environment.NewLine);
        } catch (Exception) { }
    }
    void OpenSharedSettings()
    {
        if (verify) return;
        if (development) { MessageBox.Show(this, "开发版使用 Ctrl＋Alt＋F15 唤回／收起。旧正式版 F15 和共享后台保持原配置。", "开发版快捷键"); return; }
        var path = Path.Combine(root, "拾页快捷记录.exe");
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path, "--host-settings") { WorkingDirectory = root, UseShellExecute = false }).Dispose();
    }
    void SendWindowState()
    {
        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "window-state", zoom = 1, textScale = saved.TextScale ?? 1, inputMode = saved.InputMode, x = Left, y = Top, width = Width, height = Height, confirmHide = saved.ConfirmHide, topmost = TopMost, edgeSnap = saved.EdgeSnap, dockHideDelayMs = saved.DockHideDelayMs, dockActivateOnHover = saved.DockActivateOnHover, dockMotionStyle = DockMotion.NormalizeStyle(saved.DockMotionStyle), workspaces = WorkspaceHeaderState(), frame = FormBorderStyle.ToString(), caption = Text, resizeEdgeDip = 8, resizeCornerDip = 18, glyphDip = 14, headerFontPx = chromeCaption.Font.Size, resizeMode = "captured-native-grips", grips = Array.ConvertAll(resizeGrips, grip => new { name = grip.Name, x = grip.Left, y = grip.Top, width = grip.Width, height = grip.Height, visible = grip.Visible }), chromeHeight = chrome.Height, webTop = web.Top, dpi = nativeDpi, workArea = new { x = Screen.FromControl(this).WorkingArea.X, y = Screen.FromControl(this).WorkingArea.Y, width = Screen.FromControl(this).WorkingArea.Width, height = Screen.FromControl(this).WorkingArea.Height }, visible = Visible, hotkeyOwner = "拾页统一快捷后台" }));
    }
    void WriteRuntimeStatus(bool isReady, int attempt = 0)
    {
        try {
            string file = Path.Combine(Path.GetDirectoryName(SettingsPath),"runtime-status.json");
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            string temporary = file + "." + System.Diagnostics.Process.GetCurrentProcess().Id + ".tmp";
            File.WriteAllText(temporary,json.Serialize(new {
                protocol = 1, atUtc = DateTime.UtcNow.ToString("o"), pid = System.Diagnostics.Process.GetCurrentProcess().Id,
                executable = Application.ExecutablePath, ready = isReady && pageFailure == null && !String.IsNullOrEmpty(runtimeRevision), uiRevision = runtimeRevision,
                recoveryRequired = pageFailure != null, savePending = hidePending, saveRequested = lifecyclePhase == "save-start", localStoreReady = localStoreReady, showInTaskbar = ShowInTaskbar,
                lifecyclePhase=lifecyclePhase, exitDisposition=exitDisposition.ToString(), everReady=everReady, pageNavigationStarted=pageNavigationStarted, formClosed=formClosed,
                displayMemoryVersion=1, displayId=activeDisplayId, textScale=saved.TextScale ?? 1, displayProfiles=saved.Displays==null?0:saved.Displays.Count,
                focusedElement=focusedTarget,pageFocused=pageHasFocus,foreground=GetForegroundWindow()==Handle,focusReportedAtUtc=focusReportedAtUtc
            }));
            if (File.Exists(file)) File.Replace(temporary,file,null); else File.Move(temporary,file);
        } catch (Exception error) {
            if(verify || diagnostics) File.AppendAllText(Path.Combine(output,"runtime-status-errors.log"),error.GetType().Name+": "+error.Message+Environment.NewLine);
            if(isReady && attempt<3 && IsHandleCreated && !IsDisposed && !Disposing) {
                var retry=new System.Windows.Forms.Timer {Interval=250};
                retry.Tick+=delegate { retry.Stop();retry.Dispose();if(!IsDisposed && !Disposing) WriteRuntimeStatus(true,attempt+1); };
                retry.Start();
            }
        }
    }
    void RestoreSettings()
    {
        try {
            if (!File.Exists(SettingsPath)) { saved.UpgradeHoverInputPreference(); return; }
            saved = json.Deserialize<PreviewWindowSettings>(File.ReadAllText(SettingsPath)) ?? new PreviewWindowSettings();
            saved.UpgradeHoverInputPreference();
            if (saved.Width >= MinimumDip.Width && saved.Height >= 500) {
                var bounds = new Rectangle(saved.X, saved.Y, saved.Width, saved.Height);
                bool visible = false;
                foreach (var screen in Screen.AllScreens) {
                    var intersection = Rectangle.Intersect(bounds, screen.WorkingArea);
                    if (intersection.Width >= 160 && intersection.Height >= 100) visible = true;
                }
                if (visible) { StartPosition = FormStartPosition.Manual; Bounds = bounds; }
            }
            if (saved.Maximized) WindowState = FormWindowState.Maximized;
            TopMost = saved.TopMost;
            if (saved.ZoomFactor < 0.5 || saved.ZoomFactor > 2.5) saved.ZoomFactor = 1;
            if (!saved.TextScale.HasValue) saved.TextScale = saved.ZoomFactor;
            saved.TextScale = Math.Max(0.5, Math.Min(2.5, saved.TextScale.Value));
            saved.ZoomFactor = 1;
            saved.DockHideDelayMs = Math.Max(0, Math.Min(3000, saved.DockHideDelayMs));
            saved.DockMotionStyle = DockMotion.NormalizeStyle(saved.DockMotionStyle);
        } catch { saved = new PreviewWindowSettings(); saved.UpgradeHoverInputPreference(); }
    }

    void SaveSettings()
    {
        try {
            if(switchingDisplay || nativeMoving || isResizing) return;
            var bounds = dockHidden || dockAnimating ? expandedBounds : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            if(SelectDisplay(bounds,nativeDpi)) {
                bounds=WindowState==FormWindowState.Normal?Bounds:RestoreBounds;
                if(ready) SendWindowState();
            }
            if(activeDisplayId!=null) RememberDisplay(bounds,Screen.FromRectangle(bounds).WorkingArea);
            saved.X = bounds.X; saved.Y = bounds.Y; saved.Width = bounds.Width; saved.Height = bounds.Height;
            saved.Maximized = WindowState == FormWindowState.Maximized || (WindowState==FormWindowState.Minimized && saved.Maximized);
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath));
            var temporary = SettingsPath + "." + System.Diagnostics.Process.GetCurrentProcess().Id + ".tmp";
            File.WriteAllText(temporary, json.Serialize(saved));
            if (File.Exists(SettingsPath)) File.Replace(temporary, SettingsPath, null); else File.Move(temporary, SettingsPath);
        } catch (Exception error) { File.AppendAllText(Path.Combine(output, "window-settings-errors.log"), error.Message + Environment.NewLine); }
    }

    async Task LoadPreview()
    {
        try {
            string profile = lifecycleOnly ? Path.Combine(output, "probe-state", "webview") : verify ? Path.Combine(root, "tmp", "telegram-preview-20261015", "verification-profile") : Path.Combine(DesktopPreview.Paths.StateDirectory, "telegram-chat-preview", "webview");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            if (IsDisposed || Disposing || web.IsDisposed) return;
            web.CoreWebView2.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs failure) {
                LogLifecycle("process-failed", null, (int)failure.ProcessFailedKind, (int)failure.Reason, failure.ExitCode);
                if (failure.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited
                    || failure.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive
                    || failure.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) {
                    pageProcessExited = pageProcessExited || failure.ProcessFailedKind != CoreWebView2ProcessFailedKind.RenderProcessUnresponsive;
                    SetPageFailure(failure.Reason == CoreWebView2ProcessFailedReason.OutOfMemory ? "页面因内存不足而退出" : "页面已退出或停止响应", "page-process", null);
                }
            };
            environment.BrowserProcessExited += delegate(object sender, CoreWebView2BrowserProcessExitedEventArgs failure) {
                if (exiting || IsDisposed || Disposing) return;
                Action notify = delegate {
                    if (exiting || IsDisposed || Disposing) return;
                    LogLifecycle("browser-exited", null, (int)CoreWebView2ProcessFailedKind.BrowserProcessExited, (int)failure.BrowserProcessExitKind, null);
                    pageProcessExited = true;
                    SetPageFailure("页面浏览器进程已退出", "browser-process", null);
                };
                if (InvokeRequired) { try { BeginInvoke(notify); } catch (InvalidOperationException) { } }
                else notify();
            };
            imageBridge = new ImageViewerBridge(root, output, profile, verify, (id, result) => {
                if (!IsDisposed && !Disposing && !web.IsDisposed && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {
                    kind = result == "closed" ? "image-closed" : "image-result", id = id, error = result == "closed" ? null : result
                }));
            }, value => { if (!IsDisposed && !web.IsDisposed) web.CoreWebView2.PostWebMessageAsJson(value); });
            web.ZoomFactor = saved.ZoomFactor;
            web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
            web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
            web.AllowExternalDrop = true;
            if (verify) {
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}");
            web.CoreWebView2.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown").DevToolsProtocolEventReceived += delegate(object sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e) {
                File.AppendAllText(Path.Combine(output, "runtime-exceptions.jsonl"), e.ParameterObjectAsJson + Environment.NewLine);
            };
            web.CoreWebView2.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled").DevToolsProtocolEventReceived += delegate(object sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e) {
                File.AppendAllText(Path.Combine(output, "runtime-console.jsonl"), e.ParameterObjectAsJson + Environment.NewLine);
            };
            }
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("shiye-preview.local", Path.Combine(output, "app"), CoreWebView2HostResourceAccessKind.DenyCors);
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            web.CoreWebView2.Settings.AreDevToolsEnabled = true;
            web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            web.CoreWebView2.ScriptDialogOpening += delegate(object sender, CoreWebView2ScriptDialogOpeningEventArgs e) {
                File.AppendAllText(Path.Combine(output, "script-dialogs.log"), e.Message + Environment.NewLine);
                if (verify) e.Accept();
            };
            web.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            web.CoreWebView2.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
                Uri address;
                if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out address) &&
                    (address.Scheme == "http" || address.Scheme == "https") && address.Host != "shiye-preview.local") {
                    e.Response = environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 403, "Preview is local only", "Content-Type: text/plain");
                }
            };
            await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("window.addEventListener('error',e=>chrome.webview.postMessage({kind:'error',message:e.message}));window.addEventListener('unhandledrejection',e=>chrome.webview.postMessage({kind:'error',message:String(e.reason)}));");
            web.CoreWebView2.WebMessageReceived += async delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
                var message = json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(e.WebMessageAsJson);
                object kind;
                if (message.TryGetValue("kind", out kind)) {
                    if (!e.Source.StartsWith("https://shiye-preview.local/", StringComparison.OrdinalIgnoreCase)) return;
                    if (Convert.ToString(kind).StartsWith("image-", StringComparison.Ordinal)) { imageBridge.Handle(message, this); return; }
                    if (verify && (string)kind == "verify-dock") {
                        var dockResult = await VerifyDockAnimation();
                        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "dock-verification", result = dockResult })); return;
                    }
                    if (verify && (string)kind == "verify-attachment-screenshot") {
                        using (var capture = new MemoryStream()) {
                            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, capture);
                            File.WriteAllBytes(Path.Combine(output,"attachment-layout-200pct.png"),capture.ToArray());
                        }
                        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "attachment-screenshot-ready" })); return;
                    }
                    if(verify && (string)kind=="verify-composer-capture") {
                        string stage=Convert.ToString(message["stage"]);
                        if(stage!="compact" && stage!="capped" && stage!="manual" && stage!="narrow" && stage!="thumbnails" && stage!="room-settings") return;
                        using(var capture=new MemoryStream()) {
                            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,capture);
                            File.WriteAllBytes(Path.Combine(output,"composer-"+stage+".png"),capture.ToArray());
                        }
                        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {kind="composer-capture-ready",stage=stage}));return;
                    }
                    if (verify && (string)kind == "verify-workspace-launch") {
                        string workspace=Convert.ToString(message["workspace"]);
                        if(workspace=="quick") quickWorkspaceButton.PerformClick();
                        else if(workspace=="notes") notesWorkspaceButton.PerformClick();
                        return;
                    }
                    if (verify && (string)kind == "verify-maintenance-status") {
                        WriteRuntimeStatus(true);
                        string runtimeFile = Path.Combine(Path.GetDirectoryName(SettingsPath),"runtime-status.json");
                        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "maintenance-status", result = json.DeserializeObject(File.ReadAllText(runtimeFile)) })); return;
                    }
                    if (verify && (string)kind == "verify-display-memory") {
                        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind="display-memory-verification", result=VerifyDisplayMemory() })); return;
                    }
                    if (verify && (string)kind == "verify-viewport") {
                        var area = Screen.FromControl(this).WorkingArea;
                        int width = ScaleDip(Math.Max(MinimumDip.Width, Math.Min(1600, Convert.ToInt32(message["width"]))));
                        int height = ScaleDip(Math.Max(600, Math.Min(1000, Convert.ToInt32(message["height"]))));
                        Bounds = DisplayLayout.Fit(new Rectangle(area.Left+40,area.Top+40,width,height),area,MinimumSize);
                        using(var headerBitmap=new Bitmap(chrome.Width,chrome.Height)) {
                            chrome.DrawToBitmap(headerBitmap,new Rectangle(Point.Empty,chrome.Size));
                            headerBitmap.Save(Path.Combine(output,ClientSize.Width<ScaleDip(440)?"workspace-header-compact.png":"workspace-header-wide.png"));
                        }
                        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "viewport-verification" })); return;
                    }
                    if ((string)kind == "dock-state") {
                        dockBusy = message.ContainsKey("busy") && Convert.ToBoolean(message["busy"]);
                        if (message.ContainsKey("typing")) dockTypingUntil = dockClock.ElapsedMilliseconds + 1200;
                        return;
                    }
                    if (verify && (string)kind == "ui-verification") {
                        File.WriteAllText(Path.Combine(root, "outputs", "2026-10-16-聊天UI优化", "native-ui-check.json"), e.WebMessageAsJson); await CapturePreview(false); return;
                    }
                    if ((string)kind == "media-drop-diagnostic") {
                        if (!e.Source.StartsWith("https://shiye-preview.local/", StringComparison.OrdinalIgnoreCase)) return;
                        string phase=Convert.ToString(message["phase"]), formats=Convert.ToString(message["formats"]);
                        if(phase.Length>16 || formats.Length>500) return;
                        var summary=new {atUtc=DateTime.UtcNow.ToString("o"),phase=phase,formats=formats,
                            files=Math.Max(0,Math.Min(1000,Convert.ToInt32(message["files"]))),
                            items=Math.Max(0,Math.Min(1000,Convert.ToInt32(message["items"]))),inChat=Convert.ToBoolean(message["inChat"])};
                        string directory=Path.GetDirectoryName(SettingsPath);Directory.CreateDirectory(directory);
                        File.WriteAllText(Path.Combine(directory,"media-drop-status.json"),json.Serialize(summary));
                        return;
                    }
                    if ((string)kind == "journal-request") {
                        if (!e.Source.StartsWith("https://shiye-preview.local/", StringComparison.OrdinalIgnoreCase)) return;
                        try {
                            var result = await journalBridge.Handle(message);
                            if (IsDisposed || web.IsDisposed || web.CoreWebView2 == null) return;
                            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "journal-result", id = message["id"], result = result }));
                        } catch (Exception) {
                            if (IsDisposed || web.IsDisposed || web.CoreWebView2 == null) return;
                            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "journal-result", id = message["id"], error = "日记库暂时无法连接；消息已保存在本机，将自动重试。" }));
                        }
                        return;
                    }
                    if (verify && (string)kind == "journal-verification") { File.WriteAllText(Path.Combine(output, "journal-check.json"), e.WebMessageAsJson); return; }
                    if ((string)kind == "resume-focused") {
                        string target=Convert.ToString(message["activeElement"]);
                        focusedTarget=target=="editable-message-text" || target=="editable-message-text-modal" ? target : "other-control";
                        pageHasFocus=Convert.ToBoolean(message["pageFocused"]);focusReportedAtUtc=DateTime.UtcNow.ToString("o");
                        WriteRuntimeStatus(ready);
                        if(diagnostics) File.WriteAllText(Path.Combine(output, "resume-focus-check.json"), json.Serialize(new { activeElement = focusedTarget, pageFocused = pageHasFocus, foreground = GetForegroundWindow() == Handle, topmost = TopMost, time = focusReportedAtUtc }));
                    }
                    if (verify && (string)kind == "verify-input") {
                        var method = (string)message["method"];
                        if (!method.StartsWith("Input.", StringComparison.Ordinal)) return;
                        try {
                            var response = await web.CoreWebView2.CallDevToolsProtocolMethodAsync(method, json.Serialize(message["parameters"]));
                            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "verify-input-result", id = message["id"], result = response }));
                        } catch (Exception error) {
                            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "verify-input-result", id = message["id"], error = error.Message }));
                        }
                    }
                    if (verify && (string)kind == "verify-toggle") { ToggleEditor(); }
                    if ((string)kind == "local-store-ready") ConfirmLocalStoreReady();
                    if ((string)kind == "hide-ready") {
                        saveLifecycle.Acknowledge(Convert.ToString(message["id"]), !message.ContainsKey("error"));
                    } else if ((string)kind == "desktop-settings") {
                        saved.ConfirmHide = Convert.ToBoolean(message["confirmHide"]);
                        if (message.ContainsKey("edgeSnap")) saved.EdgeSnap = Convert.ToBoolean(message["edgeSnap"]);
                        if (message.ContainsKey("dockHideDelayMs")) saved.DockHideDelayMs = Math.Max(0, Math.Min(3000, Convert.ToInt32(message["dockHideDelayMs"])));
                        if (message.ContainsKey("dockActivateOnHover")) saved.DockActivateOnHover = Convert.ToBoolean(message["dockActivateOnHover"]);
                        if (message.ContainsKey("dockMotionStyle")) {
                            string motionStyle = Convert.ToString(message["dockMotionStyle"]);
                            if (motionStyle == "responsive" || motionStyle == "classic") saved.DockMotionStyle = motionStyle;
                        }
                        if (!saved.EdgeSnap) { RevealDock(); dockEdge = null; }
                        else if (!dockHidden && !dockAnimating) UpdateDockEdge();
                        outsideSince = 0; SaveSettings(); SendWindowState();
                        web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "desktop-setting-result", confirmHide = saved.ConfirmHide }));
                    } else if ((string)kind == "shared-hotkey-settings") {
                        OpenSharedSettings();
                    } else if ((string)kind == "set-topmost") {
                        TopMost = saved.TopMost = Convert.ToBoolean(message["value"]); UpdatePin(); SaveSettings(); SendWindowState();
                    }
                    if ((string)kind == "zoom-step") {
                        SelectDisplay(dockHidden || dockAnimating ? expandedBounds : Bounds,nativeDpi);
                        var step = Convert.ToInt32(message["step"]);
                        saved.TextScale = step == 0 ? 1 : Math.Max(0.5, Math.Min(2.5, Math.Round(((saved.TextScale ?? 1) + Math.Sign(step) * 0.04) * 100) / 100));
                        web.ZoomFactor = 1;
                        SaveSettings(); SendWindowState();
                    } else if ((string)kind == "input-ready" && inputPending) {
                        inputPending = false;
                        if (saved.InputMode == "chinese") {
                            for (int attempt = 0; attempt < 6; attempt++) {
                                if (QuickInputMode.Request("chinese", Handle)) break;
                                await Task.Delay(100);
                            }
                        }
                    } else if ((string)kind == "input-mode") {
                        saved.InputMode = (string)message["mode"] == "system" ? "system" : "chinese";
                        SaveSettings();
                    } else if ((string)kind == "get-window-state") {
                        SendWindowState();
                    }
                }
                if (verify) File.AppendAllText(Path.Combine(output, "page-events.jsonl"), e.WebMessageAsJson + Environment.NewLine);
                if (e.WebMessageAsJson.Contains("\"kind\":\"verify-result\"")) {
                    File.WriteAllText(Path.Combine(output, "native-ui-check.json"), e.WebMessageAsJson);
                    await CapturePreview(false);
                }
            };
            web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                if (!e.Uri.StartsWith("https://shiye-preview.local/", StringComparison.OrdinalIgnoreCase) && e.Uri != "about:blank") { e.Cancel = true; return; }
                currentNavigationId = e.NavigationId; pageNavigationStarted = true; lifecyclePhase = "navigating"; pageGeneration++; ready = false; localStoreReady = false; saveLifecycle.Interrupt(); WriteRuntimeStatus(false);
            };
            web.CoreWebView2.NavigationCompleted += async delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                if (e.NavigationId != currentNavigationId || IsDisposed || Disposing) return;
                int generation = pageGeneration;
                if (!e.IsSuccess) { SetPageFailure("页面加载未完成", "navigation-failed", null); return; }
                try { runtimeRevision = json.Deserialize<string>(await HostSaveLifecycle.ExecuteAsync(() => ExecutePageScript("window.shiyeFrameUiVersion || null"), 3000)); }
                catch (Exception error) {
                    if (generation == pageGeneration && e.NavigationId == currentNavigationId) SetPageFailure("页面未返回就绪状态", "navigation-script", error);
                    return;
                }
                if (IsDisposed || Disposing) return;
                if (generation != pageGeneration) return;
                if (String.IsNullOrEmpty(runtimeRevision)) { SetPageFailure("页面版本尚未就绪", "navigation-revision", null); return; }
                pageFailure = null; pageProcessExited = false; ready = true; everReady = true; initialLoadPending = false; lifecyclePhase = "ready"; recoveryPanel.Visible = false; recoveryReloadPending = false; recoveryReload.Enabled = true; recoverySave.Enabled = true;
                WriteRuntimeStatus(true);
                ConfirmLocalStoreReady();
                SnapToEdge();
                web.ZoomFactor = saved.ZoomFactor;
                if (!verify) { RestoreEditor(true); return; }
                if (lifecycleOnly) return;
                if (uiOnly) {
                    web.Focus();
                    await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('shiye-startup-focus'))");
                }
                if (captureTimer != null) return;
                captureTimer = new System.Windows.Forms.Timer { Interval = uiOnly ? 3000 : 18000 };
                captureTimer.Tick += async delegate {
                    captureTimer.Stop();
                    await CapturePreview();
                };
                captureTimer.Start();
            };
            if (verify && uiOnly)
                await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("localStorage.removeItem('shiye-room-viewports-v1');");
            pageNavigationStarted = true;
            web.CoreWebView2.Navigate("https://shiye-preview.local/index.html#mockScenario=default");
        } catch (Exception error) {
            File.AppendAllText(Path.Combine(output, "native-errors.log"), error.ToString());
            if (!IsDisposed && !Disposing) MessageBox.Show(this, "预览加载失败，诊断已保存在预览输出目录。", "拾页预览");
        }
    }

    async Task CapturePreview(bool runVerification = true)
    {
        try {
            string state = await web.CoreWebView2.ExecuteScriptAsync("JSON.stringify({title:document.title,text:document.body.innerText.slice(0,2500),hasMain:!!document.querySelector('#Main'),chats:document.querySelectorAll('.ListItem.Chat').length,inputs:[...document.querySelectorAll('[contenteditable=true]')].map(e=>({id:e.id,className:e.className}))})");
            File.WriteAllText(Path.Combine(output, "native-page-state.json"), state);
            string globalState = await web.CoreWebView2.ExecuteScriptAsync("JSON.stringify(typeof getGlobal==='function'?getGlobal():{missing:true})");
            File.WriteAllText(Path.Combine(output, "test-global-state.json"), globalState);
            using (var stream = new MemoryStream()) {
                var capture = web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                if (await Task.WhenAny(capture, Task.Delay(10000)) == capture) {
                    await capture;
                    File.WriteAllBytes(Path.Combine(output, "窗口预览.png"), stream.ToArray());
                }
            }
            if (verify && runVerification) {
                if (uiOnly) {
                    string mediaFixture = Path.Combine(root, "tmp", "telegram-preview-20261015", "composer-media.mp4");
                    if (File.Exists(mediaFixture))
                        await web.CoreWebView2.ExecuteScriptAsync("window.shiyeVerifyVideoBase64=" + json.Serialize(Convert.ToBase64String(File.ReadAllBytes(mediaFixture))) + ";");
                    await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(Path.Combine(root, "previews", "telegram-chat", "verify-input.js")));
                    await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(Path.Combine(root, "previews", "telegram-chat", "verify-composer.js")));
                    await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(Path.Combine(root, "previews", "telegram-chat", "verify-responsive.js")));
                    await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(Path.Combine(root, "previews", "telegram-chat", "verify-clipboard-focus.js")));
                    await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(Path.Combine(root, "previews", "telegram-chat", "verify-conversation-settings.js")));
                    await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(Path.Combine(root, "previews", "telegram-chat", "verify-ui.js"))); return;
                }
                string inputScript = Path.Combine(root, "previews", "telegram-chat", "verify-input.js");
                if (File.Exists(inputScript)) await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(inputScript));
                string mappingScript = Path.Combine(root, "previews", "telegram-chat", "verify-mappings.js");
                if (File.Exists(mappingScript)) await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(mappingScript));
                string workspaceScript = Path.Combine(root, "previews", "telegram-chat", "verify-workspace.js");
                if (File.Exists(workspaceScript)) await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(workspaceScript));
                string script = Path.Combine(root, "previews", "telegram-chat", uiOnly ? "verify-ui.js" : journalOnly ? "verify-journal.js" : frameOnly ? "verify-frame.js" : workspaceOnly ? "verify-workspace-runner.js" : "verify-native.js");
                if (File.Exists(script)) await web.CoreWebView2.ExecuteScriptAsync(File.ReadAllText(script));
            }
        } catch (Exception error) { File.AppendAllText(Path.Combine(output, "native-errors.log"), error.ToString()); }
    }
}

internal sealed class PreviewWindowSettings
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool Maximized { get; set; }
    public double ZoomFactor { get; set; }
    public double? TextScale { get; set; }
    public string LastDisplayId { get; set; }
    public Dictionary<string,DisplayWindowProfile> Displays { get; set; }
    public string InputMode { get; set; }
    public bool TopMost { get; set; }
    public bool EdgeSnap { get; set; }
    public bool ConfirmHide { get; set; }
    public int DockHideDelayMs { get; set; }
    public bool DockActivateOnHover { get; set; }
    public int DockHoverInputRevision { get; set; }
    public string DockMotionStyle { get; set; }
    public PreviewWindowSettings() { ZoomFactor = 1; InputMode = "chinese"; EdgeSnap = true; DockHideDelayMs = 350; DockMotionStyle = "responsive"; DockActivateOnHover = true; }
    internal void UpgradeHoverInputPreference() {
        // The confirmed hover-to-type behavior also applies to the previously saved false default.
        // Once migrated, a later explicit opt-out remains authoritative.
        if (DockHoverInputRevision >= 1) return;
        DockActivateOnHover = true; DockHoverInputRevision = 1;
    }
}

internal enum FrameGlyph { Pin, Minimize, Maximize, Restore, Close, QuickWrite, Notes }
internal sealed class FrameGlyphButton : Button
{
    internal FrameGlyph Glyph;
    internal float ScaleFactor = 1;
    internal bool IsActive;
    internal string CaptionText;
    readonly Font captionFont = new Font("Microsoft YaHei UI",12,GraphicsUnit.Pixel);
    bool hovered, pressed;
    internal FrameGlyphButton() {
        FlatStyle=FlatStyle.Flat; FlatAppearance.BorderSize=0; Text="";
        SetStyle(ControlStyles.OptimizedDoubleBuffer|ControlStyles.AllPaintingInWmPaint|ControlStyles.UserPaint,true);
    }
    protected override void OnMouseEnter(EventArgs e) { hovered=true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered=false; pressed=false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { pressed=e.Button==MouseButtons.Left; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed=false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnPaint(PaintEventArgs e) {
        var background = pressed ? Color.FromArgb(67,73,77) : hovered ? Color.FromArgb(55,61,65) : Color.FromArgb(41,45,48);
        if (Glyph==FrameGlyph.Close && hovered) background=pressed ? Color.FromArgb(145,53,53) : Color.FromArgb(177,67,67);
        if (IsActive && !hovered) background=Color.FromArgb(48,62,64);
        e.Graphics.Clear(background);
        e.Graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        float scale=ScaleFactor;
        var transform=e.Graphics.Save();
        e.Graphics.TranslateTransform(ClientSize.Width/2f,ClientSize.Height/2f);
        e.Graphics.ScaleTransform(scale,scale);
        if (!String.IsNullOrEmpty(CaptionText)) {
            using(var brush=new SolidBrush(Color.FromArgb(202,210,214)))
            using(var format=new StringFormat {Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center,FormatFlags=StringFormatFlags.NoWrap})
                e.Graphics.DrawString(CaptionText,captionFont,brush,new RectangleF(-ClientSize.Width/(2*scale),-ClientSize.Height/(2*scale),ClientSize.Width/scale,ClientSize.Height/scale),format);
            e.Graphics.Restore(transform); return;
        }
        using(var pen=new Pen(IsActive ? Color.FromArgb(139,202,200) : Color.FromArgb(202,210,214),1.25f)) {
            pen.StartCap=pen.EndCap=System.Drawing.Drawing2D.LineCap.Round;
            if(Glyph==FrameGlyph.Pin) {
                var points=new PointF[]{new PointF(-3.5f,-6),new PointF(3.5f,-6),new PointF(2.5f,-1.5f),new PointF(5,2),new PointF(-5,2),new PointF(-2.5f,-1.5f),new PointF(-3.5f,-6)};
                e.Graphics.DrawLines(pen,points);e.Graphics.DrawLine(pen,0,2,0,7);
            } else if(Glyph==FrameGlyph.Minimize) e.Graphics.DrawLine(pen,-5,0,5,0);
            else if(Glyph==FrameGlyph.Maximize) e.Graphics.DrawRectangle(pen,-5,-5,10,10);
            else if(Glyph==FrameGlyph.Restore) {
                e.Graphics.DrawLines(pen,new PointF[]{new PointF(-2,-5),new PointF(-2,-7),new PointF(7,-7),new PointF(7,2),new PointF(5,2)});
                e.Graphics.DrawRectangle(pen,-5,-4,10,10);
            } else if(Glyph==FrameGlyph.QuickWrite) {
                e.Graphics.DrawLines(pen,new PointF[]{new PointF(-5,5),new PointF(-4,1),new PointF(3,-6),new PointF(6,-3),new PointF(-1,4),new PointF(-5,5)});
                e.Graphics.DrawLine(pen,1,-4,4,-1);
            } else if(Glyph==FrameGlyph.Notes) {
                e.Graphics.DrawRectangle(pen,-5,-6,10,12);e.Graphics.DrawLine(pen,-2,-2,2,-2);e.Graphics.DrawLine(pen,-2,1,2,1);e.Graphics.DrawLine(pen,-2,4,1,4);
            } else { e.Graphics.DrawLine(pen,-5,-5,5,5);e.Graphics.DrawLine(pen,-5,5,5,-5); }
        }
        e.Graphics.Restore(transform);
    }
    protected override void Dispose(bool disposing) { if(disposing) captionFont.Dispose(); base.Dispose(disposing); }
}
