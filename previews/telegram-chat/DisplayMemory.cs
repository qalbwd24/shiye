using System;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed class DisplayWindowProfile
{
    public double LeftDip { get; set; }
    public double TopDip { get; set; }
    public double WidthDip { get; set; }
    public double HeightDip { get; set; }
    public double TextScale { get; set; }
    public bool Maximized { get; set; }
}

internal static class DisplayMemory
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DisplayDevice {
        public int Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Description;
        public int Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Key;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice result, uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);
    internal static string Identity(Screen screen) {
        var device = new DisplayDevice { Size = Marshal.SizeOf(typeof(DisplayDevice)) };
        // Monitor interface identity survives desktop origin, resolution and DPI changes.
        if (EnumDisplayDevices(screen.DeviceName,0,ref device,1) && !String.IsNullOrEmpty(device.Id)) return device.Id;
        return "device:" + screen.DeviceName;
    }
    internal static int Dpi(Screen screen, int fallback) {
        try {
            uint x,y;
            var center = new Point(screen.Bounds.Left+screen.Bounds.Width/2, screen.Bounds.Top+screen.Bounds.Height/2);
            if (GetDpiForMonitor(MonitorFromPoint(center,2),0,out x,out y)==0 && x>=96 && x<=768) return (int)x;
        } catch (DllNotFoundException) {} catch (EntryPointNotFoundException) {}
        return Math.Max(96,fallback);
    }
    internal static double Scale(double value) {
        return Double.IsNaN(value) || Double.IsInfinity(value) ? 1 : Math.Max(0.5,Math.Min(2.5,value));
    }
    internal static DisplayWindowProfile Capture(Rectangle bounds, Rectangle area, int dpi, double textScale, bool maximized) {
        double factor = Math.Max(96,dpi)/96.0;
        return new DisplayWindowProfile { LeftDip=(bounds.Left-area.Left)/factor, TopDip=(bounds.Top-area.Top)/factor,
            WidthDip=bounds.Width/factor, HeightDip=bounds.Height/factor, TextScale=Scale(textScale), Maximized=maximized };
    }
    internal static Rectangle Restore(DisplayWindowProfile profile, Rectangle area, int dpi) {
        return Restore(profile,area,dpi,PreviewWindow.MinimumDip);
    }
    internal static Rectangle Restore(DisplayWindowProfile profile, Rectangle area, int dpi, Size minimumDip) {
        double factor = Math.Max(96,dpi)/96.0;
        Func<double,int,int> pixel = (value,fallback) => Double.IsNaN(value) || Double.IsInfinity(value) || Math.Abs(value)>100000 ? fallback : (int)Math.Round(value*factor);
        return DisplayLayout.Fit(new Rectangle(area.Left+pixel(profile.LeftDip,40),area.Top+pixel(profile.TopDip,40),
            pixel(profile.WidthDip,900),pixel(profile.HeightDip,700)),area,new Size((int)(minimumDip.Width*factor),(int)(minimumDip.Height*factor)));
    }
    internal static bool SelfTest() {
        var a=new Rectangle(-1920,40,1920,1040);
        var b=new Rectangle(0,0,3840,2120);
        var first=new Rectangle(-1800,100,900,700);
        var second=new Rectangle(300,160,1800,1400);
        var settings=new PreviewWindowSettings { LastDisplayId="monitor-a", Displays=new Dictionary<string,DisplayWindowProfile>() };
        settings.Displays["monitor-a"]=Capture(first,a,96,1.2,false);
        settings.Displays["monitor-b"]=Capture(second,b,192,1.8,true);
        var serializer=new System.Web.Script.Serialization.JavaScriptSerializer();
        var reopened=serializer.Deserialize<PreviewWindowSettings>(serializer.Serialize(settings));
        bool passed=Restore(reopened.Displays["monitor-a"],a,96)==first && Restore(reopened.Displays["monitor-b"],b,192)==second;
        passed &= reopened.Displays["monitor-a"].TextScale==1.2 && reopened.Displays["monitor-b"].TextScale==1.8 && reopened.Displays["monitor-b"].Maximized;
        var relocated=new Rectangle(4000,-100,1920,1040);
        passed &= Restore(reopened.Displays["monitor-a"],relocated,96)==new Rectangle(4120,-40,900,700);
        passed &= new Rectangle(0,0,800,560).Contains(Restore(reopened.Displays["monitor-b"],new Rectangle(0,0,800,560),192));
        passed &= Scale(Double.NaN)==1 && Scale(100)==2.5;
        // Updating A does not consume or rewrite the disconnected monitor B record.
        reopened.Displays["monitor-a"]=Capture(first,a,96,1.4,false);
        passed &= reopened.Displays.Count==2 && reopened.Displays["monitor-b"].TextScale==1.8;
        return passed;
    }
}

