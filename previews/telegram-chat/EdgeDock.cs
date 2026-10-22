using System;
using System.Drawing;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Threading.Tasks;

// Run only while moving. A single queued UI callback prevents slow paints from
// accumulating timer messages; Stopwatch still determines position after a stall.
internal sealed class DockFramePump : IDisposable
{
    sealed class TimerWaitHandle : System.Threading.WaitHandle
    {
        internal TimerWaitHandle(IntPtr handle) { SafeWaitHandle = new Microsoft.Win32.SafeHandles.SafeWaitHandle(handle, true); }
    }
    readonly Control owner;
    readonly Action tick;
    System.Threading.ManualResetEvent stop;
    volatile int generation;
    internal string Scheduler { get; private set; }
    internal double FrameIntervalMs { get; private set; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct DisplayMode
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] internal string DeviceName;
        internal ushort SpecVersion, DriverVersion, Size, DriverExtra;
        internal uint Fields;
        internal int PositionX, PositionY;
        internal uint DisplayOrientation, DisplayFixedOutput;
        internal short Color, Duplex, YResolution, TTOption, Collate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] internal string FormName;
        internal ushort LogPixels;
        internal uint BitsPerPel, PelsWidth, PelsHeight, DisplayFlags, DisplayFrequency;
        internal uint ICMMethod, ICMIntent, MediaType, DitherType, Reserved1, Reserved2, PanningWidth, PanningHeight;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplaySettings(string deviceName, int mode, ref DisplayMode displayMode);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateWaitableTimerEx(IntPtr attributes, string name, uint flags, uint access);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetWaitableTimer(IntPtr timer, ref long dueTime, int period, IntPtr callback, IntPtr state, bool resume);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
    internal bool Running { get { return stop != null; } }
    internal DockFramePump(Control control, Action callback) { owner = control; tick = callback; }
    internal void Start()
    {
        if (stop != null) return;
        Start(GetRefreshRate(Screen.FromControl(owner).DeviceName));
    }
    internal static double GetRefreshRate(string deviceName)
    {
        var mode = new DisplayMode { Size = (ushort)Marshal.SizeOf(typeof(DisplayMode)) };
        return EnumDisplaySettings(deviceName, -1, ref mode) ? NormalizeRefreshRate(mode.DisplayFrequency) : 120;
    }
    internal static double NormalizeRefreshRate(double rate)
    {
        return Double.IsNaN(rate) || Double.IsInfinity(rate) || rate < 30 ? 120 : Math.Min(rate, 240);
    }
    internal static long NextDeadline(long origin, long now, double frameTicks)
    {
        // An expired deadline is skipped rather than replayed as a burst of old frames.
        return origin + (long)Math.Ceiling((Math.Floor((now - origin) / frameTicks) + 1) * frameTicks);
    }
    internal void Start(double refreshRate)
    {
        if (stop != null) return;
        int ticket = ++generation;
        IntPtr handle = CreateWaitableTimerEx(IntPtr.Zero, null, 2, 0x00100002);
        bool fallback = handle == IntPtr.Zero;
        if (fallback) handle = CreateWaitableTimerEx(IntPtr.Zero, null, 0, 0x00100002);
        if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        var timer = new TimerWaitHandle(handle);
        bool resolution = fallback && timeBeginPeriod(1) == 0;
        FrameIntervalMs = 1000.0 / NormalizeRefreshRate(refreshRate);
        Scheduler = (fallback ? "waitable-fallback-deadline-" : "waitable-high-resolution-deadline-")
            + FrameIntervalMs.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) + "ms";
        var cancellation = stop = new System.Threading.ManualResetEvent(false);
        int pending = 0; // A superseded run cannot clear the next run's queue gate.
        double frameTicks = Stopwatch.Frequency * FrameIntervalMs / 1000.0;
        var worker = new System.Threading.Thread(delegate() {
            try {
                var handles = new System.Threading.WaitHandle[] { cancellation, timer };
                long origin = Stopwatch.GetTimestamp();
                while (ticket == generation) {
                    long now = Stopwatch.GetTimestamp();
                    long deadline = NextDeadline(origin, now, frameTicks);
                    long due = -Math.Max(1, (long)Math.Ceiling((deadline - now) * 10000000.0 / Stopwatch.Frequency));
                    if (SetWaitableTimer(handle, ref due, 0, IntPtr.Zero, IntPtr.Zero, false)) {
                        if (System.Threading.WaitHandle.WaitAny(handles) != 1) return;
                    } else if (cancellation.WaitOne(Math.Max(1, (int)Math.Ceiling(FrameIntervalMs)))) return;
                    if (ticket != generation) return;
                    if (System.Threading.Interlocked.CompareExchange(ref pending, 1, 0) != 0) continue;
                    try {
                        owner.BeginInvoke((Action)delegate {
                            try { if (ticket == generation && !owner.IsDisposed) tick(); }
                            finally { System.Threading.Interlocked.Exchange(ref pending, 0); }
                        });
                    } catch (InvalidOperationException) { System.Threading.Interlocked.Exchange(ref pending, 0); return; }
                }
            } finally {
                timer.Dispose(); cancellation.Dispose();
                if (resolution) timeEndPeriod(1);
            }
        });
        worker.IsBackground = true; worker.Name = "Shiye dock animation"; worker.Start();
    }
    internal void Stop()
    {
        ++generation;
        var previous = stop; stop = null;
        if (previous != null) {
            try { previous.Set(); } catch (ObjectDisposedException) { }
        }
    }
    public void Dispose() { Stop(); }
}

