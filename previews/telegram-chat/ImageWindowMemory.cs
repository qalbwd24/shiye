using System;
using System.IO;
using System.Drawing;
using System.Collections.Generic;
using System.Windows.Forms;

internal sealed class ImageWindowPreferences {
    public Dictionary<string,DisplayWindowProfile> Displays {get;set;}
    public ImageWindowPreferences() { Displays=new Dictionary<string,DisplayWindowProfile>(); }
}

internal sealed partial class ImageViewerWindow {
    readonly System.Windows.Forms.Timer imageMemoryTimer=new System.Windows.Forms.Timer {Interval=350};
    string imageDisplayId;
    Rectangle imageRememberedBounds, imageRememberedArea;
    int imageRememberedDpi;
    bool imageRememberedMaximized, imageMoving, imageSettingsReady, selectingImageDisplay;
    bool imageMemoryRestored;
    string ImageSettingsPath { get { return Path.Combine(Path.GetDirectoryName(profile),"image-window.json"); } }
    ImageWindowPreferences ReadImageSettings() {
        try { return json.Deserialize<ImageWindowPreferences>(File.ReadAllText(ImageSettingsPath)) ?? new ImageWindowPreferences(); }
        catch(IOException) { return new ImageWindowPreferences(); }
        catch(ArgumentException) { return new ImageWindowPreferences(); }
    }
    void RestoreImageBounds(Rectangle ownerBounds) {
        var screen=Screen.FromRectangle(ownerBounds);
        var area=screen.WorkingArea;
        int dpi=DisplayMemory.Dpi(screen,96);
        imageDisplayId=DisplayMemory.Identity(screen);
        var settings=ReadImageSettings();
        DisplayWindowProfile memory;
        MinimumSize=ImageMinimumFor(screen);
        if(settings.Displays!=null && settings.Displays.TryGetValue(imageDisplayId,out memory) && memory!=null) {
            imageMemoryRestored=true;
            Bounds=DisplayMemory.Restore(memory,area,dpi,ImageMinimumDip);
            MaximizedBounds=area;
            if(memory.Maximized) WindowState=FormWindowState.Maximized;
        } else {
            int width=Math.Min(area.Width,(int)(1000*dpi/96.0)), height=Math.Min(area.Height,(int)(760*dpi/96.0));
            Bounds=DisplayLayout.Fit(new Rectangle(ownerBounds.Left+(ownerBounds.Width-width)/2,ownerBounds.Top+(ownerBounds.Height-height)/2,width,height),area,MinimumSize);
        }
        RememberImageBounds(area,dpi);
        imageSettingsReady=true;
        Move += delegate { if(!selectingImageDisplay && !imageMoving && imageReady) {imageMemoryTimer.Stop();imageMemoryTimer.Start();} };
        ResizeEnd += delegate { FitDisplay(null); SaveImageSettings(); };
        imageMemoryTimer.Tick += delegate { imageMemoryTimer.Stop(); FitDisplay(null); SaveImageSettings(); };
    }
    void RememberImageBounds(Rectangle area,int dpi) {
        imageRememberedBounds=WindowState==FormWindowState.Normal?Bounds:RestoreBounds;
        imageRememberedArea=area;imageRememberedDpi=dpi;
        if(WindowState!=FormWindowState.Minimized) imageRememberedMaximized=WindowState==FormWindowState.Maximized;
    }
    void StoreImageProfile(string identity,Rectangle bounds,Rectangle area,int dpi,bool maximized) {
        var settings=ReadImageSettings();
        if(settings.Displays==null) settings.Displays=new Dictionary<string,DisplayWindowProfile>();
        settings.Displays[identity]=DisplayMemory.Capture(bounds,area,dpi,1,maximized);
        Directory.CreateDirectory(Path.GetDirectoryName(ImageSettingsPath));
        string temporary=ImageSettingsPath+"."+Guid.NewGuid().ToString("N")+".tmp";
        File.WriteAllText(temporary,json.Serialize(settings));
        if(File.Exists(ImageSettingsPath)) File.Replace(temporary,ImageSettingsPath,null);else File.Move(temporary,ImageSettingsPath);
    }
    Rectangle SelectImageDisplay(Rectangle reference) {
        if(!imageSettingsReady || selectingImageDisplay || imageMoving) return reference;
        var screen=Screen.FromRectangle(reference);
        string next=DisplayMemory.Identity(screen);
        if(next==imageDisplayId) return reference;
        selectingImageDisplay=true;
        try {
            MinimumSize=ImageMinimumFor(screen);
            StoreImageProfile(imageDisplayId,imageRememberedBounds,imageRememberedArea,imageRememberedDpi,imageRememberedMaximized);
            imageDisplayId=next;
            DisplayWindowProfile memory;
            var settings=ReadImageSettings();
            if(settings.Displays!=null && settings.Displays.TryGetValue(next,out memory) && memory!=null) {
                WindowState=FormWindowState.Normal;
                Bounds=DisplayMemory.Restore(memory,screen.WorkingArea,DisplayMemory.Dpi(screen,96),ImageMinimumDip);
                MaximizedBounds=screen.WorkingArea;
                if(memory.Maximized) WindowState=FormWindowState.Maximized;
                return Bounds;
            }
            return reference;
        } catch(IOException) { return reference; } catch(UnauthorizedAccessException) { return reference; }
        finally { selectingImageDisplay=false; }
    }
    void SaveImageSettings() {
        if(!imageSettingsReady || !imageReady || imageMoving || selectingImageDisplay) return;
        try {
            var reference=WindowState==FormWindowState.Normal?Bounds:RestoreBounds;
            SelectImageDisplay(reference);
            var screen=Screen.FromRectangle(WindowState==FormWindowState.Normal?Bounds:RestoreBounds);
            RememberImageBounds(screen.WorkingArea,DisplayMemory.Dpi(screen,96));
            StoreImageProfile(imageDisplayId,imageRememberedBounds,imageRememberedArea,imageRememberedDpi,imageRememberedMaximized);
        } catch(IOException) {} catch(UnauthorizedAccessException) {}
    }
}
