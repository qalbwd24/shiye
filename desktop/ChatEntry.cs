using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class ChatEntry
{
    [STAThread]
    static void Main()
    {
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var target = Path.Combine(root, "outputs", "2026-10-15-Telegram聊天预览", "拾页对话预览.exe");
        if (!File.Exists(target)) {
            MessageBox.Show("未找到聊天窗口程序，请保留拾页项目中的 outputs 目录。", "拾页聊天");
            return;
        }
        Process.Start(new ProcessStartInfo(target) { WorkingDirectory = Path.GetDirectoryName(target), UseShellExecute = true });
    }
}
