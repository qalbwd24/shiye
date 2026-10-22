package dev.shiye.app;

import org.json.JSONObject;

/** Fixed WebView/native adapter. Never accepts a URL/path or serializes native credentials. */
final class SharedBackendBridge {
    interface Port {
        JSONObject info() throws Exception;
        JSONObject snapshot(JSONObject input) throws Exception;
        JSONObject pull(JSONObject input) throws Exception;
        JSONObject command(JSONObject input) throws Exception;
        JSONObject unlock(String password) throws Exception;
        JSONObject pair(String code, String deviceName) throws Exception;
        JSONObject authStatus() throws Exception;
        JSONObject forgetDevice() throws Exception;
        JSONObject mediaRead(JSONObject input) throws Exception;
        JSONObject mediaBegin(JSONObject input) throws Exception;
        JSONObject mediaChunk(JSONObject input) throws Exception;
        JSONObject mediaComplete(JSONObject input) throws Exception;
        JSONObject entityRead(JSONObject input) throws Exception;
        default JSONObject feedItemRead(JSONObject input) throws Exception { throw BackendServices.error(BackendServices.Failure.INVALID_INPUT,"共享收件分块不可用"); }
        default JSONObject seedResolve(JSONObject input) throws Exception { throw BackendServices.error(BackendServices.Failure.INVALID_INPUT,"共享整包核验不可用"); }
        default JSONObject seedRegister(JSONObject input) throws Exception { throw BackendServices.error(BackendServices.Failure.INVALID_INPUT,"共享整包登记不可用"); }
    }
    private final Port port;
    SharedBackendBridge(final BackendServices services) {
        this(new Port() {
            public JSONObject info() throws Exception { return services.sharedInfo(); }
            public JSONObject snapshot(JSONObject input) throws Exception { return services.sharedSnapshot(input); }
            public JSONObject pull(JSONObject input) throws Exception { return services.sharedPull(input); }
            public JSONObject command(JSONObject input) throws Exception { return services.sharedCommand(input); }
            public JSONObject unlock(String password) throws Exception { return services.sharedUnlock(password); }
            public JSONObject pair(String code, String deviceName) throws Exception { return services.sharedPair(code,deviceName); }
            public JSONObject authStatus() throws Exception { return services.sharedAuthStatus(); }
            public JSONObject forgetDevice() throws Exception { return services.sharedForgetDevice(); }
            public JSONObject mediaRead(JSONObject input) throws Exception { return services.sharedMediaRead(input); }
            public JSONObject mediaBegin(JSONObject input) throws Exception { return services.sharedMediaBegin(input); }
            public JSONObject mediaChunk(JSONObject input) throws Exception { return services.sharedMediaChunk(input); }
            public JSONObject mediaComplete(JSONObject input) throws Exception { return services.sharedMediaComplete(input); }
            public JSONObject entityRead(JSONObject input) throws Exception { return services.sharedEntityRead(input); }
            public JSONObject feedItemRead(JSONObject input) throws Exception { return services.sharedFeedItemRead(input); }
            public JSONObject seedResolve(JSONObject input) throws Exception { return services.sharedSeedResolve(input); }
            public JSONObject seedRegister(JSONObject input) throws Exception { return services.sharedSeedRegister(input); }
        });
    }
    SharedBackendBridge(Port port) { this.port = port; }
    static boolean supports(String action) {
        return "sharedInfo".equals(action) || "sharedSnapshot".equals(action) || "sharedPull".equals(action)
            || "sharedCommand".equals(action) || "sharedUnlock".equals(action) || "sharedPair".equals(action)
            || "sharedAuthStatus".equals(action) || "sharedForgetDevice".equals(action)
            || "sharedMediaRead".equals(action) || "sharedMediaBegin".equals(action)
            || "sharedMediaChunk".equals(action) || "sharedMediaComplete".equals(action) || "sharedEntityRead".equals(action)
            || "sharedFeedItemRead".equals(action) || "sharedSeedResolve".equals(action) || "sharedSeedRegister".equals(action);
    }
    JSONObject handle(String action, JSONObject input) throws Exception {
        JSONObject q = input == null ? new JSONObject() : new JSONObject(input.toString());
        switch (action) {
            case "sharedInfo": return port.info();
            case "sharedSnapshot": return port.snapshot(q);
            case "sharedPull": return port.pull(q);
            case "sharedCommand": return port.command(q);
            case "sharedUnlock": return port.unlock(text(q,"password"));
            case "sharedPair": return port.pair(text(q,"code"),text(q,"deviceName"));
            case "sharedAuthStatus": return port.authStatus();
            case "sharedForgetDevice": return port.forgetDevice();
            case "sharedMediaRead": return port.mediaRead(q);
            case "sharedMediaBegin": return port.mediaBegin(q);
            case "sharedMediaChunk": return port.mediaChunk(q);
            case "sharedMediaComplete": return port.mediaComplete(q);
            case "sharedEntityRead": return port.entityRead(q);
            case "sharedFeedItemRead": return port.feedItemRead(q);
            case "sharedSeedResolve": return port.seedResolve(q);
            case "sharedSeedRegister": return port.seedRegister(q);
            default: throw BackendServices.error(BackendServices.Failure.INVALID_INPUT,"共享业务操作不正确");
        }
    }
    private static String text(JSONObject q,String key) throws Exception {
        Object value=q.opt(key);
        if (!(value instanceof String)) throw BackendServices.error(BackendServices.Failure.INVALID_INPUT,"共享业务参数不正确");
        return (String)value;
    }
}
