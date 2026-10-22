package dev.shiye.syncprobe.p20261018;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;

/** A temporary network-only test package, with no Activity or access to diary app storage. */
public final class ProbeReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    final PendingResult pending = goAsync();
    new Thread(() -> {
      JSONObject report = new JSONObject();
      try {
        File directory = context.getFilesDir();
        JSONObject config = new JSONObject(new String(Files.readAllBytes(new File(directory, "request.json").toPath()), StandardCharsets.UTF_8));
        String idPrefix = config.optString("idPrefix", "");
        String messageText = config.optString("messageText", "手机应用经局域网发送的合成消息");
        report.put("requestId", config.optString("requestId"));
        String base = config.getString("baseUrl");
        JSONObject credentials;
        if (config.optString("phase", "initial").equals("initial")) {
          JSONObject health = request(base, "health", null, null);
          report.put("health", health.optString("service").equals("shiye-sync"));
          credentials = request(base, "pair", new JSONObject().put("code", config.getString("code")).put("deviceName", "手机临时通信测试"), null);
          Files.write(new File(directory, "credentials.json").toPath(), credentials.toString().getBytes(StandardCharsets.UTF_8));
          String token = credentials.getString("token");
          JSONObject snapshot = request(base, "snapshot", new JSONObject().put("limit", 100), token);
          report.put("desktopMessageReceived", contains(snapshot.getJSONArray("entities"), idPrefix + "device-test-pc"));
          JSONObject body = new JSONObject().put("format", "shiye-richdoc").put("version", 1).put("content", new JSONArray().put(new JSONObject().put("type", "paragraph").put("attrs", new JSONObject().put("blockId", "phone-paragraph")).put("content", new JSONArray().put(new JSONObject().put("type", "text").put("text", messageText)))));
          JSONObject operation = new JSONObject().put("operationId", idPrefix + "physical-phone-create").put("entityType", "chatMessage").put("entityId", idPrefix + "device-test-phone").put("baseRevision", 0).put("command", "create").put("data", new JSONObject().put("title", "手机测试消息").put("body", body).put("eventTime", Instant.now().toString()).put("categoryId", idPrefix + "test-category"));
          JSONObject pushed = request(base, "push", new JSONObject().put("operations", new JSONArray().put(operation)), token);
          report.put("phoneMessageAccepted", pushed.getJSONArray("results").getJSONObject(0).optString("status").equals("accepted"));
          report.put("deviceId", credentials.getString("deviceId"));
        } else {
          credentials = new JSONObject(new String(Files.readAllBytes(new File(directory, "credentials.json").toPath()), StandardCharsets.UTF_8));
          JSONObject page = request(base, "pull", new JSONObject().put("cursor", config.getString("cursor")).put("limit", 100), credentials.getString("token"));
          JSONArray changes = page.getJSONArray("changes");
          boolean found = false;
          for (int index = 0; index < changes.length(); index++) {
            JSONObject entity = changes.getJSONObject(index).getJSONObject("entity");
            if (entity.optString("entityId").equals(idPrefix + "device-test-room") && entity.getJSONObject("data").optString("categoryId").equals(idPrefix + "phone-verification-category")) found = true;
          }
          report.put("metadataChangeReceived", found);
          report.put("incrementalChanges", changes.length());
        }
        report.put("ok", true);
      } catch (Exception error) {
        try { report.put("ok", false).put("error", error.getClass().getSimpleName() + ": " + error.getMessage()); } catch (Exception ignored) { }
      }
      try { Files.write(new File(context.getFilesDir(), "report.json").toPath(), report.toString().getBytes(StandardCharsets.UTF_8)); } catch (Exception ignored) { }
      pending.finish();
    }, "sync-network-probe").start();
  }
  private static boolean contains(JSONArray records, String id) throws Exception {
    for (int i = 0; i < records.length(); i++) if (records.getJSONObject(i).optString("entityId").equals(id)) return true;
    return false;
  }
  private static JSONObject request(String base, String route, JSONObject body, String token) throws Exception {
    HttpURLConnection connection = (HttpURLConnection)new URL(base + "api/sync/v1/" + route).openConnection();
    connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
    connection.setRequestProperty("Connection", "close");
    if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
    try {
      if (body != null) {
        connection.setRequestMethod("POST"); connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
      }
      int status = connection.getResponseCode();
      if (status < 200 || status > 299) throw new IOException("HTTP " + status + " at " + route);
      try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
        byte[] buffer = new byte[4096]; int count;
        while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); if (output.size() > 2 * 1024 * 1024) throw new IOException("response too large"); }
        return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
      }
    } finally { connection.disconnect(); }
  }
}
