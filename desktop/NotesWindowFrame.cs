using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Native title controls only: the NotesWindow still owns resize styles, saving
// and its normal FormClosing handshake. No document focus or content is owned here.
internal sealed class NotesWindowFrame : Panel
{
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    readonly Form owner;
    readonly NotesFrameCaption caption;
    readonly NotesFrameButton pin, minimize, maximize, close;
    readonly ToolTip tips = new ToolTip();
    Font captionFont;
    bool dark = true, pinned;
    internal bool Material;
    internal NotesFramePalette Palette;

    internal NotesWindowFrame(Form owner, Action togglePin)
    {
        if (owner == null) throw new ArgumentNullException("owner");
        if (togglePin == null) throw new ArgumentNullException("togglePin");
        this.owner = owner;
        Dock = DockStyle.Top;
        AutoSize = false;
        TabStop = false;
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.ResizeRedraw, true);
        caption = new NotesFrameCaption { AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft, TabStop = false };
        caption.MouseDown += DragCaption;
        caption.MouseUp += CaptionMouseUp;
        caption.DoubleClick += ToggleMaximize;
        MouseDown += DragCaption;
        MouseUp += CaptionMouseUp;
        DoubleClick += ToggleMaximize;
        pin = new NotesFrameButton(NotesFrameGlyph.Pin) { Name = "NotesWindowPin", AccessibleName = "窗口置顶" };
        minimize = new NotesFrameButton(NotesFrameGlyph.Minimize) { Name = "NotesWindowMinimize", AccessibleName = "最小化" };
        maximize = new NotesFrameButton(NotesFrameGlyph.Maximize) { Name = "NotesWindowMaximize", AccessibleName = "最大化" };
        close = new NotesFrameButton(NotesFrameGlyph.Close) { Name = "NotesWindowClose", AccessibleName = "关闭便签" };
        // Mouse clicks on pin must not leave keyboard focus in the title bar.
        // Tab navigation deliberately keeps normal accessible button behaviour.
        pin.PreserveMouseFocusOwner = owner;
        pin.Click += delegate { togglePin(); UpdateState(owner.TopMost, dark); };
        minimize.Click += delegate { owner.WindowState = FormWindowState.Minimized; };
        maximize.Click += ToggleMaximize;
        close.Click += delegate { owner.Close(); };
        Controls.AddRange(new Control[] { caption, pin, minimize, maximize, close });
        tips.ShowAlways = true;
        tips.InitialDelay = 450;
        tips.ReshowDelay = 100;
        owner.SizeChanged += OwnerLayoutChanged;
        owner.TextChanged += OwnerLayoutChanged;
        owner.DpiChanged += OwnerDpiChanged;
        UpdateState(owner.TopMost, true);
    }

    internal void UpdateState(bool topMost, bool dark)
    {
        if (IsDisposed) return;
        this.dark = dark;
        pinned = topMost;
        BackColor = dark ? Color.FromArgb(41, 45, 48) : Color.FromArgb(242, 242, 242);
        caption.ForeColor = dark ? Color.FromArgb(202, 208, 212) : Color.FromArgb(59, 65, 69);
        caption.BackColor = BackColor;
        caption.Material = Material;
        caption.Palette = Palette;
        caption.Invalidate();
        caption.Text = owner.Text;
        bool restored = owner.WindowState == FormWindowState.Maximized;
        maximize.Glyph = restored ? NotesFrameGlyph.Restore : NotesFrameGlyph.Maximize;
        maximize.AccessibleName = restored ? "还原" : "最大化";
        pin.Active = pinned;
        pin.AccessibleDescription = pinned ? "已置顶，点击取消" : "点击使窗口保持在其他窗口上方";
        foreach (var button in new[] { pin, minimize, maximize, close }) {
            button.Dark = dark;
            button.Material = Material;
            button.Palette = Palette;
            button.BackColor = BackColor;
            button.Invalidate();
        }
        tips.SetToolTip(pin, pinned ? "取消窗口置顶" : "窗口置顶");
        tips.SetToolTip(minimize, "最小化");
        tips.SetToolTip(maximize, maximize.AccessibleName);
        tips.SetToolTip(close, "关闭便签");
        LayoutFrame();
        Invalidate();
    }

    void OwnerLayoutChanged(object sender, EventArgs args) { UpdateState(owner.TopMost, dark); }
    void OwnerDpiChanged(object sender, DpiChangedEventArgs args) { UpdateState(owner.TopMost, dark); }

    void LayoutFrame()
    {
        if (IsDisposed) return;
        float scale = Math.Max(1, owner.DeviceDpi) / 96f;
        int targetHeight = (int)Math.Round(44 * scale);
        if (Height != targetHeight) Height = targetHeight;
        int buttonWidth = (int)Math.Round(48 * scale);
        int x = ClientSize.Width;
        foreach (var button in new[] { close, maximize, minimize, pin }) {
            x -= buttonWidth;
            button.Bounds = new Rectangle(x, 0, buttonWidth, targetHeight);
            button.ScaleFactor = scale;
        }
        int inset = (int)Math.Round(12 * scale);
        caption.Bounds = new Rectangle(inset, 0, Math.Max(0, x - inset * 2), targetHeight);
        float fontSize = 16 * scale;
        if (captionFont == null || Math.Abs(captionFont.Size - fontSize) > 0.1f) {
            var previousFont = captionFont;
            captionFont = new Font("Microsoft YaHei UI", fontSize, GraphicsUnit.Pixel);
            caption.Font = captionFont;
            if (previousFont != null) previousFont.Dispose();
        }
    }

    protected override void OnSizeChanged(EventArgs args)
    {
        base.OnSizeChanged(args);
        if (caption != null) LayoutFrame();
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (Palette != null) Palette.Paint(e.Graphics, this);
        else base.OnPaintBackground(e);
    }

    // Every bound and font is computed from the owner's current DeviceDpi.
    // Parent AutoScale must not apply that same DPI factor to our children again.
    protected override bool ScaleChildren { get { return false; } }
    protected override void ScaleControl(SizeF factor, BoundsSpecified specified)
    {
        if (caption != null) LayoutFrame();
    }

    void DragCaption(object sender, MouseEventArgs args)
    {
        if (args.Button != MouseButtons.Left || args.Clicks != 1 || !owner.IsHandleCreated) return;
        ReleaseCapture();
        Point cursor = Cursor.Position;
        IntPtr position = new IntPtr((cursor.Y << 16) | (cursor.X & 0xffff));
        SendMessage(owner.Handle, 0x00A1, new IntPtr(2), position); // WM_NCLBUTTONDOWN, HTCAPTION
    }

    void CaptionMouseUp(object sender, MouseEventArgs args)
    {
        if (args.Button == MouseButtons.Right && owner.IsHandleCreated)
            SendMessage(owner.Handle, 0x0112, new IntPtr(0xf100), new IntPtr(32));
    }

    void ToggleMaximize(object sender, EventArgs args)
    {
        owner.WindowState = owner.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
        UpdateState(owner.TopMost, dark);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) {
            owner.SizeChanged -= OwnerLayoutChanged;
            owner.TextChanged -= OwnerLayoutChanged;
            owner.DpiChanged -= OwnerDpiChanged;
            tips.Dispose();
            if (captionFont != null) captionFont.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal enum NotesFrameGlyph { Pin, Minimize, Maximize, Restore, Close }

internal sealed class NotesFrameCaption : Label
{
    internal bool Material;
    internal NotesFramePalette Palette;
    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (Palette != null) Palette.Paint(e.Graphics, this);
        else base.OnPaintBackground(e);
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        if (Palette == null) { base.OnPaint(e); return; }
        e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        using (var brush = new SolidBrush(ForeColor))
        using (var format = new StringFormat { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center,
            Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
            e.Graphics.DrawString(Text, Font, brush, ClientRectangle, format);
    }
}

internal sealed class NotesResizeGrip : Control
{
    readonly Form owner;
    readonly int hitTest;
    int regionEdge = -1, regionCorner = -1;
    internal bool Material;
    internal NotesFramePalette Palette;
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    internal NotesResizeGrip(Form owner, int hitTest)
    {
        this.owner = owner;
        this.hitTest = hitTest;
        TabStop = false;
        SetStyle(ControlStyles.Selectable, false);
        AccessibleRole = AccessibleRole.Grip;
    }

    internal void SetCornerRegion(int index, int edge, int corner)
    {
        if (regionEdge == edge && regionCorner == corner) return;
        regionEdge = edge; regionCorner = corner;
        Region previous = Region;
        if (index == 0 || index == 2 || index == 5 || index == 7) {
            bool right = index == 2 || index == 7;
            bool bottom = index == 5 || index == 7;
            var region = new Region(new Rectangle(right ? corner - edge : 0, 0, edge, corner));
            region.Union(new Rectangle(0, bottom ? corner - edge : 0, corner, edge));
            Region = region;
        } else Region = null;
        if (previous != null) previous.Dispose();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left || owner.WindowState != FormWindowState.Normal) return;
        ReleaseCapture();
        Point cursor = Cursor.Position;
        IntPtr position = new IntPtr((cursor.Y << 16) | (cursor.X & 0xffff));
        SendMessage(owner.Handle, 0x00A1, new IntPtr(hitTest), position);
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (Palette != null) Palette.Paint(e.Graphics, this);
        else base.OnPaintBackground(e);
    }
}

internal sealed class NotesFrameButton : Button
{
    internal NotesFrameGlyph Glyph;
    internal float ScaleFactor = 1;
    internal bool Active, Dark = true, Material;
    internal NotesFramePalette Palette;
    internal Form PreserveMouseFocusOwner;
    Control mouseFocus;
    bool hovered, pressed, restoreMouseFocus;

    internal NotesFrameButton(NotesFrameGlyph glyph)
    {
        Glyph = glyph;
        Text = "";
        TabStop = true;
        AccessibleRole = AccessibleRole.PushButton;
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        UseVisualStyleBackColor = false;
        SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true);
    }

    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = false; pressed = false; restoreMouseFocus = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { pressed = false; Invalidate(); base.OnLostFocus(e); }
    protected override void OnMouseDown(MouseEventArgs e)
    {
        pressed = e.Button == MouseButtons.Left;
        restoreMouseFocus = pressed && PreserveMouseFocusOwner != null;
        mouseFocus = restoreMouseFocus ? PreserveMouseFocusOwner.ActiveControl : null;
        base.OnMouseDown(e);
        Invalidate();
    }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; base.OnMouseUp(e); Invalidate(); }
    protected override void OnClick(EventArgs e)
    {
        bool restore = restoreMouseFocus;
        var previous = mouseFocus;
        restoreMouseFocus = false;
        mouseFocus = null;
        base.OnClick(e);
        if (restore && !PreserveMouseFocusOwner.IsDisposed && previous != null && !previous.IsDisposed && previous.CanSelect)
            PreserveMouseFocusOwner.ActiveControl = previous;
    }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Enter && !e.Alt && !e.Control && !e.Shift) {
            e.Handled = true; e.SuppressKeyPress = true; PerformClick(); return;
        }
        base.OnKeyDown(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Color background = Dark ? Color.FromArgb(41, 45, 48) : Color.FromArgb(242, 242, 242);
        if (Active) background = Dark ? Color.FromArgb(49, 61, 61) : Color.FromArgb(222, 232, 229);
        if (hovered || Focused) background = Dark ? Color.FromArgb(55, 61, 65) : Color.FromArgb(225, 228, 230);
        if (pressed) background = Dark ? Color.FromArgb(67, 73, 77) : Color.FromArgb(211, 216, 219);
        if (Glyph == NotesFrameGlyph.Close && hovered) background = pressed ? Color.FromArgb(151, 45, 45) : Color.FromArgb(184, 55, 55);
        if (Palette == null) e.Graphics.Clear(background);
        else {
            Palette.Paint(e.Graphics, this);
            if (hovered || Focused || pressed || Active) {
                int opacity = Glyph == NotesFrameGlyph.Close && hovered ? 255 : (pressed ? 180 : 140);
                using (var brush = new SolidBrush(Color.FromArgb(opacity, background))) e.Graphics.FillRectangle(brush, ClientRectangle);
            }
        }
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var saved = e.Graphics.Save();
        e.Graphics.TranslateTransform(ClientSize.Width / 2f, ClientSize.Height / 2f);
        // Geometry is in DIP: the visible glyph itself is about 22-24 DIP,
        // independent of the wider button hit target and physical monitor DPI.
        e.Graphics.ScaleTransform(ScaleFactor, ScaleFactor);
        Color foreground = Dark ? Color.FromArgb(227, 232, 234) : Color.FromArgb(62, 70, 74);
        if (Active) foreground = Dark ? Color.FromArgb(190, 214, 205) : Color.FromArgb(64, 101, 90);
        if (Glyph == NotesFrameGlyph.Close && hovered) foreground = Color.White;
        using (var pen = new Pen(foreground, 1.9f)) {
            pen.StartCap = pen.EndCap = LineCap.Round;
            if (Glyph == NotesFrameGlyph.Pin) {
                if (!Active) e.Graphics.RotateTransform(35);
                e.Graphics.DrawLines(pen, new[] { new PointF(-5, -10), new PointF(5, -10), new PointF(3.5f, -2), new PointF(7.5f, 3.5f), new PointF(-7.5f, 3.5f), new PointF(-3.5f, -2), new PointF(-5, -10) });
                e.Graphics.DrawLine(pen, 0, 3.5f, 0, 12);
            } else if (Glyph == NotesFrameGlyph.Minimize) e.Graphics.DrawLine(pen, -11, 1, 11, 1);
            else if (Glyph == NotesFrameGlyph.Maximize) e.Graphics.DrawRectangle(pen, -10.5f, -10.5f, 21, 21);
            else if (Glyph == NotesFrameGlyph.Restore) {
                e.Graphics.DrawLines(pen, new[] { new PointF(-5, -8), new PointF(-5, -11), new PointF(11, -11), new PointF(11, 5), new PointF(8, 5) });
                e.Graphics.DrawRectangle(pen, -10, -6, 16, 16);
            } else if (Glyph == NotesFrameGlyph.Close) {
                e.Graphics.DrawLine(pen, -11, -11, 11, 11);
                e.Graphics.DrawLine(pen, -11, 11, 11, -11);
            }
        }
        e.Graphics.Restore(saved);
        if (Focused && ShowFocusCues) {
            using (var pen = new Pen(Dark ? Color.FromArgb(118, 129, 134) : Color.FromArgb(136, 146, 151), Math.Max(1, ScaleFactor))) {
                var inset = Math.Max(2, (int)Math.Round(3 * ScaleFactor));
                e.Graphics.DrawRectangle(pen, inset, inset, Math.Max(1, Width - inset * 2 - 1), Math.Max(1, Height - inset * 2 - 1));
            }
        }
    }
}
