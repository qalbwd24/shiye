using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

// Explicit local deployment configuration separates executable location from existing user state.
internal sealed class DesktopPaths
{
    internal readonly bool Production;
    internal readonly string StateDirectory;
    internal DesktopPaths(string root)
    {
        StateDirectory = Path.Combine(root, "var");
        string file = Path.Combine(root,"config","deployment.local.json");
        if (!File.Exists(file)) return;
        var config = new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
        if (config == null || !config.ContainsKey("mode") || Convert.ToString(config["mode"]) != "production")
            throw new InvalidDataException("部署配置的 mode 必须为 production。");
        object state, data;
        if (!config.TryGetValue("stateDirectory",out state) || !config.TryGetValue("dataDir",out data)
            || String.IsNullOrWhiteSpace(Convert.ToString(state)) || String.IsNullOrWhiteSpace(Convert.ToString(data))
            || !Path.IsPathRooted(Convert.ToString(state)) || !Path.IsPathRooted(Convert.ToString(data)))
            throw new InvalidDataException("部署配置必须显式指定正式数据与窗口状态的绝对路径。");
        StateDirectory = Path.GetFullPath(Convert.ToString(state));
        if (!Directory.Exists(StateDirectory) || !Directory.Exists(Path.GetFullPath(Convert.ToString(data))))
            throw new DirectoryNotFoundException("正式数据或窗口状态目录不存在，已停止启动以避免创建空库。");
        Production = true;
    }
}