internal static class DockMotion
{
    internal struct Sample
    {
        internal double Position, Velocity;
        internal Sample(double position, double velocity) { Position = position; Velocity = velocity; }
    }
    internal static Sample Evaluate(double from, double to, double velocity, double elapsedMs, double durationMs)
    {
        return Evaluate(from, to, velocity, elapsedMs, durationMs, "responsive");
    }
    internal static string NormalizeStyle(string style) { return style == "classic" ? "classic" : "responsive"; }
    internal static Sample Evaluate(double from, double to, double velocity, double elapsedMs, double durationMs, string style)
    {
        if (elapsedMs >= durationMs) return new Sample(to, 0);
        if (elapsedMs <= 0) return new Sample(from, velocity);
        double t = elapsedMs / durationMs, t2 = t * t, remaining = 1 - t, distance = to - from;
        if (style == "classic") {
            return new Sample(from + distance * t2 * (3 - 2 * t) + velocity * durationMs * t * remaining * remaining,
                distance * 6 * t * remaining / durationMs + velocity * (1 - 4 * t + 3 * t2));
        }
        // Front-loaded finite motion with a C1 velocity carry and a quiet endpoint.
        double position = from + distance * t2 * (10 + t * (-20 + t * (15 - 4 * t)))
            + velocity * durationMs * t * remaining * remaining * remaining * remaining;
        double speed = distance * 20 * t * remaining * remaining * remaining / durationMs
            + velocity * remaining * remaining * remaining * (1 - 5 * t);
        return new Sample(position, speed);
    }
    internal static Sample Within(Sample sample, double first, double second)
    {
        double position = Math.Max(Math.Min(first, second), Math.Min(Math.Max(first, second), sample.Position));
        return new Sample(position, position == sample.Position ? sample.Velocity : 0);
    }
    internal static double Duration(double distance, double fullDistance, double fullDuration)
    {
        return fullDistance <= 0 ? fullDuration : Math.Max(70, fullDuration * Math.Min(1, distance / fullDistance));
    }
    internal static double LimitDuration(double duration, double dx, double dy, double vx, double vy)
    {
        if (Double.IsNaN(duration) || Double.IsInfinity(duration) || duration <= 0) duration = 70;
        return LimitAxisDuration(LimitAxisDuration(duration, dx, vx), dy, vy);
    }
    static double LimitAxisDuration(double duration, double distance, double velocity)
    {
        if (!((distance > 0 && velocity > 0) || (distance < 0 && velocity < 0))) return duration;
        // m=v*T/d must be <=5; shorten time rather than discard carried velocity.
        double upper = 5 * Math.Abs(distance) / Math.Abs(velocity);
        return upper > 0 && !Double.IsNaN(upper) && !Double.IsInfinity(upper) ? Math.Min(duration, upper) : duration;
    }
}

