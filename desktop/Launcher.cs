using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

// Small Windows shell. The Node service owns all diary data and business logic.
class Launcher
{
    const string Url = "http://127.0.0.1:18765";
    const string AppId = "diary-desktop-preview";
    const string NodeFallback = @"D:\软件\Apps\NodeJS\node-v24.18.1-win-x64\node.exe";

    static bool Ready()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(Url + "/api/health");
            request.Timeout = 700;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return reader.ReadToEnd().Contains(AppId);
        }
        catch { return false; }
    }

    static string FindNode()
    {
        foreach (var item in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            if (String.IsNullOrWhiteSpace(item)) continue;
            string candidate = Path.Combine(item.Trim('"'), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        if (File.Exists(NodeFallback)) return NodeFallback;
        throw new Exception("没有找到 Node.js，请检查本机 Node.js 安装。");
    }

    static void EnsureService(string root)
    {
        if (Ready()) return;
        string entry = Path.Combine(root, "server.mjs");
        if (!File.Exists(entry))
            throw new Exception("请保留启动程序和 server.mjs 在同一文件夹。");
        var start = new ProcessStartInfo(FindNode(), "\"" + entry + "\"")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        // The desktop shortcut always opens the normal library. CLI overrides stay in the CLI.
        start.EnvironmentVariables.Remove("DIARY_PORT");
        start.EnvironmentVariables.Remove("DIARY_DATA_DIR");
        Process.Start(start);
        for (int attempt = 0; attempt < 40 && !Ready(); attempt++) Thread.Sleep(200);
        if (!Ready()) throw new Exception("本地服务没有启动成功，可能默认端口已被其他程序占用。");
    }

    [STAThread]
    static void Main(string[] args)
    {
        try
        {
            EnsureService(AppDomain.CurrentDomain.BaseDirectory);
            if (args.Length > 0 && args[0] == "--check") return;
            string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(edge))
                Process.Start(new ProcessStartInfo(edge, "--app=" + Url + " --window-size=1440,940")
                { UseShellExecute = true });
            else Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "拾页 · 启动提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Environment.ExitCode = 1;
        }
    }
}
