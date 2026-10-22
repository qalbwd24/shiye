using System;
using System.Collections.Generic;
using System.Text;
using System.Web.Script.Serialization;
// Console-only synthetic host; never constructs a form, WebView or product entry.
internal static class SharedPcBridgeProbe {
    static int Main(string[] args) {
        Console.InputEncoding=Encoding.UTF8;Console.OutputEncoding=new UTF8Encoding(false);
        // Harness transport only, so it can test the native port's own limits.
        // Production renderer/host caps are not changed by this console helper.
        var json=new JavaScriptSerializer { MaxJsonLength=36*1024*1024 };
        using(var bridge=new ChatJournalBridge(args[0],false,false,false)) {
            string line;
            while((line=Console.ReadLine())!=null) {
                try { var command=json.Deserialize<Dictionary<string,object>>(line);var result=bridge.Handle(command).GetAwaiter().GetResult();Console.WriteLine(json.Serialize(new {ok=true,result=result})); }
                catch(Exception error) { Console.WriteLine(json.Serialize(new {ok=false,type=error.GetType().Name})); }
            }
        }
        return 0;
    }
}
