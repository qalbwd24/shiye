using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

// One explicit, reversible HKCU Run value for this stable installation only.
internal interface IQuickStartupStore { string Read(string name); void Write(string name, string command); void Delete(string name); }
internal sealed class QuickRegistryStartupStore : IQuickStartupStore
{
    const string Key = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public string Read(string name) { using (var key = Registry.CurrentUser.OpenSubKey(Key, false)) { object value = key == null ? null : key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames); if (value != null && !(value is string)) throw new IOException("本应用的自启动项格式已改变，未覆盖或移除。"); return (string)value; } }
    public void Write(string name, string command) { using (var key = Registry.CurrentUser.CreateSubKey(Key)) key.SetValue(name, command, RegistryValueKind.String); }
    public void Delete(string name) { using (var key = Registry.CurrentUser.OpenSubKey(Key, true)) if (key != null) key.DeleteValue(name, false); }
}
internal sealed class QuickStartupRegistration
{
    readonly IQuickStartupStore store;
    internal readonly string ValueName, Command;
    internal QuickStartupRegistration(string root, IQuickStartupStore storage)
    {
        root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        using (var hash = System.Security.Cryptography.SHA256.Create()) ValueName = "ShiyeResident-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", "").Substring(0, 12);
        Command = "\"" + Path.Combine(root, "拾页快捷记录.exe") + "\" --autostart";
        store = storage;
    }
    internal bool Enabled { get { return String.Equals(store.Read(ValueName), Command, StringComparison.Ordinal); } }
    internal void Set(bool enabled)
    {
        string previous = store.Read(ValueName);
        if (previous != null && !String.Equals(previous, Command, StringComparison.Ordinal)) throw new IOException("本应用的自启动项内容已改变，请先检查该项；未覆盖或移除。");
        if (enabled) store.Write(ValueName, Command); else if (previous != null) store.Delete(ValueName);
        if (Enabled != enabled) throw new IOException("自启动设置未得到确认，请重试。");
    }
}

internal sealed class QuickHostSettings
{
    public int VirtualKey { get; set; }
    public int Modifiers { get; set; }
    public int ChatVirtualKey { get; set; }
    public bool ConfirmClose { get; set; }
    public string InputMode { get; set; }
    public double ResumeHours { get; set; }
    public QuickHostSettings() { ChatVirtualKey = 0x7E; ConfirmClose = true; InputMode = "chinese"; ResumeHours = 5; }
}

internal static class QuickResumePolicy
{
    internal static bool Within(DateTime hiddenAt, double hours, DateTime now)
    {
        return hours > 0 && hours <= 168 && now >= hiddenAt && now - hiddenAt < TimeSpan.FromHours(hours);
    }
}

