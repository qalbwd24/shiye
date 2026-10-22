package dev.shiye.app;

import org.json.JSONException;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** Fixed shared business protocol. No caller-controlled URL, path or verb; no implicit retries. */
public final class SharedBackendTransport {
    private static final String ROOT = "/api/shared/v1/";
    private static final Set<String> ACTIONS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "conversation-list", "conversation-create", "conversation-list-state", "conversation-order",
        "conversation-create-local", "conversation-save-local", "conversation-state-local", "conversation-order-local", "entry-create-local", "entry-save-local",
        "conversation-read", "conversation-save", "service-settings-read", "service-settings-save",
        "service-request", "conversation-feed", "conversation-context", "conversation-send", "conversation-withdraw",
        "journal-send", "journal-withdraw", "journal-receipts", "message-edit-local", "message-withdraw-local", "message-describe-local",
        "entry-list", "entry-read", "entry-create", "entry-save", "entry-delete", "entry-restore",
        "taxonomy-save", "taxonomy-order", "template-create", "template-save", "comment-create", "comment-save", "preferences-save", "client-preferences-save",
        "sticker-catalog", "sticker-from-message", "sticker-collect", "sticker-update", "entry-create-ref", "entry-save-ref", "wallpaper-read", "wallpaper-save")));

    /** Pure Java seam; production exchange alone owns auth, configuration and network policy. */
    interface Exchange {
        JSONObject request(String method, String path, JSONObject body) throws BackendServices.ServiceException;
    }
    private final Exchange exchange;
    SharedBackendTransport(Exchange exchange) {
        if (exchange == null) throw new IllegalArgumentException("exchange");
        this.exchange = exchange;
    }
    public JSONObject info() throws BackendServices.ServiceException {
        return exchange.request("GET", ROOT + "info", null);
    }
    public JSONObject snapshot(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "snapshot", copy(input));
    }
    public JSONObject pull(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "pull", copy(input));
    }
    public JSONObject mediaRead(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "media/read", copy(input));
    }
    public JSONObject mediaBegin(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "media/begin", copy(input));
    }
    public JSONObject mediaChunk(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "media/chunk", copy(input));
    }
    public JSONObject mediaComplete(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "media/complete", copy(input));
    }
    public JSONObject entityRead(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "entity/read", copy(input));
    }
    public JSONObject feedItemRead(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "feed-item/read", copy(input));
    }
    public JSONObject seedResolve(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "seed-resolve", copy(input));
    }
    public JSONObject seedRegister(JSONObject input) throws BackendServices.ServiceException {
        return exchange.request("POST", ROOT + "seed-register", copy(input));
    }
    /** operationId and complete input belong to the durable caller outbox, including on ambiguous failure. */
    public JSONObject command(String libraryId, String epoch, String operationId, String action, JSONObject input) throws BackendServices.ServiceException {
        if (operationId == null || !operationId.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
            || !ACTIONS.contains(action)) throw invalid();
        try {
            return command(new JSONObject().put("libraryId", libraryId).put("epoch", epoch)
                .put("operationId", operationId).put("action", action).put("input", copy(input)));
        } catch (JSONException ignored) { throw invalid(); }
    }
    public JSONObject command(JSONObject envelope) throws BackendServices.ServiceException {
        JSONObject wire = copy(envelope);
        if (wire.length() != 5 || !identity(wire.opt("libraryId")) || !identity(wire.opt("epoch"))
            || !(wire.opt("operationId") instanceof String)
            || !wire.optString("operationId").matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
            || !(wire.opt("action") instanceof String) || !ACTIONS.contains(wire.optString("action"))
            || !(wire.opt("input") instanceof JSONObject)) throw invalid();
        return exchange.request("POST", ROOT + "command", wire);
    }
    static boolean identity(Object value) { return value instanceof String && !((String)value).isEmpty() && ((String)value).length() <= 200; }
    private static JSONObject copy(JSONObject input) throws BackendServices.ServiceException {
        if (input == null) throw invalid();
        try { return new JSONObject(input.toString()); }
        catch (JSONException ignored) { throw invalid(); }
    }
    private static BackendServices.ServiceException invalid() {
        return BackendServices.error(BackendServices.Failure.INVALID_INPUT, "共享业务操作或参数不正确");
    }
}
