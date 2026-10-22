package dev.shiye.app;

import org.json.*;
import java.util.UUID;

/** Compile/run actual transport; Exchange is the sole substituted network port. No device/UI. */
public final class SharedLocalMessageHostProbe {
    static int count;
    static JSONObject expected;
    static void check(boolean value) { if (!value) throw new AssertionError("fixed command contract"); }
    public static void main(String[] args) throws Exception {
        SharedBackendTransport transport = new SharedBackendTransport((method, path, body) -> {
            check(method.equals("POST") && path.equals("/api/shared/v1/command"));
            check(body.similar(expected));
            check(body != expected && body.getJSONObject("input") != expected.getJSONObject("input"));
            count++;
            return new JSONObject().put("unchanged", body).put("future", new JSONArray().put("opaque"));
        });
        String[] actions = {"entry-create-local", "entry-save-local", "conversation-create-local",
            "conversation-save-local", "conversation-state-local", "conversation-order-local",
            "message-edit-local", "message-withdraw-local", "message-describe-local"};
        for (String action : actions) {
            String operation = UUID.randomUUID().toString();
            JSONObject input = new JSONObject().put("operationId", operation).put("text", "合成").put("stamp",
                new JSONObject().put("deviceId", UUID.randomUUID().toString()).put("operationId", operation)
                    .put("physicalMs", 1792447000000L).put("logical", 17));
            expected = new JSONObject().put("libraryId", UUID.randomUUID().toString()).put("epoch", UUID.randomUUID().toString())
                .put("operationId", operation).put("action", action).put("input", input);
            JSONObject result = transport.command(expected);
            check(result.getJSONObject("unchanged").similar(expected) && result.getJSONArray("future").length() == 1);
        }
        check(count == actions.length);
        for (String unknown : new String[]{"conversation-list-state-local", "message-edit-local-arbitrary", "/api/access"}) {
            JSONObject invalid = new JSONObject(expected.toString()).put("action", unknown);
            boolean rejected = false;
            try { transport.command(invalid); } catch (BackendServices.ServiceException e) { rejected = e.kind == BackendServices.Failure.INVALID_INPUT; }
            check(rejected && count == actions.length);
        }
        System.out.println(new JSONObject().put("ok", true).put("approvedActions", actions.length).put("exchanges", count)
            .put("unknownRejectedBeforeExchange", 3).put("wirePreserved", true).toString());
    }
}