// One resident broker per project, profile and Windows session. Editors keep their own state.
internal sealed class QuickHostContext : ApplicationContext
{
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int processId);
    readonly string root, stateDirectory, identity;
    readonly Uri url;
    readonly List<QuickCaptureWindow> windows = new List<QuickCaptureWindow>();
    readonly Control dispatcher = new Control();
    readonly HotkeySink sink = new HotkeySink();
    readonly NotifyIcon tray = new NotifyIcon();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    QuickCaptureWindow recent;
    QuickHostSettings settings;
    NamedPipeServerStream waitingPipe;
    bool stopped, exiting, confirming;
    readonly bool testMode, chatEnabled;
    readonly Action ensureService;
    Task servicePreparation;
    readonly System.Windows.Forms.Timer retentionTimer = new System.Windows.Forms.Timer();
    TimeSpan testAdvance;
    DateTime Now() { return DateTime.UtcNow + testAdvance; }

    internal QuickHostContext(string appRoot, Uri baseUrl, string stateDir, string key, bool residentOnly, bool isolatedTest, Action prepareService = null)
    {
        root = appRoot; url = baseUrl; stateDirectory = stateDir; identity = key;
        ensureService = prepareService;
        testMode = isolatedTest;
        chatEnabled = !isolatedTest && baseUrl == new Uri(QuickCapture.DefaultUrl) && Path.GetFullPath(stateDir).Equals(new DesktopPaths(root).StateDirectory, StringComparison.OrdinalIgnoreCase);
        IntPtr handle = dispatcher.Handle;
        settings = Load();
        if (!chatEnabled) settings.ChatVirtualKey = 0;
        sink.Pressed = id => { if (id == 1) Toggle(); else if (id == 2) Chat(true); };
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开最近的思绪", null, delegate { RestoreRecent(); });
        menu.Items.Add("新开思绪窗口", null, delegate { Open(); });
        menu.Items.Add("打开随想", null, delegate { Chat(false); });
        menu.Items.Add("快捷键、输入与恢复", null, delegate { Configure(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出拾页快捷后台", null, delegate { ExitSafely(); });
        tray.Text = "拾页（思绪 / 随想）";
        string icon = Path.Combine(root, "public", "icons", "shiye-hd.ico");
        tray.Icon = File.Exists(icon) ? new Icon(icon) : SystemIcons.Application;
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { RestoreRecent(); };
        tray.Visible = true;
        if (!Bind(settings)) tray.ShowBalloonTip(4000, "拾页快捷键未注册", "按键被占用，请在托盘的“快捷键与输入”中修改。", ToolTipIcon.Warning);
        Task.Run((Action)Listen);
        retentionTimer.Interval = 60000;
        retentionTimer.Tick += delegate { PurgeExpired(); };
        retentionTimer.Start();
        if (!residentOnly) Open();
    }

    internal static bool Forward(string identity, string command)
    {
        try {
            using (var pipe = new NamedPipeClientStream(".", identity, PipeDirection.InOut)) {
                pipe.Connect(5000);
                using (var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, true))
                using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true)) {
                    writer.AutoFlush = true;
                    int process; if (Int32.TryParse(reader.ReadLine(), out process)) AllowSetForegroundWindow(process);
                    writer.WriteLine(command);
                }
            }
            return true;
        } catch { return false; }
    }

    void Listen()
    {
        while (!stopped) {
            try {
                using (var pipe = new NamedPipeServerStream(identity, PipeDirection.InOut, 1, PipeTransmissionMode.Byte)) {
                    waitingPipe = pipe;
                    pipe.WaitForConnection();
                    using (var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, true))
                    using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true)) {
                        writer.AutoFlush = true; writer.WriteLine(Process.GetCurrentProcess().Id);
                        string command = reader.ReadLine();
                        if (command == "open" || command == "restore" || command == "toggle" || command == "exit" || command == "chat-open" || command == "chat-toggle" || command == "settings" || (testMode && (command == "test-expire" || command == "test-hide")))
                            dispatcher.BeginInvoke((Action)delegate {
                                if (stopped) return;
                                if (command == "chat-open" || command == "chat-toggle") Chat(command == "chat-toggle");
                                else if (command == "settings") Configure();
                                else if (command == "toggle") Toggle();
                                else if (command == "exit") ExitSafely();
                                else if (command == "restore") RestoreRecent();
                                else if (command == "test-hide") { if (recent != null) recent.Close(); }
                                else if (command == "test-expire") { testAdvance += TimeSpan.FromHours(6); PurgeExpired(); }
                                else Open();
                            });
                    }
                }
            } catch { if (stopped) return; Thread.Sleep(100); }
            finally { waitingPipe = null; }
        }
    }

    QuickHostSettings Load()
    {
        try {
            string path = Path.Combine(stateDirectory, "quick-host.json");
            var value = File.Exists(path) ? json.Deserialize<QuickHostSettings>(File.ReadAllText(path, Encoding.UTF8)) : null;
            if (value != null && Valid(value)) return value;
        } catch { }
        return new QuickHostSettings();
    }
    internal static bool Valid(QuickHostSettings value)
    {
        return value != null && (value.VirtualKey == 0 || (value.VirtualKey >= 0x7C && value.VirtualKey <= 0x87)) &&
            (value.ChatVirtualKey == 0 || (value.ChatVirtualKey >= 0x7C && value.ChatVirtualKey <= 0x87)) &&
            !(value.VirtualKey != 0 && value.VirtualKey == value.ChatVirtualKey && value.Modifiers == 0) &&
            value.Modifiers >= 0 && value.Modifiers <= 7 &&
            (value.InputMode == "chinese" || value.InputMode == "english" || value.InputMode == "system") &&
            value.ResumeHours >= 0 && value.ResumeHours <= 168;
    }
    bool Bind(QuickHostSettings value)
    {
        bool quick = value.VirtualKey == 0 || RegisterHotKey(sink.Handle, 1, (uint)value.Modifiers | 0x4000, (uint)value.VirtualKey);
        bool chat = value.ChatVirtualKey == 0 || RegisterHotKey(sink.Handle, 2, 0x4000, (uint)value.ChatVirtualKey);
        if (!quick || !chat) { Unbind(); return false; }
        return true;
    }
    void Unbind() { UnregisterHotKey(sink.Handle, 1); UnregisterHotKey(sink.Handle, 2); }
    void Save(QuickHostSettings value)
    {
        if (!Valid(value)) throw new Exception("快捷键设置无效。");
        Unbind();
        if (!Bind(value)) { Bind(settings); throw new Exception("这组按键已被占用，原快捷键保持不变。"); }
        string path = Path.Combine(stateDirectory, "quick-host.json"), temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            File.WriteAllText(temp, json.Serialize(value), new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
            settings = value;
        } catch { Unbind(); Bind(settings); throw; }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    async Task<bool> EnsureServiceForOpen()
    {
        try {
            if (ensureService != null) {
                if (servicePreparation == null || servicePreparation.IsCompleted) servicePreparation = Task.Run(ensureService);
                await servicePreparation;
            }
            return !exiting && !stopped;
        } catch (Exception error) {
            if (!stopped) tray.ShowBalloonTip(4000, "拾页 · 打开未完成", error.Message, ToolTipIcon.Warning);
            return false;
        }
    }
    async void Open()
    {
        if (exiting || !await EnsureServiceForOpen()) return;
        OpenPrepared();
    }
    void OpenPrepared()
    {
        if (exiting) return;
        var window = new QuickCaptureWindow(root, url, stateDirectory, identity, windows.Count, testMode);
        window.InputMode = () => settings.InputMode;
        window.ResumeHours = () => settings.ResumeHours;
        window.Now = Now;
        window.BackgroundOnClose = () => !exiting && settings.ResumeHours > 0;
        window.CloseBlocked = () => { exiting = false; };
        window.ResumeHoursRequested = hours => {
            Save(new QuickHostSettings { VirtualKey = settings.VirtualKey, ChatVirtualKey = settings.ChatVirtualKey, Modifiers = settings.Modifiers, ConfirmClose = settings.ConfirmClose, InputMode = settings.InputMode, ResumeHours = hours });
            PurgeExpired();
        };
        window.NewWindowRequested = Open;
        window.SettingsRequested = Configure;
        windows.Add(window);
        window.Activated += delegate {
            recent = window;
            // Keep MRU order even after the most recent editor is closed.
            windows.Remove(window); windows.Add(window);
        };
        window.FormClosed += delegate {
            windows.Remove(window);
            if (recent == window) recent = windows.Count == 0 ? null : windows[windows.Count - 1];
            if (exiting && windows.Count == 0) ExitThread();
        };
        recent = window; window.Show();
    }
    async void RestoreRecent()
    {
        if (exiting || !await EnsureServiceForOpen()) return;
        PurgeExpired();
        if (recent == null || recent.IsDisposed) OpenPrepared();
        else recent.RestoreEditor();
    }
    void PurgeExpired()
    {
        foreach (var window in windows.ToArray())
            if (window.HiddenAtUtc.HasValue && !QuickResumePolicy.Within(window.HiddenAtUtc.Value, settings.ResumeHours, Now())) window.ClosePermanently();
    }
    void Toggle()
    {
        if (exiting || confirming) return;
        IntPtr foreground = GetForegroundWindow();
        var active = windows.Find(window => !window.IsDisposed && window.Handle == foreground);
        if (active == null) { RestoreRecent(); return; }
        if (settings.ConfirmClose) {
            confirming = true;
            try {
                if (MessageBox.Show(active, "保存并收起当前快捷窗口？", "拾页 · 收起当前窗口", MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button1) != DialogResult.OK) return;
            } finally { confirming = false; }
        }
        active.Close(); // The existing WebView save handshake remains the final close authority.
    }
    async void Chat(bool toggle)
    {
        if (exiting || !chatEnabled) return;
        string path = Path.Combine(root, "outputs", "2026-10-15-Telegram聊天预览", "拾页对话预览.exe");
        if (!File.Exists(path)) { tray.ShowBalloonTip(3000, "拾页 · 随想", "尚未安装聊天窗口。", ToolTipIcon.Info); return; }
        try {
            const string chatTitle = "拾页 · 随想";
            IntPtr target = FindWindow(null, chatTitle);
            bool shouldActivate = !toggle || target == IntPtr.Zero || GetForegroundWindow() != target;
            if (shouldActivate && !await EnsureServiceForOpen()) return;
            int owner;
            if (target != IntPtr.Zero) { GetWindowThreadProcessId(target, out owner); AllowSetForegroundWindow(owner); }
            using (var process = Process.Start(new ProcessStartInfo(path, toggle ? "--toggle" : "--show") { WorkingDirectory = root, UseShellExecute = false })) {
                if (process != null) AllowSetForegroundWindow(process.Id);
            }
            if (shouldActivate) {
                // The process receiving WM_HOTKEY grants focus; a secondary launcher alone cannot reliably do so.
                for (int attempt = 0; attempt < 20 && !exiting; attempt++) {
                    await Task.Delay(100);
                    target = FindWindow(null, chatTitle);
                    if (target != IntPtr.Zero && SetForegroundWindow(target)) break;
                }
            }
        } catch (Exception error) { tray.ShowBalloonTip(3000, "拾页 · 随想 · 启动失败", error.Message, ToolTipIcon.Warning); }
    }
    async void ExitSafely()
    {
        if (exiting) return;
        exiting = true;
        if (chatEnabled) try {
            using (var closing = EventWaitHandle.OpenExisting(@"Local\ShiyeChatPreviewExitV1")) closing.Set();
            bool closed = false;
            for (int attempt = 0; attempt < 120; attempt++) {
                await Task.Delay(100);
                try { using (var check = EventWaitHandle.OpenExisting(@"Local\ShiyeChatPreviewExitV1")) { } }
                catch (WaitHandleCannotBeOpenedException) { closed = true; break; }
            }
            if (!closed) { exiting = false; tray.ShowBalloonTip(4000, "拾页后台暂未退出", "聊天草稿尚未确认保存，请保留窗口后重试。", ToolTipIcon.Warning); return; }
        } catch (WaitHandleCannotBeOpenedException) { }

        foreach (var window in windows.ToArray()) window.ClosePermanently();
        if (windows.Count == 0) ExitThread();
    }
    void Configure()
    {
        using (var form = new Form()) {
            form.Text = "拾页 · 快捷键、输入与恢复"; form.ClientSize = new Size(430, 495);
            form.FormBorderStyle = FormBorderStyle.FixedDialog; form.MaximizeBox = false; form.MinimizeBox = false;
            form.StartPosition = FormStartPosition.CenterScreen; form.AutoScaleMode = AutoScaleMode.Dpi; form.TopMost = true;
            var label = new Label { Text = "切换快捷窗口（唤回 / 保存收起）", Left = 20, Top = 18, AutoSize = true };
            var keys = new ComboBox { Left = 20, Top = 45, Width = 135, DropDownStyle = ComboBoxStyle.DropDownList };
            keys.Items.Add("尚未绑定"); for (int i = 13; i <= 24; i++) keys.Items.Add("F" + i);
            keys.SelectedIndex = settings.VirtualKey == 0 ? 0 : settings.VirtualKey - 0x7C + 1;
            var ctrl = new CheckBox { Text = "Ctrl", Left = 175, Top = 47, Width = 65, Checked = (settings.Modifiers & 2) != 0 };
            var alt = new CheckBox { Text = "Alt", Left = 245, Top = 47, Width = 60, Checked = (settings.Modifiers & 1) != 0 };
            var shift = new CheckBox { Text = "Shift", Left = 310, Top = 47, Width = 70, Checked = (settings.Modifiers & 4) != 0 };
            var confirm = new CheckBox { Text = "热键收起前确认（Enter 确定）", Left = 20, Top = 90, Width = 350, Checked = settings.ConfirmClose };
            var modeLabel = new Label { Text = "每次唤回时的输入模式", Left = 20, Top = 130, AutoSize = true };
            var mode = new ComboBox { Left = 20, Top = 155, Width = 220, DropDownStyle = ComboBoxStyle.DropDownList };
            mode.Items.AddRange(new object[] { "中文（仍可手动切英文）", "英文", "跟随系统" });
            mode.SelectedIndex = settings.InputMode == "english" ? 1 : settings.InputMode == "system" ? 2 : 0;
            var resumeLabel = new Label { Text = "关闭后保留原篇与位置（小时）", Left = 20, Top = 195, AutoSize = true };
            var resume = new NumericUpDown { Left = 275, Top = 192, Width = 125, Minimum = 0, Maximum = 168, DecimalPlaces = 2, Increment = 0.25M, Value = (decimal)settings.ResumeHours };
            var chatLabel = new Label { Text = "聊天窗口（唤回并聚焦 / 保存收起）", Left = 20, Top = 235, AutoSize = true };
            var chatKeys = new ComboBox { Left = 20, Top = 260, Width = 220, DropDownStyle = ComboBoxStyle.DropDownList };
            chatKeys.Items.Add("不绑定"); for (int i = 13; i <= 24; i++) chatKeys.Items.Add("F" + i);
            chatKeys.SelectedIndex = settings.ChatVirtualKey == 0 ? 0 : settings.ChatVirtualKey - 0x7C + 1;
            var registration = new QuickStartupRegistration(root, new QuickRegistryStartupStore());
            var startup = new CheckBox { Text = "登录 Windows 后启动到托盘", Left = 20, Top = 305, Width = 385, Enabled = chatEnabled };
            var message = new Label { Left = 20, Top = 400, Width = 385, Height = 35 };
            try { startup.Checked = chatEnabled && registration.Enabled; } catch (Exception error) { startup.Enabled = false; message.Text = error.Message; }
            var hint = new Label { Text = "登录时仅显示托盘；从托盘或快捷键打开随想。\n0 小时表示关闭后不保留思绪。F13–F24 由你的映射发出。", Left = 20, Top = 345, Width = 385, Height = 48 };
            var save = new Button { Text = "保存", Left = 245, Top = 452, Width = 75 };
            var cancel = new Button { Text = "取消", Left = 330, Top = 452, Width = 75, DialogResult = DialogResult.Cancel };
            save.Click += delegate {
                try {
                    Save(new QuickHostSettings { VirtualKey = keys.SelectedIndex == 0 ? 0 : 0x7C + keys.SelectedIndex - 1,
                        ChatVirtualKey = chatKeys.SelectedIndex == 0 ? 0 : 0x7C + chatKeys.SelectedIndex - 1,
                        Modifiers = (ctrl.Checked ? 2 : 0) | (alt.Checked ? 1 : 0) | (shift.Checked ? 4 : 0), ConfirmClose = confirm.Checked,
                        InputMode = mode.SelectedIndex == 1 ? "english" : mode.SelectedIndex == 2 ? "system" : "chinese", ResumeHours = (double)resume.Value });
                    if (startup.Enabled) registration.Set(startup.Checked);
                    PurgeExpired();
                    form.DialogResult = DialogResult.OK; form.Close();
                } catch (Exception error) { message.Text = error.Message; }
            };
            form.Controls.AddRange(new Control[] { label, keys, ctrl, alt, shift, confirm, modeLabel, mode, resumeLabel, resume, chatLabel, chatKeys, startup, hint, message, save, cancel });
            form.AcceptButton = save; form.CancelButton = cancel;
            form.ShowDialog();
        }
    }
    protected override void ExitThreadCore()
    {
        stopped = true; Unbind();
        retentionTimer.Dispose();
        if (waitingPipe != null) waitingPipe.Dispose();
        tray.Visible = false; tray.Dispose(); sink.Destroy(); dispatcher.Dispose();
        base.ExitThreadCore();
    }
    sealed class HotkeySink : NativeWindow
    {
        internal Action<int> Pressed;
        internal HotkeySink() { CreateHandle(new CreateParams { Caption = "ShiyeQuickHotkeyHost" }); }
        protected override void WndProc(ref Message message) {
            if (message.Msg == 0x0312 && Pressed != null) Pressed(message.WParam.ToInt32());
            base.WndProc(ref message);
        }
        internal void Destroy() { DestroyHandle(); }
    }
}

