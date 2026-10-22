using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;

// Only explicit diary operations cross this boundary; the web/worker network guard stays intact.
internal sealed class ChatJournalBridge : IDisposable
{
    readonly string root, address, staging;
    readonly bool enabled, verify, development;
    readonly CookieContainer cookies = new CookieContainer();
    readonly Dictionary<string, FileStream> uploads = new Dictionary<string, FileStream>();
    readonly string authFile, authScope;
    sealed class AuthGuard : IDisposable {
        readonly System.Threading.Mutex mutex;
        internal AuthGuard(string scope) {mutex=new System.Threading.Mutex(false,"Local\\ShiyeSharedAuth-"+scope);try{if(!mutex.WaitOne(10000)){mutex.Dispose();throw new InvalidOperationException("SHARED_AUTH_STORAGE_BUSY");}}catch(System.Threading.AbandonedMutexException){} }
        public void Dispose(){mutex.ReleaseMutex();mutex.Dispose();}
    }
    AuthGuard AuthLease(){return new AuthGuard(authScope);}
    sealed class DeviceAuth { internal string DeviceId="", Token="", Name="", Generation=""; }
    [StructLayout(LayoutKind.Sequential)] struct AuthBlob { internal int Length; internal IntPtr Data; }
    [DllImport("crypt32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CryptProtectData(ref AuthBlob input,string description,ref AuthBlob entropy,IntPtr reserved,IntPtr prompt,int flags,out AuthBlob output);
    [DllImport("crypt32.dll",SetLastError=true)] static extern bool CryptUnprotectData(ref AuthBlob input,IntPtr description,ref AuthBlob entropy,IntPtr reserved,IntPtr prompt,int flags,out AuthBlob output);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    const int SharedJsonLimit = 8 * 1024 * 1024, SharedSeedJsonLimit = 34 * 1024 * 1024;
    readonly object seedWireLock = new object();
    readonly Dictionary<string, SeedWire> seedWires = new Dictionary<string, SeedWire>();
    bool seedWiresDisposed;
    sealed class SeedWire {
        internal string Method, Sha256;
        internal long Length, Next;
        internal DateTime ExpiresAt;
        internal FileStream Stream;
        internal readonly System.Threading.SemaphoreSlim Gate = new System.Threading.SemaphoreSlim(1,1);
    }
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
    internal ChatJournalBridge(string project, bool verification, bool journalVerification, bool isDevelopment)
    {
        root = project; verify = verification; development = isDevelopment; enabled = !verification || journalVerification;
        address = verification ? "http://127.0.0.1:18767" : development ? "http://127.0.0.1:18766" : "http://127.0.0.1:" + Convert.ToInt32(json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root,"config","app.json")))["port"]);
        staging = Path.Combine(root, "tmp", "chat-journal-bridge", verification ? "verification" : "normal");
        authScope=SeedWireHash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar).ToUpperInvariant()+"\0"+address));
        authFile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Shiye","shared-native-auth",authScope+".bin");
    }
    internal async Task<object> Handle(Dictionary<string, object> command)
    {
        if (!enabled) throw new InvalidOperationException("普通界面验收不连接正式库；归篇验收仅连接隔离库 18767");
        string action = Convert.ToString(command["action"]);
        if(action=="shared-auth-status"||action=="shared-forget-device"||action=="shared-pair"||action=="shared-unlock")return await AuthCommand(action,command.ContainsKey("payload")?(Dictionary<string,object>)command["payload"]:new Dictionary<string,object>());
        if (action == "shared-seed-wire-begin" || action == "shared-seed-wire-chunk" || action == "shared-seed-wire-finish" || action == "shared-seed-wire-cancel") return await SeedWireCommand(action, (Dictionary<string, object>)command["payload"]);
        if (action == "sticker-media") {
            var input = (Dictionary<string, object>)command["payload"];
            string mediaId = Convert.ToString(input["mediaId"]);
            if (!System.Text.RegularExpressions.Regex.IsMatch(mediaId, "^[a-f0-9-]{1,100}$")) throw new InvalidOperationException("无效的表情包资源编号");
            long offset = Convert.ToInt64(input["offset"]);
            if (offset < 0) throw new InvalidOperationException("无效的资源偏移");
            var request = (HttpWebRequest)WebRequest.Create(address + "/media/" + mediaId);
            request.Proxy = null; request.AllowAutoRedirect = false; request.CookieContainer = cookies;
            request.Timeout = 30000; request.ReadWriteTimeout = 30000;
            request.Headers["X-Diary-Client"] = "desktop";
            request.AddRange(offset, checked(offset + 262143));
            using (var response = (HttpWebResponse)await request.GetResponseAsync()) {
                if (!System.Text.RegularExpressions.Regex.IsMatch(response.ContentType, "^image/(png|jpeg|webp|gif|avif)(;|$)")) throw new InvalidOperationException("资源不是支持的图片");
                if (offset > 0 && response.StatusCode != HttpStatusCode.PartialContent) throw new InvalidOperationException("资源不支持分块读取");
                using (var stream = response.GetResponseStream()) using (var memory = new MemoryStream()) {
                    var buffer = new byte[65536]; int count;
                    while ((count = await stream.ReadAsync(buffer, 0, buffer.Length)) > 0) {
                        if (memory.Length + count > 262144) throw new InvalidOperationException("资源分块超出限制");
                        memory.Write(buffer, 0, count);
                    }
                    return new { bytes = Convert.ToBase64String(memory.ToArray()), offset = offset, mime = response.ContentType.Split(';')[0] };
                }
            }
        }
        if (action == "upload-start") {
            Directory.CreateDirectory(staging);
            var token = Guid.NewGuid().ToString();
            uploads.Add(token, new FileStream(Path.Combine(staging, token + ".uploading"), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 65536, FileOptions.Asynchronous | FileOptions.DeleteOnClose));
            return new { token = token };
        }
        if (action == "upload-chunk" || action == "upload-finish" || action == "upload-cancel") {
            string token = Convert.ToString(command["token"]);
            FileStream file;
            if (!uploads.TryGetValue(token, out file)) throw new InvalidOperationException("附件上传已失效，请重试");
            if (action == "upload-cancel") { file.Dispose(); uploads.Remove(token); return new { cancelled = true }; }
            if (action == "upload-chunk") {
                if (Convert.ToInt64(command["offset"]) != file.Length) throw new InvalidOperationException("附件分块顺序不匹配");
                var bytes = Convert.FromBase64String(Convert.ToString(command["bytes"]));
                if (bytes.Length > 262144 || file.Length + bytes.Length > 16L * 1024 * 1024 * 1024) throw new InvalidOperationException("附件分块或总大小超出限制");
                await file.WriteAsync(bytes, 0, bytes.Length);
                return new { received = file.Length };
            }
            try {
                file.Position = 0;
                return await Request("POST", "/api/chat-journal/media", file, Convert.ToString(command["mime"]), Convert.ToString(command["name"]));
            } finally { file.Dispose(); uploads.Remove(token); }
        }
        string method, path;
        switch (action) {
            case "shared-info": method = "GET"; path = "/api/shared/v1/info"; break;
            case "shared-snapshot": method = "POST"; path = "/api/shared/v1/snapshot"; break;
            case "shared-pull": method = "POST"; path = "/api/shared/v1/pull"; break;
            case "shared-command": method = "POST"; path = "/api/shared/v1/command"; break;
            case "shared-entity-read": method = "POST"; path = "/api/shared/v1/entity/read"; break;
            case "shared-feed-item-read": method = "POST"; path = "/api/shared/v1/feed-item/read"; break;
            case "shared-media-read": method = "POST"; path = "/api/shared/v1/media/read"; break;
            case "shared-media-begin": method = "POST"; path = "/api/shared/v1/media/begin"; break;
            case "shared-media-chunk": method = "POST"; path = "/api/shared/v1/media/chunk"; break;
            case "shared-media-complete": method = "POST"; path = "/api/shared/v1/media/complete"; break;
            case "shared-seed-resolve": method = "POST"; path = "/api/shared/v1/seed-resolve"; break;
            case "shared-seed-register": method = "POST"; path = "/api/shared/v1/seed-register"; break;
            case "service-health": method = "GET"; path = "/api/health"; break;
            case "service-settings-read": method = "POST"; path = "/api/conversation-services/settings/read"; break;
            case "service-settings-save": method = "POST"; path = "/api/conversation-services/settings/save"; break;
            case "conversation-state": method = "POST"; path = "/api/conversation-services/conversations/state"; break;
            case "conversation-update": method = "PUT"; path = "/api/conversation-services/conversations/state"; break;
            case "conversation-feed": method = "POST"; path = "/api/conversation-services/conversations/feed"; break;
            case "conversation-context": method = "POST"; path = "/api/conversation-services/conversations/context"; break;
            case "conversation-send": method = "POST"; path = "/api/conversation-services/conversations/send"; break;
            case "conversation-withdraw": method = "POST"; path = "/api/conversation-services/conversations/withdraw"; break;
            case "service-catalog": method = "GET"; path = "/api/conversation-services"; break;
            case "service-create": method = "POST"; path = "/api/conversation-services/instances"; break;
            case "service-bind": method = "PUT"; path = "/api/conversation-services/bindings"; break;
            case "service-request": method = "POST"; path = "/api/conversation-services/request"; break;
            case "sticker-catalog": method = "GET"; path = "/api/stickers/catalog"; break;
            case "sticker-collect": method = "POST"; path = "/api/stickers"; break;
            case "sticker-from-message": method = "POST"; path = "/api/stickers/from-message"; break;
            case "sticker-update":
                var stickerInput = (Dictionary<string, object>)command["payload"];
                string stickerId = Convert.ToString(stickerInput["id"]);
                if (!System.Text.RegularExpressions.Regex.IsMatch(stickerId, "^[a-f0-9-]{1,100}$")) throw new InvalidOperationException("无效的收藏编号");
                method = "PUT"; path = "/api/stickers/" + stickerId; break;
            case "status": method = "GET"; path = "/api/chat-journal"; break;
            case "unlock": method = "POST"; path = "/api/unlock"; break;
            case "room": method = "PUT"; path = "/api/chat-journal/rooms"; break;
            case "messages": method = "POST"; path = "/api/chat-journal/messages"; break;
            case "withdraw": method = "POST"; path = "/api/chat-journal/withdraw"; break;
            case "receipts": method = "POST"; path = "/api/chat-journal/receipts"; break;
            case "datetime-settings": method = "GET"; path = "/api/chat-journal/datetime-settings"; break;
            case "manual-cut": method = "POST"; path = "/api/chat-journal/manual-cut"; break;
            case "close-idle": method = "POST"; path = "/api/chat-journal/close-idle"; break;
            case "revisit-status": method = "GET"; path = "/api/revisit"; break;
            case "revisit-config": method = "PUT"; path = "/api/revisit/config"; break;
            case "revisit-tick": method = "POST"; path = "/api/revisit/tick"; break;
            case "revisit-feed": method = "POST"; path = "/api/revisit/feed"; break;
            case "revisit-source": method = "POST"; path = "/api/revisit/source"; break;
            case "revisit-media": method = "POST"; path = "/api/revisit/media"; break;
            case "revisit-context": method = "POST"; path = "/api/revisit/comments/context"; break;
            case "revisit-comment": method = "POST"; path = "/api/revisit/comments"; break;
            case "revisit-withdraw": method = "POST"; path = "/api/revisit/comments/withdraw"; break;
            case "revisit-runner-status": method = "GET"; path = "/api/revisit/runner"; break;
            case "revisit-runner-start": method = "POST"; path = "/api/revisit/runner/start"; break;
            case "revisit-runner-stop": method = "POST"; path = "/api/revisit/runner/stop"; break;
            default: throw new InvalidOperationException("不支持的本地日记操作");
        }
        if (action == "status" && !verify && !development) {
            try { return await Request(method, path, null, null, null); }
            catch (WebException ex) {
                if (ex.Status != WebExceptionStatus.ConnectFailure) throw;
            }
            var launcher = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Path.Combine(root, "拾页日记.exe"), "--check") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root, WindowStyle = System.Diagnostics.ProcessWindowStyle.Hidden });
            launcher.Dispose();
            for (int i = 0; i < 30; i++) { await Task.Delay(300); try { return await Request(method,path,null,null,null); } catch (WebException retry) { if (retry.Status != WebExceptionStatus.ConnectFailure) throw; } }
            throw new InvalidOperationException("拾页本地服务尚未启动，请稍后重试");
        }
        // Only the two complete-roster ports have the larger bounded serializer.
        // The host/renderer serializer and all legacy operations stay unchanged.
        bool shared = action.StartsWith("shared-", StringComparison.Ordinal);
        bool seed = action == "shared-seed-resolve" || action == "shared-seed-register";
        int sharedLimit = seed ? SharedSeedJsonLimit : SharedJsonLimit;
        var wireJson = seed ? new JavaScriptSerializer { MaxJsonLength = SharedSeedJsonLimit } : json;
        byte[] payload = method == "GET" ? null : Encoding.UTF8.GetBytes(wireJson.Serialize(command.ContainsKey("payload") ? command["payload"] : new object()));
        if (shared && payload != null && payload.Length > sharedLimit) throw new InvalidOperationException("SHARED_REQUEST_TOO_LARGE");
        using (var stream = payload == null ? null : new MemoryStream(payload)) return await Request(method, path, stream, "application/json", null, shared ? wireJson : null, shared ? sharedLimit : 0);
    }
    static long SeedWireInteger(Dictionary<string,object> q,string key,long min,long max) {
        object value;if(!q.TryGetValue(key,out value)||!(value is int||value is long||value is decimal||value is double))throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");
        double n=Convert.ToDouble(value);long number=Convert.ToInt64(value);if(Double.IsNaN(n)||Double.IsInfinity(n)||n!=number||number<min||number>max)throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");return number;
    }
    static string SeedWireHash(byte[] bytes) { using(var hash=System.Security.Cryptography.SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(); }
    byte[] ProtectAuth(byte[] bytes,bool protect) {
        byte[] scope=Encoding.UTF8.GetBytes(authScope);AuthBlob input=new AuthBlob{Length=bytes.Length,Data=Marshal.AllocHGlobal(bytes.Length)},entropy=new AuthBlob{Length=scope.Length,Data=Marshal.AllocHGlobal(scope.Length)},output=new AuthBlob();
        try {Marshal.Copy(bytes,0,input.Data,bytes.Length);Marshal.Copy(scope,0,entropy.Data,scope.Length);
            bool ok=protect?CryptProtectData(ref input,"Shiye shared native credential",ref entropy,IntPtr.Zero,IntPtr.Zero,1,out output):CryptUnprotectData(ref input,IntPtr.Zero,ref entropy,IntPtr.Zero,IntPtr.Zero,1,out output);
            if(!ok||output.Length<1||output.Length>16384)throw new InvalidOperationException("SHARED_AUTH_STORAGE_FAILED");
            byte[] result=new byte[output.Length];Marshal.Copy(output.Data,result,0,result.Length);return result;
        } finally {for(int i=0;i<input.Length;i++)Marshal.WriteByte(input.Data,i,0);Marshal.FreeHGlobal(input.Data);Marshal.FreeHGlobal(entropy.Data);if(output.Data!=IntPtr.Zero)LocalFree(output.Data);}
    }
    DeviceAuth ReadAuth() {
        if(!File.Exists(authFile))return new DeviceAuth();
        if(new FileInfo(authFile).Length>16384)throw new InvalidOperationException("SHARED_AUTH_STORAGE_FAILED");
        byte[] plain=ProtectAuth(File.ReadAllBytes(authFile),false);
        try {var value=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(plain));
            var state=new DeviceAuth{DeviceId=Convert.ToString(value["deviceId"]),Token=Convert.ToString(value["token"]),Name=Convert.ToString(value["deviceName"]),Generation=Convert.ToString(value["generation"])};
            Guid generation;if(!Guid.TryParse(state.Generation,out generation)||(state.Token!=""&&(!System.Text.RegularExpressions.Regex.IsMatch(state.Token,"^[a-f0-9]{64}$")||!Guid.TryParse(state.DeviceId,out generation)))||state.Name.Length>80)throw new InvalidOperationException("SHARED_AUTH_STORAGE_FAILED");return state;
        } finally {Array.Clear(plain,0,plain.Length);}
    }
    void WriteAuth(DeviceAuth state) {
        byte[] plain=Encoding.UTF8.GetBytes(json.Serialize(new {deviceId=state.DeviceId,token=state.Token,deviceName=state.Name,generation=state.Generation}));
        string temp=authFile+"."+Guid.NewGuid().ToString()+".tmp";
        try {byte[] encrypted=ProtectAuth(plain,true);Directory.CreateDirectory(Path.GetDirectoryName(authFile));using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(encrypted,0,encrypted.Length);stream.Flush(true);}if(File.Exists(authFile))File.Replace(temp,authFile,null);else File.Move(temp,authFile);}
        finally {Array.Clear(plain,0,plain.Length);if(File.Exists(temp))File.Delete(temp);}
    }
    object AuthStatus(DeviceAuth state) {return state.Token==""?(object)new {paired=false}:new {paired=true,deviceId=state.DeviceId,deviceName=state.Name};}
    async Task<object> AuthCommand(string action,Dictionary<string,object> q) {
        if(q==null)throw new InvalidOperationException("SHARED_AUTH_INVALID_INPUT");
        if(action=="shared-auth-status"||action=="shared-forget-device"){
            if(q.Count!=0)throw new InvalidOperationException("SHARED_AUTH_INVALID_INPUT");
            using(AuthLease()){if(action=="shared-forget-device")WriteAuth(new DeviceAuth{Generation=Guid.NewGuid().ToString()});return AuthStatus(ReadAuth());}
        }
        foreach(var key in q.Keys)if(action=="shared-unlock"?key!="password":key!="code"&&key!="deviceName")throw new InvalidOperationException("SHARED_AUTH_INVALID_INPUT");
        if(action=="shared-unlock"){
            if(!q.ContainsKey("password")||!(q["password"] is string)||((string)q["password"]).Length>200)throw new InvalidOperationException("SHARED_AUTH_INVALID_INPUT");
            using(var stream=new MemoryStream(Encoding.UTF8.GetBytes(json.Serialize(q))))return await Request("POST","/api/unlock",stream,"application/json",null,json,SharedJsonLimit);
        }
        if(!q.ContainsKey("code")||!(q["code"] is string)||!System.Text.RegularExpressions.Regex.IsMatch((string)q["code"],"^[0-9]{8}$")||!q.ContainsKey("deviceName")||!(q["deviceName"] is string)||String.IsNullOrWhiteSpace((string)q["deviceName"])||((string)q["deviceName"]).Length>80)throw new InvalidOperationException("SHARED_AUTH_INVALID_INPUT");
        string generation;using(AuthLease())generation=ReadAuth().Generation;
        Dictionary<string,object> response;using(var stream=new MemoryStream(Encoding.UTF8.GetBytes(json.Serialize(q))))response=(Dictionary<string,object>)await Request("POST","/api/shared/v1/auth/pair",stream,"application/json",null,json,SharedJsonLimit);
        if(Convert.ToInt32(response["status"])!=201){var problem=response["data"] as Dictionary<string,object>;object error;var detail=problem!=null&&problem.TryGetValue("error",out error)?error as Dictionary<string,object>:null;string code=detail!=null&&detail.ContainsKey("code")?Convert.ToString(detail["code"]):"SHARED_PAIR_FAILED";if(!System.Text.RegularExpressions.Regex.IsMatch(code,"^[A-Z_]{1,80}$"))code="SHARED_PAIR_FAILED";return new {status=response["status"],data=new {error=new {code=code}}};}
        var data=response["data"] as Dictionary<string,object>;Guid device;
        if(data==null||!data.ContainsKey("deviceId")||!Guid.TryParse(Convert.ToString(data["deviceId"]),out device)||!data.ContainsKey("token")||!System.Text.RegularExpressions.Regex.IsMatch(Convert.ToString(data["token"]),"^[a-f0-9]{64}$")||!data.ContainsKey("deviceName")||!(data["deviceName"] is string)||((string)data["deviceName"]).Length>80)throw new InvalidOperationException("SHARED_AUTH_INVALID_RESPONSE");
        using(AuthLease()){if(ReadAuth().Generation!=generation)throw new InvalidOperationException("SHARED_AUTH_CHANGED");var state=new DeviceAuth{DeviceId=device.ToString(),Token=(string)data["token"],Name=(string)data["deviceName"],Generation=Guid.NewGuid().ToString()};WriteAuth(state);return AuthStatus(state);}
    }
    object SharedResponse(int status,object data,DeviceAuth sent) {
        if(status==401&&sent!=null&&sent.Token!=""){
            var value=data as Dictionary<string,object>;object error;var detail=value!=null&&value.TryGetValue("error",out error)?error as Dictionary<string,object>:null;
            if(detail!=null&&detail.ContainsKey("code")&&Convert.ToString(detail["code"])=="DEVICE_UNAUTHORIZED")using(AuthLease()){if(ReadAuth().Generation==sent.Generation)WriteAuth(new DeviceAuth{Generation=Guid.NewGuid().ToString()});}
        }
        return new Dictionary<string,object>{{"status",status},{"data",data}};
    }
    void PurgeSeedWires() {
        var expired=new List<string>();foreach(var item in seedWires)if(item.Value.ExpiresAt<=DateTime.UtcNow)expired.Add(item.Key);
        foreach(string token in expired){seedWires[token].Stream.Dispose();seedWires.Remove(token);}
    }
    async Task<object> SeedWireCommand(string action,Dictionary<string,object> q) {
        if(q==null)throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");
        if(action=="shared-seed-wire-begin") {
            foreach(string key in q.Keys)if(key!="method"&&key!="byteLength"&&key!="sha256")throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");
            string method=q.ContainsKey("method")?Convert.ToString(q["method"]):"",sha=q.ContainsKey("sha256")?Convert.ToString(q["sha256"]):"";
            long length=SeedWireInteger(q,"byteLength",2,SharedSeedJsonLimit);
            if((method!="seed-register"&&method!="seed-resolve")||!System.Text.RegularExpressions.Regex.IsMatch(sha,"^[a-f0-9]{64}$"))throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");
            lock(seedWireLock) {
                if(seedWiresDisposed)throw new ObjectDisposedException("shared-seed-wire");PurgeSeedWires();if(seedWires.Count>=2)throw new InvalidOperationException("SHARED_SEED_WIRE_LIMIT");
                Directory.CreateDirectory(staging);string token=Guid.NewGuid().ToString();
                seedWires.Add(token,new SeedWire {Method=method,Sha256=sha,Length=length,Next=0,ExpiresAt=DateTime.UtcNow.AddMinutes(10),Stream=new FileStream(Path.Combine(staging,token+".seed-wire"),FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None,65536,FileOptions.Asynchronous|FileOptions.DeleteOnClose)});
                return new {token=token,maxChunkBytes=262144,expiresInMs=600000};
            }
        }
        string selected=q.ContainsKey("token")?Convert.ToString(q["token"]):"";SeedWire wire;
        if(!System.Text.RegularExpressions.Regex.IsMatch(selected,"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$"))throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");
        lock(seedWireLock){PurgeSeedWires();if(seedWiresDisposed||!seedWires.TryGetValue(selected,out wire))throw new InvalidOperationException("SHARED_SEED_WIRE_NOT_FOUND");}
        await wire.Gate.WaitAsync();
        try {
            lock(seedWireLock){SeedWire current;if(!seedWires.TryGetValue(selected,out current)||!Object.ReferenceEquals(wire,current)||wire.ExpiresAt<=DateTime.UtcNow)throw new InvalidOperationException("SHARED_SEED_WIRE_NOT_FOUND");}
            if(action=="shared-seed-wire-cancel"){lock(seedWireLock)seedWires.Remove(selected);wire.Stream.Dispose();return new {cancelled=true};}
            if(action=="shared-seed-wire-chunk") {
                foreach(string key in q.Keys)if(key!="token"&&key!="offset"&&key!="bytesBase64"&&key!="chunkSha256")throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");
                long offset=SeedWireInteger(q,"offset",0,wire.Length);string encoded=q.ContainsKey("bytesBase64")?Convert.ToString(q["bytesBase64"]):"",sha=q.ContainsKey("chunkSha256")?Convert.ToString(q["chunkSha256"]):"";
                if(encoded.Length>349528||!System.Text.RegularExpressions.Regex.IsMatch(encoded,"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");
                byte[] bytes=Convert.FromBase64String(encoded);if(bytes.Length<1||bytes.Length>262144||offset!=wire.Next||bytes.Length>wire.Length-wire.Next||SeedWireHash(bytes)!=sha)throw new InvalidOperationException("SHARED_SEED_WIRE_INVALID");
                wire.Stream.Position=offset;await wire.Stream.WriteAsync(bytes,0,bytes.Length);await wire.Stream.FlushAsync();wire.Next+=bytes.Length;
                return new {next=wire.Next};
            }
            if(q.Count!=1||wire.Next!=wire.Length)throw new InvalidOperationException("SHARED_SEED_WIRE_TRUNCATED");
            wire.Stream.Position=0;
            string digest=await Task.Run(()=>{using(var hash=System.Security.Cryptography.SHA256.Create())return BitConverter.ToString(hash.ComputeHash(wire.Stream)).Replace("-","").ToLowerInvariant();});
            if(digest!=wire.Sha256)throw new InvalidOperationException("SHARED_SEED_WIRE_HASH_MISMATCH");
            wire.Stream.Position=0;
            try { return await Request("POST","/api/shared/v1/"+wire.Method,wire.Stream,"application/json",null,new JavaScriptSerializer {MaxJsonLength=SharedSeedJsonLimit},SharedSeedJsonLimit); }
            finally { lock(seedWireLock)seedWires.Remove(selected);wire.Stream.Dispose(); }
        } finally {wire.Gate.Release();}
    }
    async Task<object> Request(string method, string path, Stream payload, string mime, string name, JavaScriptSerializer responseJson = null, int responseLimit = 0)
    {
        var request = (HttpWebRequest)WebRequest.Create(address + path);
        request.Proxy = null;
        request.AllowAutoRedirect = false;
        request.CookieContainer = cookies;
        request.Method = method;
        request.Headers["X-Diary-Client"] = "desktop";
        DeviceAuth sent=null;
        if(path.StartsWith("/api/shared/v1/",StringComparison.Ordinal)&&path!="/api/shared/v1/auth/pair"){
            using(AuthLease())sent=ReadAuth();if(sent.Token!=""){request.Headers["Authorization"]="Bearer "+sent.Token;request.Headers["X-Sync-Device-Id"]=sent.DeviceId;}
        }
        request.Timeout = 30000;
        request.ReadWriteTimeout = 30000;
        if (payload != null) {
            request.ContentType = mime;
            if (name != null) request.Headers["X-File-Name"] = Uri.EscapeDataString(name);
            request.ContentLength = payload.Length;
            request.AllowWriteStreamBuffering = false;
            using (var outgoing = await request.GetRequestStreamAsync()) await payload.CopyToAsync(outgoing);
        }
        HttpWebResponse response;
        try {
            var responseTask = request.GetResponseAsync();
            if (await Task.WhenAny(responseTask, Task.Delay(30000)) != responseTask) { request.Abort(); throw new TimeoutException("本地日记响应超时"); }
            response = (HttpWebResponse)await responseTask;
        }
        catch (WebException e) { if (e.Response == null) throw; response = (HttpWebResponse)e.Response; }
        using (response) {
            if (responseLimit > 0) {
                if (response.ContentLength > responseLimit) throw new InvalidOperationException("SHARED_RESPONSE_TOO_LARGE");
                using (var incoming = response.GetResponseStream()) using (var memory = new MemoryStream()) {
                    var block = new byte[65536]; int count;
                    while ((count = await incoming.ReadAsync(block, 0, block.Length)) > 0) {
                        if (memory.Length + count > responseLimit) throw new InvalidOperationException("SHARED_RESPONSE_TOO_LARGE");
                        memory.Write(block, 0, count);
                    }
                    return SharedResponse((int)response.StatusCode,responseJson.DeserializeObject(Encoding.UTF8.GetString(memory.ToArray())),sent);
                }
            }
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) return SharedResponse((int)response.StatusCode,json.DeserializeObject(await reader.ReadToEndAsync()),sent);
        }
    }
    public void Dispose() { foreach (var file in uploads.Values) file.Dispose(); uploads.Clear();lock(seedWireLock){seedWiresDisposed=true;foreach(var wire in seedWires.Values)wire.Stream.Dispose();seedWires.Clear();} }
}
