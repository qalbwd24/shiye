using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal sealed class WorkspaceLaunchPlan
{
    public string Kind { get; private set; }
    public string FileName { get; private set; }
    public string Arguments { get; private set; }
    public string WorkingDirectory { get; private set; }
    internal WorkspaceLaunchPlan(string kind, string fileName, string arguments, string workingDirectory)
    {
        Kind = kind; FileName = fileName; Arguments = arguments; WorkingDirectory = workingDirectory;
    }
}

// Only the two existing application entry points may be launched from the chat shell.
internal static class WorkspaceLauncher
{
    internal static WorkspaceLaunchPlan Plan(string root, bool development, string kind)
    {
        if (kind != "quick" && kind != "notes") throw new ArgumentException("不支持的工作区入口。", "kind");
        if (String.IsNullOrWhiteSpace(root) || !Path.IsPathRooted(root) || root.IndexOf('"') >= 0)
            throw new ArgumentException("工作区必须使用项目绝对路径。", "root");
        root = Path.GetFullPath(root);
        if (!File.Exists(Path.Combine(root, "package.json")))
            throw new DirectoryNotFoundException("拾页项目目录不存在。");

        if (kind == "quick") {
            string executable = Path.Combine(root, "拾页快捷记录.exe");
            RequireFile(executable, "快捷写作程序不存在，请先完成桌面程序构建。");
            // Ordinary launch asks the shared host to restore the current editor.
            string arguments = development
                ? "--url=http://127.0.0.1:18766 --state-dir=" + Quote(Path.Combine(root, "var", "dev-quick-state"))
                : "";
            return new WorkspaceLaunchPlan(kind, executable, arguments, root);
        }

        string script = Path.Combine(root, "tools", "start-notes-preview.ps1");
        RequireFile(script, "便签启动入口不存在。");
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell", "v1.0", "powershell.exe");
        RequireFile(powershell, "Windows PowerShell 不存在，无法打开便签。");
        return new WorkspaceLaunchPlan(kind, powershell,
            "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(script), root);
    }

    internal static WorkspaceLaunchPlan Launch(string root, bool development, string kind, bool verify)
    {
        WorkspaceLaunchPlan plan = Plan(root, development, kind);
        if (verify) return plan;
        using (Process process = Process.Start(StartInfo(plan, false))) {
            if (process == null) throw new InvalidOperationException("工作区入口未能启动。");
        }
        return plan;
    }

    internal static Task<WorkspaceLaunchPlan> LaunchAsync(string root, bool development, string kind, bool verify)
    {
        WorkspaceLaunchPlan plan = Plan(root, development, kind);
        if (verify) return Task.FromResult(plan);
        return Task.Run(delegate {
            if (kind == "quick") {
                using (Process quick = Process.Start(StartInfo(plan, false))) {
                    if (quick == null) throw new InvalidOperationException("快捷写作入口未能启动。");
                }
                return plan;
            }
            using (var process = new Process { StartInfo = StartInfo(plan, true) }) {
                // Drain both pipes without keeping script output or including it in user errors.
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { };
                try {
                    if (!process.Start()) throw new InvalidOperationException("便签启动入口未能启动。");
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                } catch (Exception error) {
                    throw new InvalidOperationException("便签启动入口无法运行，请检查本机 PowerShell 后重试。", error);
                }
                if (!process.WaitForExit(20000)) {
                    // Stop only this timed-out launcher, never its editor or service children.
                    try { process.Kill(); } catch (InvalidOperationException) { }
                    catch (System.ComponentModel.Win32Exception) { }
                    throw new TimeoutException("便签启动超过20秒，请稍后重试。");
                }
                if (process.ExitCode != 0)
                    throw new InvalidOperationException("便签未能打开，请检查本地便签服务后重试。");
            }
            return plan;
        });
    }

    static ProcessStartInfo StartInfo(WorkspaceLaunchPlan plan, bool redirect)
    {
        return new ProcessStartInfo(plan.FileName, plan.Arguments) {
            WorkingDirectory = plan.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = redirect,
            RedirectStandardError = redirect,
            // The PowerShell helper stays hidden; it opens the existing visible notes editor.
            WindowStyle = plan.Kind == "notes" ? ProcessWindowStyle.Hidden : ProcessWindowStyle.Normal
        };
    }

    static string Quote(string path) { return "\"" + path + "\""; }
    static void RequireFile(string path, string message)
    {
        if (!File.Exists(path)) throw new FileNotFoundException(message, path);
    }
}