internal static class DisplayLayout
{
    internal static Rectangle Fit(Rectangle bounds, Rectangle area, Size minimum)
    {
        int width = Math.Min(area.Width, Math.Max(Math.Min(minimum.Width, area.Width), bounds.Width));
        int height = Math.Min(area.Height, Math.Max(Math.Min(minimum.Height, area.Height), bounds.Height));
        return new Rectangle(Math.Max(area.Left, Math.Min(area.Right-width, bounds.X)),
            Math.Max(area.Top, Math.Min(area.Bottom-height, bounds.Y)), width, height);
    }
    internal static bool IsExterior(Rectangle monitor, Rectangle window, string side, Rectangle[] monitors)
    {
        foreach (var other in monitors) {
            if (other == monitor) continue;
            bool verticalOverlap = other.Top < window.Bottom && other.Bottom > window.Top;
            bool horizontalOverlap = other.Left < window.Right && other.Right > window.Left;
            if ((side == "left" && other.Right == monitor.Left && verticalOverlap)
                || (side == "right" && other.Left == monitor.Right && verticalOverlap)
                || (side == "top" && other.Bottom == monitor.Top && horizontalOverlap)
                || (side == "bottom" && other.Top == monitor.Bottom && horizontalOverlap)) return false;
        }
        return true;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeRect { internal int Left, Top, Right, Bottom; internal Rectangle Bounds { get { return Rectangle.FromLTRB(Left, Top, Right, Bottom); } } }
}

internal sealed partial class PreviewWindow
{
    readonly System.Windows.Forms.Timer dockTimer = new System.Windows.Forms.Timer { Interval = 40 };
    DockFramePump dockFrames;
    bool legacyDockClock;
    readonly List<double> animationFrameTimes = new List<double>();
    readonly Stopwatch dockClock = Stopwatch.StartNew();
    int hoverActivationRequests;
    Rectangle expandedBounds;
    Rectangle animationFrom, animationTo, animationHiddenBounds;
    double animationStarted, animationDuration = DockAnimationMs, animationVelocityX, animationVelocityY;
    string animationMotionStyle = "responsive";
    long outsideSince;
    string dockEdge;
    bool dockHidden, dockAnimating, dockBusy, dockPreparing;
    bool devHotkeyBound;
    long dockTypingUntil;
    bool adaptingDisplay;
    const int DockAnimationMs = 220;
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr handle, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr handle, int id);

