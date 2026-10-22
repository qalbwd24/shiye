using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// A restrained wallpaper-colour gradient, not Mica, blur or live transparency.
// Load is synchronous by design: its caller runs it on a background task.
internal sealed class NotesFramePalette
{
    [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SystemParametersInfo(uint action, uint length, StringBuilder value, uint flags);

    internal Color Left, Right;
    internal bool FromWallpaper;

    internal static NotesFramePalette Load(bool dark)
    {
        Color neutral = dark ? Color.FromArgb(41, 45, 48) : Color.FromArgb(242, 242, 242);
        var palette = new NotesFramePalette { Left = neutral, Right = neutral };
        try {
            var path = new StringBuilder(32768);
            if (!SystemParametersInfo(0x0073, (uint)path.Capacity, path, 0) || path.Length == 0) return palette;
            // The original stays in place and is closed as soon as sampling ends.
            // Do not retain, copy or log the private wallpaper path or pixels.
            using (var image = Image.FromFile(path.ToString()))
            using (var sample = new Bitmap(64, 32, PixelFormat.Format24bppRgb)) {
                using (var graphics = Graphics.FromImage(sample)) {
                    graphics.Clear(neutral);
                    graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
                    graphics.DrawImage(image, new Rectangle(0, 0, sample.Width, sample.Height));
                }
                Color left = Tint(neutral, Average(sample, 0, sample.Width / 2), dark);
                Color right = Tint(neutral, Average(sample, sample.Width / 2, sample.Width), dark);
                Color middle = Mix(left, right, 0.5);
                // Keep even a black/white wallpaper's regional transition quiet.
                palette.Left = Mix(middle, left, 0.45);
                palette.Right = Mix(middle, right, 0.45);
                palette.FromWallpaper = true;
            }
        } catch (Exception) {
            // Missing files, slideshow races, unsupported image types and older
            // Windows must leave an ordinary readable neutral frame available.
        }
        return palette;
    }

    internal void Paint(Graphics graphics, Control control)
    {
        if (graphics == null) throw new ArgumentNullException("graphics");
        if (control == null) throw new ArgumentNullException("control");
        if (control.ClientSize.Width <= 0 || control.ClientSize.Height <= 0) return;
        if (Left.ToArgb() == Right.ToArgb()) {
            using (var brush = new SolidBrush(Left)) graphics.FillRectangle(brush, control.ClientRectangle);
            return;
        }
        int offsetX = 0;
        Control ancestor = control;
        while (ancestor != null && !(ancestor is Form)) {
            offsetX += ancestor.Left;
            ancestor = ancestor.Parent;
        }
        // Reading Parent/Left/ClientSize never creates a native handle. Every
        // nested caption, grip and button samples the same form-wide gradient.
        int width = ancestor == null ? Math.Max(1, control.ClientSize.Width) : Math.Max(1, ancestor.ClientSize.Width);
        if (ancestor == null) offsetX = 0;
        var bounds = new Rectangle(-offsetX, 0, width, Math.Max(1, control.ClientSize.Height));
        using (var brush = new LinearGradientBrush(bounds, Left, Right, LinearGradientMode.Horizontal)) {
            brush.GammaCorrection = true;
            graphics.FillRectangle(brush, control.ClientRectangle);
        }
    }

    static Color Average(Bitmap sample, int startX, int endX)
    {
        long red = 0, green = 0, blue = 0;
        int count = (endX - startX) * sample.Height;
        for (int y = 0; y < sample.Height; y++) for (int x = startX; x < endX; x++) {
            Color pixel = sample.GetPixel(x, y);
            red += pixel.R; green += pixel.G; blue += pixel.B;
        }
        return Color.FromArgb((int)(red / count), (int)(green / count), (int)(blue / count));
    }

    static Color Tint(Color neutral, Color wallpaper, bool dark)
    {
        // Desaturate before mixing: saturated blue/orange must not turn into an
        // accent-coloured title bar. The small mix keeps light/dark text contrast.
        int luminance = Channel(wallpaper.R * 0.2126 + wallpaper.G * 0.7152 + wallpaper.B * 0.0722);
        Color gray = Color.FromArgb(luminance, luminance, luminance);
        return Mix(neutral, Mix(gray, wallpaper, 0.28), dark ? 0.14 : 0.10);
    }

    static Color Mix(Color first, Color second, double amount)
    {
        return Color.FromArgb(Channel(first.R + (second.R - first.R) * amount),
            Channel(first.G + (second.G - first.G) * amount), Channel(first.B + (second.B - first.B) * amount));
    }

    static int Channel(double value) { return Math.Max(0, Math.Min(255, (int)Math.Round(value))); }
}