internal static class QuickInputMode
{
    [StructLayout(LayoutKind.Sequential)] struct GUIInfo {
        public int size, flags;
        public IntPtr active, focus, capture, menuOwner, moveSize, caret;
        public Rectangle caretRect;
    }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUIInfo info);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("imm32.dll")] static extern IntPtr ImmGetDefaultIMEWnd(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr first, IntPtr second, uint flags, uint timeout, out IntPtr result);
    internal static bool Request(string mode, IntPtr owner)
    {
        if (mode == "system") return true;
        if (GetForegroundWindow() != owner) return false;
        var info = new GUIInfo { size = Marshal.SizeOf(typeof(GUIInfo)) };
        if (!GetGUIThreadInfo(GetWindowThreadProcessId(owner, IntPtr.Zero), ref info) || info.focus == IntPtr.Zero) return false;
        InputLanguage chinese = null;
        foreach (InputLanguage language in InputLanguage.InstalledInputLanguages)
            if (language.Culture.TwoLetterISOLanguageName == "zh") { chinese = language; break; }
        if (chinese == null) return false;
        // Request only the active editor's input context; never simulate global Shift keys.
        IntPtr result;
        if (SendMessageTimeout(info.focus, 0x0050, IntPtr.Zero, chinese.Handle, 2, 200, out result) == IntPtr.Zero) return false;
        IntPtr ime = ImmGetDefaultIMEWnd(info.focus);
        if (ime == IntPtr.Zero) return false;
        bool opened = SendMessageTimeout(ime, 0x0283, new IntPtr(0x006), new IntPtr(mode == "chinese" ? 1 : 0), 2, 200, out result) != IntPtr.Zero;
        if (mode == "chinese") SendMessageTimeout(ime, 0x0283, new IntPtr(0x002), new IntPtr(1), 2, 200, out result);
        return opened;
    }
}