    void InitializeDock()
    {
        DoubleBuffered = true;
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true);
        dockFrames = new DockFramePump(this, TickDock);
        dockTimer.Tick += delegate { if (!dockAnimating || legacyDockClock) TickDock(); };
        dockTimer.Start();
        Shown += delegate {
            if (development && !verify) devHotkeyBound = RegisterHotKey(Handle, 31, 0x4003, 0x7E);
            RecordHostState();
        };
        FormClosed += delegate {
            if (devHotkeyBound) UnregisterHotKey(Handle, 31);
            dockFrames.Dispose();
            dockTimer.Dispose();
        };
    }
    void RecordHostState()
    {
        if (!diagnostics || IsDisposed) return;
        string folder = System.IO.Path.Combine(root,"outputs","2026-10-16-聊天UI优化");
        System.IO.Directory.CreateDirectory(folder);
        System.IO.File.WriteAllText(System.IO.Path.Combine(folder,"host-state.json"),json.Serialize(new {
            at = DateTime.UtcNow.ToString("o"), pid = Process.GetCurrentProcess().Id, caption = Text,
            visible = Visible, ready = ready, dockHidden = dockHidden, hotkeyBound = devHotkeyBound,
            bounds = Bounds.ToString(), dpi = nativeDpi, textScale = saved.TextScale,
            windowState = WindowState.ToString(), development = development
        }));
    }
    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x02E0) {
            int dpi = message.WParam.ToInt32() & 0xffff;
            var suggested = ((DisplayLayout.NativeRect)Marshal.PtrToStructure(message.LParam, typeof(DisplayLayout.NativeRect))).Bounds;
            base.WndProc(ref message);
            if (chromeActions != null) AdaptDisplay(dpi, suggested);
            return;
        }
        if (message.Msg == 0x007E || message.Msg == 0x02E4) {
            base.WndProc(ref message);
            if (chromeActions != null && IsHandleCreated) BeginInvoke((Action)delegate { AdaptDisplay(nativeDpi, null); });
            return;
        }
        if (message.Msg == 0x0312 && message.WParam.ToInt32() == 31) { ToggleEditor(); return; }
        if (message.Msg == 0x0231) { // Begin a native move/size loop from the visible position
            SaveSettings(); nativeMoving=true;
            dockTimer.Stop(); StopDockAnimation(); dockHidden = false; dockEdge = null;
        }
        if(message.Msg==0x0232) nativeMoving=false;
        base.WndProc(ref message);
        if (message.Msg == 0x0232) { SnapToEdge(); dockTimer.Start(); }
    }
    void AdaptDisplay(int dpi, Rectangle? suggested)
    {
        if (adaptingDisplay || IsDisposed || Disposing) return;
        adaptingDisplay = true;
        try {
            Rectangle reference = suggested ?? (dockHidden || dockAnimating ? expandedBounds : Bounds);
            if(SelectDisplay(reference,dpi)) reference=WindowState==FormWindowState.Normal?Bounds:RestoreBounds;
            var area = Screen.FromRectangle(reference).WorkingArea;
            nativeDpi = DisplayMemory.Dpi(Screen.FromRectangle(reference),dpi);
            StopDockAnimation(); dockHidden = false; dockEdge = null;
            MinimumSize = new Size(Math.Min(ScaleDip(MinimumDip.Width), area.Width), Math.Min(ScaleDip(MinimumDip.Height), area.Height));
            MaximizedBounds = area;
            if (WindowState == FormWindowState.Normal) Bounds = DisplayLayout.Fit(reference, area, MinimumSize);
            if (chromeCaption != null) {
                float targetSize = (float)(12 * nativeDpi / 96.0);
                if (Math.Abs(chromeCaption.Font.Size-targetSize) > 0.01f) {
                    var oldFont = chromeCaption.Font;
                    var nextFont = new Font("Microsoft YaHei UI", targetSize, GraphicsUnit.Pixel);
                    chromeCaption.Font = nextFont;
                    // WinForms may retain the existing font when two instances compare equal.
                    if (!Object.ReferenceEquals(chromeCaption.Font, oldFont)) oldFont.Dispose();
                    else nextFont.Dispose();
                }
            }
            PerformLayout(); UpdateDockEdge();
            if (ready) { SaveSettings(); SendWindowState(); }
        } finally { adaptingDisplay = false; }
    }
    void UpdateDockEdge()
    {
        expandedBounds = Bounds;
        dockEdge = null;
        if (!saved.EdgeSnap || WindowState != FormWindowState.Normal) return;
        var area = Screen.FromRectangle(Bounds).WorkingArea;
        // Hide only at a physical exterior, never across an adjacent display
        if (Left == area.Left && IsExterior(area, "left")) dockEdge = "left";
        else if (Right == area.Right && IsExterior(area, "right")) dockEdge = "right";
        else if (Top == area.Top && IsExterior(area, "top")) dockEdge = "top";
        else if (Bottom == area.Bottom && IsExterior(area, "bottom")) dockEdge = "bottom";
        outsideSince = 0;
    }
    bool IsExterior(Rectangle area, string side)
    {
        var monitor = Screen.FromRectangle(Bounds).Bounds;
        return DisplayLayout.IsExterior(monitor, Bounds, side, Array.ConvertAll(Screen.AllScreens, screen => screen.Bounds));
    }
    Rectangle GetDockHiddenBounds()
    {
        var result = expandedBounds;
        var area = Screen.FromRectangle(expandedBounds).WorkingArea;
        int strip = ScaleDip(6);
        if (dockEdge == "left") result.X = area.Left - result.Width + strip;
        else if (dockEdge == "right") result.X = area.Right - strip;
        else if (dockEdge == "top") result.Y = area.Top - result.Height + strip;
        else if (dockEdge == "bottom") result.Y = area.Bottom - strip;
        return result;
    }
    void AnimateDock(bool hide)
    {
        if (dockEdge == null) return;
        if (dockAnimating && dockHidden == hide) return;
        double now = dockClock.Elapsed.TotalMilliseconds;
        bool reversing = dockAnimating;
        var previousX = reversing ? DockMotion.Within(DockMotion.Evaluate(animationFrom.X, animationTo.X,
            animationVelocityX, now-animationStarted, animationDuration, animationMotionStyle), expandedBounds.X, animationHiddenBounds.X) : new DockMotion.Sample();
        var previousY = reversing ? DockMotion.Within(DockMotion.Evaluate(animationFrom.Y, animationTo.Y,
            animationVelocityY, now-animationStarted, animationDuration, animationMotionStyle), expandedBounds.Y, animationHiddenBounds.Y) : new DockMotion.Sample();
        if (!dockHidden && !dockAnimating) expandedBounds = Bounds;
        animationHiddenBounds = GetDockHiddenBounds();
        animationFrom = Bounds;
        animationTo = hide ? animationHiddenBounds : expandedBounds;
        animationVelocityX = previousX.Velocity; animationVelocityY = previousY.Velocity;
        animationMotionStyle = DockMotion.NormalizeStyle(saved.DockMotionStyle);
        double distance = Math.Max(Math.Abs(animationTo.X-animationFrom.X), Math.Abs(animationTo.Y-animationFrom.Y));
        double fullDistance = Math.Max(Math.Abs(expandedBounds.X-animationHiddenBounds.X), Math.Abs(expandedBounds.Y-animationHiddenBounds.Y));
        if (distance == 0) {
            dockHidden = hide; outsideSince = 0; animationVelocityX = animationVelocityY = 0;
            StopDockAnimation();
            if (!hide) Show();
            if (ready && !verify) SaveSettings();
            return;
        }
        double fullDuration = animationMotionStyle == "classic" ? 240 : DockAnimationMs;
        animationDuration = reversing ? DockMotion.Duration(distance, fullDistance, fullDuration) : fullDuration;
        if (animationMotionStyle != "classic") animationDuration = DockMotion.LimitDuration(animationDuration, animationTo.X-animationFrom.X,
            animationTo.Y-animationFrom.Y, animationVelocityX, animationVelocityY);
        animationStarted = now;
        dockHidden = hide; dockAnimating = true; outsideSince = 0;
        settingsTimer.Stop();
        if (verify) animationFrameTimes.Clear();
        if (!hide) Show();
        if (legacyDockClock) dockTimer.Interval = 16;
        else dockFrames.Start();
    }
    void StopDockAnimation()
    {
        dockAnimating = false;
        if (dockFrames != null) dockFrames.Stop();
        dockTimer.Interval = 40;
    }
    void RevealDockFromHover()
    {
        AnimateDock(false);
        if (saved.DockActivateOnHover && !dockBusy && OwnedForms.Length == 0) {
            hoverActivationRequests++;
            if (!verify) RestoreEditor(false, true);
        }
    }
    void TickDock()
    {
        TickDockCore(false, Cursor.Position);
    }
    void TickDockCore(bool allowVerification, Point pointer)
    {
        if (IsDisposed || Disposing) return;
        if (dockAnimating) {
            if (!verify && dockHidden && (Bounds.Contains(pointer) || dockBusy || dockClock.ElapsedMilliseconds < dockTypingUntil)) {
                if(Bounds.Contains(pointer)) RevealDockFromHover(); else AnimateDock(false);
            }
            double elapsed = dockClock.Elapsed.TotalMilliseconds - animationStarted;
            double progress = Math.Min(1, elapsed / animationDuration);
            var x = DockMotion.Within(DockMotion.Evaluate(animationFrom.X, animationTo.X,
                animationVelocityX, elapsed, animationDuration, animationMotionStyle), expandedBounds.X, animationHiddenBounds.X);
            var y = DockMotion.Within(DockMotion.Evaluate(animationFrom.Y, animationTo.Y,
                animationVelocityY, elapsed, animationDuration, animationMotionStyle), expandedBounds.Y, animationHiddenBounds.Y);
            var next = new Point((int)Math.Round(x.Position), (int)Math.Round(y.Position));
            if (Location != next) {
                Location = next;
                if (verify) animationFrameTimes.Add(dockClock.Elapsed.TotalMilliseconds);
            }
            if (progress >= 1) {
                Location = animationTo.Location; StopDockAnimation();
                if (ready && !verify) SaveSettings();
            }
            return;
        }
        if (!Visible || !ready || !localStoreReady || (verify && !allowVerification) || isResizing || WindowState != FormWindowState.Normal) return;
        if (!saved.EdgeSnap) { if (dockHidden) RevealDock(); dockEdge = null; return; }
        if (dockEdge == null) return;
        var target = Bounds;
        target.Inflate(ScaleDip(5), ScaleDip(5));
        if (target.Contains(pointer)) {
            outsideSince = 0;
            if (dockHidden) {
                RevealDockFromHover();
            }
            return;
        }
        if (dockHidden || dockPreparing || dockBusy || dockClock.ElapsedMilliseconds < dockTypingUntil || OwnedForms.Length != 0
            || (!(verify && allowVerification) && (Control.MouseButtons & MouseButtons.Left) != 0)) { outsideSince = 0; return; }
        if (outsideSince == 0) outsideSince = dockClock.ElapsedMilliseconds;
        if (dockClock.ElapsedMilliseconds - outsideSince >= saved.DockHideDelayMs) RetractDock(pointer);
    }
    async void RetractDock(Point pointer)
    {
        if (dockPreparing || dockEdge == null || !localStoreReady) return;
        dockPreparing = true;
        try {
            if (dockBusy || Bounds.Contains(pointer)) return;
            // The live window remains visible as a strip. Save concurrently so the
            // configured leave delay does not secretly include the save handshake.
            var prepared = PrepareToHide();
            SaveSettings(); AnimateDock(true);
            if (!await prepared) RevealDock();
        } finally { dockPreparing = false; outsideSince = 0; }
    }
    void RevealDock()
    {
        if (dockHidden || dockAnimating) AnimateDock(false);
        outsideSince = 0;
    }
    object FrameStatistics(string side, bool hide, bool legacy)
    {
        var intervals = new List<double>();
        for (int i = 1; i < animationFrameTimes.Count; i++) intervals.Add(animationFrameTimes[i] - animationFrameTimes[i-1]);
        intervals.Sort();
        return new {
            side = side, hide = hide, scheduler = legacy ? "WM_TIMER-16ms" : dockFrames.Scheduler,
            requestedFrameMs = legacy ? 16 : dockFrames.FrameIntervalMs, curve = animationMotionStyle == "classic" ? "velocity-continuous-cubic-Hermite" : "front-loaded-quintic-velocity-continuous",
            frames = animationFrameTimes.Count,
            medianFrameMs = intervals.Count == 0 ? 0 : Math.Round(intervals[intervals.Count/2],2),
            p95FrameMs = intervals.Count == 0 ? 0 : Math.Round(intervals[Math.Min(intervals.Count-1,(int)(intervals.Count*0.95))],2),
            pumpStopped = !dockFrames.Running
        };
    }
    async System.Threading.Tasks.Task<object> VerifyDockAnimation()
    {
        var previous = Bounds;
        bool enabled = saved.EdgeSnap;
        int previousHideDelay = saved.DockHideDelayMs;
        bool previousHoverActivation = saved.DockActivateOnHover;
        int previousPersistedHideDelay = json.Deserialize<PreviewWindowSettings>(System.IO.File.ReadAllText(SettingsPath)).DockHideDelayMs;
        var area = Screen.FromRectangle(Bounds).WorkingArea;
        try {
            // Repeated display notifications must not dispose the font retained by WinForms.
            for (int attempt = 0; attempt < 12; attempt++) {
                AdaptDisplay(nativeDpi, null);
                using (var graphics = chromeCaption.CreateGraphics()) chromeCaption.Font.GetHeight(graphics);
            }
            saved.EdgeSnap = true;
            Bounds = SnapBounds(new Rectangle(area.Left-100, area.Top+60, Width, Height), area, ScaleDip(16));
            UpdateDockEdge();
            bool corrected = Left == area.Left;
            bool horizontal = dockEdge == "left";
            var expanded = Bounds;
            // Inject pointer/elapsed values into the real policy; never move the
            // user's physical pointer during isolated verification.
            bool wasBusy = dockBusy;
            long previousTyping = dockTypingUntil;
            dockBusy = false; dockTypingUntil = 0;
            var outside = new Point(area.Right+100,area.Bottom+100);
            outsideSince = dockClock.ElapsedMilliseconds-saved.DockHideDelayMs+80;
            TickDockCore(true,outside);
            bool delayHonored = !dockHidden && !dockAnimating;
            dockBusy = true; outsideSince = dockClock.ElapsedMilliseconds-5000;
            TickDockCore(true,outside);
            bool busyPauses = outsideSince == 0 && !dockHidden;
            saved.DockHideDelayMs = 0;
            dockBusy = false; outsideSince = 0;
            TickDockCore(true,outside);
            bool savesConcurrently = dockAnimating && dockHidden && dockPreparing;
            bool zeroDelayStarts = savesConcurrently;
            saved.DockHideDelayMs = previousHideDelay;
            await Task.Delay(DockAnimationMs+80);
            saved.DockActivateOnHover=false;
            int hoverRequestsBefore=hoverActivationRequests;
            TickDockCore(true,new Point(Right-2,Top+Math.Min(Height/2,50)));
            bool hoverWhileSaving = !dockHidden;
            bool passiveHover=hoverActivationRequests==hoverRequestsBefore;
            AnimateDock(true); await Task.Delay(DockAnimationMs+80);
            saved.DockActivateOnHover=true;
            TickDockCore(true,new Point(Right-2,Top+Math.Min(Height/2,50)));
            bool activeHover=hoverActivationRequests==hoverRequestsBefore+1 && !dockHidden;
            saved.DockActivateOnHover=previousHoverActivation;
            await Task.Delay(900);
            dockBusy = wasBusy; dockTypingUntil = previousTyping;
            Bounds = expanded; expandedBounds = expanded; dockEdge = "left";
            var samples = new List<object>();
            legacyDockClock = true;
            AnimateDock(true); await Task.Delay(DockAnimationMs + 120);
            samples.Add(FrameStatistics("left",true,true));
            RevealDock(); await Task.Delay(DockAnimationMs + 120);
            samples.Add(FrameStatistics("left",false,true));
            legacyDockClock = false;
            bool strip = true, restored = true, allPumpsStopped = true;
            foreach (string side in new string[] { "left", "right", "top", "bottom" }) {
                Bounds = new Rectangle(side == "left" ? area.Left : side == "right" ? area.Right-expanded.Width : expanded.X,
                    side == "top" ? area.Top : side == "bottom" ? area.Bottom-expanded.Height : expanded.Y,expanded.Width,expanded.Height);
                expandedBounds = Bounds; dockEdge = side;
                var visible = Bounds;
                var hidden = GetDockHiddenBounds();
                AnimateDock(true); await Task.Delay(DockAnimationMs + 120);
                strip &= Bounds == hidden && Visible;
                samples.Add(FrameStatistics(side,true,false));
                allPumpsStopped &= !dockFrames.Running;
                RevealDock(); await Task.Delay(DockAnimationMs + 120);
                restored &= Bounds == visible;
                samples.Add(FrameStatistics(side,false,false));
                allPumpsStopped &= !dockFrames.Running;
            }
            // A reveal reverses from the current position without snapping back.
            AnimateDock(true); await Task.Delay(80);
            var halfway = Bounds;
            RevealDock();
            bool continuousReversal = Bounds == halfway;
            await Task.Delay(DockAnimationMs + 120);
            continuousReversal &= Bounds == expandedBounds && !dockFrames.Running;
            return new { corrected = corrected, horizontal = horizontal, visibleStrip = strip, restored = restored, repeatedDisplayFont = true,
                durationMs = DockAnimationMs, stripDip = 6, continuousReversal = continuousReversal,
                allPumpsStopped = allPumpsStopped, frameSamples = samples.ToArray(),
                delayHonored = delayHonored, busyPauses = busyPauses, savesConcurrently = savesConcurrently, hoverWhileSaving = hoverWhileSaving,
                zeroDelayStarts = zeroDelayStarts,
                hoverActivationOptIn = passiveHover && activeHover,
                previousPersistedHideDelayMs = previousPersistedHideDelay,
                persistedHideDelayMs = json.Deserialize<PreviewWindowSettings>(System.IO.File.ReadAllText(SettingsPath)).DockHideDelayMs };
        } finally {
            legacyDockClock = false; StopDockAnimation(); dockHidden = false; dockEdge = null;
            Bounds = previous; expandedBounds = previous; saved.EdgeSnap = enabled; saved.DockHideDelayMs = previousHideDelay; saved.DockActivateOnHover=previousHoverActivation;
            SaveSettings();
        }
    }
}