internal sealed partial class PreviewWindow
{
    string activeDisplayId;
    Rectangle rememberedBounds, rememberedArea;
    int rememberedDpi;
    bool rememberedMaximized, switchingDisplay, nativeMoving;

    void RememberDisplay(Rectangle bounds, Rectangle area) {
        rememberedBounds=bounds; rememberedArea=area; rememberedDpi=nativeDpi;
        rememberedMaximized=WindowState==FormWindowState.Maximized || (WindowState==FormWindowState.Minimized && saved.Maximized);
        saved.Displays[activeDisplayId]=DisplayMemory.Capture(bounds,area,nativeDpi,saved.TextScale ?? 1,rememberedMaximized);
        saved.LastDisplayId=activeDisplayId;
    }
    void RestoreDisplayAtStartup() {
        if (saved.Displays==null) saved.Displays=new Dictionary<string,DisplayWindowProfile>();
        Screen selected=null;
        foreach (var screen in Screen.AllScreens) if (DisplayMemory.Identity(screen)==saved.LastDisplayId) selected=screen;
        if (selected==null) selected=Screen.FromRectangle(Bounds);
        activeDisplayId=DisplayMemory.Identity(selected);
        nativeDpi=DisplayMemory.Dpi(selected,nativeDpi);
        DisplayWindowProfile profile;
        if (saved.Displays.TryGetValue(activeDisplayId,out profile) && profile!=null) {
            WindowState=FormWindowState.Normal; Bounds=DisplayMemory.Restore(profile,selected.WorkingArea,nativeDpi);
            saved.TextScale=DisplayMemory.Scale(profile.TextScale);
            if(profile.Maximized) WindowState=FormWindowState.Maximized;
        }
        var bounds=WindowState==FormWindowState.Normal?Bounds:RestoreBounds;
        RememberDisplay(bounds,selected.WorkingArea);
    }
    bool SelectDisplay(Rectangle reference, int dpi) {
        if(switchingDisplay || activeDisplayId==null || nativeMoving || isResizing || verify) return false;
        var screen=Screen.FromRectangle(reference);
        string next=DisplayMemory.Identity(screen);
        if(next==activeDisplayId) return false;
        return SwitchDisplayTo(next,screen.WorkingArea,DisplayMemory.Dpi(screen,dpi),reference);
    }
    bool SwitchDisplayTo(string next, Rectangle area, int dpi, Rectangle reference) {
        switchingDisplay=true;
        try {
            // Never attribute the already-moved bounds to the screen we just left.
            saved.Displays[activeDisplayId]=DisplayMemory.Capture(rememberedBounds,rememberedArea,rememberedDpi,saved.TextScale ?? 1,rememberedMaximized);
            activeDisplayId=next; nativeDpi=dpi;
            DisplayWindowProfile profile;
            bool found=saved.Displays.TryGetValue(next,out profile) && profile!=null;
            bool maximized=found?profile.Maximized:WindowState==FormWindowState.Maximized;
            if(found) saved.TextScale=DisplayMemory.Scale(profile.TextScale);
            StopDockAnimation(); dockHidden=false; dockEdge=null;
            WindowState=FormWindowState.Normal;
            Bounds=found?DisplayMemory.Restore(profile,area,nativeDpi):DisplayLayout.Fit(reference,area,new Size(ScaleDip(MinimumDip.Width),ScaleDip(MinimumDip.Height)));
            if(maximized) WindowState=FormWindowState.Maximized;
            PerformLayout(); UpdateDockEdge();
            RememberDisplay(WindowState==FormWindowState.Normal?Bounds:RestoreBounds,area);
            return true;
        } finally { switchingDisplay=false; }
    }
    object VerifyDisplayMemory() {
        var original=saved;
        var originalId=activeDisplayId;
        var originalBounds=Bounds;
        var originalMinimum=MinimumSize;
        var originalArea=rememberedArea;
        var originalRemembered=rememberedBounds;
        int originalDpi=nativeDpi, originalRememberedDpi=rememberedDpi;
        bool originalMaximized=rememberedMaximized;
        dockTimer.Stop(); settingsTimer.Stop();
        try {
            WindowState=FormWindowState.Normal;
            // Synthetic monitor fixtures use explicit physical rectangles independent of this host's DPI.
            MinimumSize=MinimumDip;
            var a=new Rectangle(0,0,1920,1040);
            var b=new Rectangle(1920,0,2560,1400);
            saved=new PreviewWindowSettings { Displays=new Dictionary<string,DisplayWindowProfile>(), TextScale=1.2 };
            activeDisplayId="test-monitor-a"; nativeDpi=96;
            Bounds=new Rectangle(120,80,900,700); RememberDisplay(Bounds,a);
            SwitchDisplayTo("test-monitor-b",b,144,new Rectangle(2000,50,1100,900));
            bool firstVisit=saved.TextScale==1.2 && saved.Displays.Count==2;
            saved.TextScale=1.8; Bounds=new Rectangle(2040,80,1350,1000); RememberDisplay(Bounds,b);
            SwitchDisplayTo("test-monitor-a",a,96,new Rectangle(80,60,1000,800));
            bool backA=saved.TextScale==1.2 && Bounds==new Rectangle(120,80,900,700);
            SwitchDisplayTo("test-monitor-b",b,144,new Rectangle(2000,30,900,700));
            bool backB=saved.TextScale==1.8 && Bounds==new Rectangle(2040,80,1350,1000);
            // Same serializer as window.json: reload, then restore both independent profiles.
            var reopened=json.Deserialize<PreviewWindowSettings>(json.Serialize(saved));
            bool restart=DisplayMemory.Restore(reopened.Displays["test-monitor-a"],a,96)==new Rectangle(120,80,900,700)
                && reopened.Displays["test-monitor-b"].TextScale==1.8;
            SwitchDisplayTo("test-monitor-a",a,96,Bounds);
            bool disconnected=saved.Displays.ContainsKey("test-monitor-b") && saved.Displays["test-monitor-b"].TextScale==1.8;
            Bounds=new Rectangle(120,80,360,700); RememberDisplay(Bounds,a);
            var narrowReload=json.Deserialize<PreviewWindowSettings>(json.Serialize(saved));
            bool narrowRestart=DisplayMemory.Restore(narrowReload.Displays["test-monitor-a"],a,96).Width==360
                && DisplayMemory.Restore(narrowReload.Displays["test-monitor-a"],b,144).Width==540;
            SwitchDisplayTo("test-monitor-b",b,144,Bounds);
            SwitchDisplayTo("test-monitor-a",a,96,Bounds);
            bool narrowReturn=Bounds.Width==360;
            return new { firstVisit=firstVisit, returnToA=backA, returnToB=backB, restart=restart, disconnectedPreserved=disconnected, geometry=DisplayMemory.SelfTest(), narrowRestart=narrowRestart,narrowReturn=narrowReturn };
        } finally {
            saved=original; activeDisplayId=originalId; nativeDpi=originalDpi;
            rememberedBounds=originalRemembered; rememberedArea=originalArea; rememberedDpi=originalRememberedDpi; rememberedMaximized=originalMaximized;
            MinimumSize=originalMinimum;
            Bounds=originalBounds; expandedBounds=originalBounds; settingsTimer.Stop(); dockTimer.Start();
        }
    }
}
