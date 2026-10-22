package dev.shiye.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONObject;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Explicit foreground, single-shot location. Never writes an entry or requests permission. */
public final class DiaryLocation implements AutoCloseable {
  public interface Callback {
    void onSuccess(String entryId, JSONObject result);
    void onError(String entryId, String code, String message);
  }
  private static final long MAX_AGE_MS = 30000, FIX_TIMEOUT_MS = 12000, NAME_TIMEOUT_MS = 3000;
  // A stalled system geocoder cannot accumulate threads or an unbounded queue.
  private static final ThreadPoolExecutor GEOCODER = new ThreadPoolExecutor(0, 1, 10,
      TimeUnit.SECONDS, new SynchronousQueue<Runnable>(), task -> {
        Thread thread = new Thread(task, "diary-location-name");
        thread.setDaemon(true);
        return thread;
      });
  private final WeakReference<Activity> activity;
  private final Context context;
  private final LocationManager manager;
  private final Handler main = new Handler(Looper.getMainLooper());
  private Request current;
  private boolean closed;

  private static final class Request {
    final String entryId;
    Callback callback;
    final List<CancellationSignal> signals = new ArrayList<>();
    final List<LocationListener> listeners = new ArrayList<>();
    Runnable timer;
    boolean naming;
    Request(String entryId, Callback callback) { this.entryId = entryId; this.callback = callback; }
  }
  public DiaryLocation(Activity owner) {
    activity = new WeakReference<>(owner);
    context = owner.getApplicationContext();
    manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
  }
  private void dispatch(Runnable task) {
    if (Looper.myLooper() == Looper.getMainLooper()) task.run(); else main.post(task);
  }
  public void begin(String entryId, Callback callback) {
    if (callback == null) throw new IllegalArgumentException("callback required");
    dispatch(() -> start(entryId, callback));
  }
  private void start(String entryId, Callback callback) {
    cancelCurrent();
    Request request = new Request(entryId, callback);
    current = request;
    Activity owner = activity.get();
    if (closed || owner == null || owner.isDestroyed() || owner.isFinishing()) {
      fail(request, "CANCELLED", "页面已关闭，请返回日记后重试"); return;
    }
    if (entryId == null || entryId.isEmpty()) {
      fail(request, "INVALID_ENTRY", "请先打开日记"); return;
    }
    boolean fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    boolean coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    if (!fine && !coarse) {
      fail(request, "PERMISSION_REQUIRED", "需要前台定位权限，也可以继续手填地点"); return;
    }
    if (manager == null) { fail(request, "NO_PROVIDER", "设备没有可用定位服务，可手填地点"); return; }
    try {
      if (Build.VERSION.SDK_INT >= 28 && !manager.isLocationEnabled()) {
        fail(request, "LOCATION_DISABLED", "系统定位未开启，请开启后重试或手填地点"); return;
      }
      List<String> providers = new ArrayList<>();
      if (providerEnabled(LocationManager.NETWORK_PROVIDER)) providers.add(LocationManager.NETWORK_PROVIDER);
      if (fine && providerEnabled(LocationManager.GPS_PROVIDER)) providers.add(LocationManager.GPS_PROVIDER);
      if (providers.isEmpty()) {
        fail(request, "NO_PROVIDER", "没有已开启的可用定位服务，请检查系统定位或手填地点"); return;
      }
      Location cached = null;
      for (String provider : providers) {
        Location value = manager.getLastKnownLocation(provider);
        if (fresh(value) && (cached == null || value.getElapsedRealtimeNanos() > cached.getElapsedRealtimeNanos())) cached = value;
      }
      if (cached != null) { located(request, cached, true); return; }
      request.timer = () -> fail(request, "LOCATION_TIMEOUT", "暂未获得位置，请重试或手填地点");
      main.postDelayed(request.timer, FIX_TIMEOUT_MS);
      for (String provider : providers) {
        if (!active(request) || request.naming) break;
        if (Build.VERSION.SDK_INT >= 30) {
          CancellationSignal signal = new CancellationSignal(); request.signals.add(signal);
          manager.getCurrentLocation(provider, signal, command -> main.post(command), value -> {
            if (fresh(value)) located(request, value, false);
          });
        } else {
          LocationListener listener = new LocationListener() {
            @Override public void onLocationChanged(Location value) { if (fresh(value)) located(request, value, false); }
            @Override public void onProviderDisabled(String provider) { }
            @Override public void onProviderEnabled(String provider) { }
            @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
          };
          request.listeners.add(listener);
          manager.requestSingleUpdate(provider, listener, Looper.getMainLooper());
        }
      }
    } catch (SecurityException error) {
      fail(request, "PERMISSION_REQUIRED", "定位权限已变化，请授权后重试或手填地点");
    } catch (RuntimeException error) {
      fail(request, "LOCATION_UNAVAILABLE", "定位服务暂不可用，请重试或手填地点");
    }
  }
  private boolean providerEnabled(String provider) {
    try { return manager.isProviderEnabled(provider); }
    catch (IllegalArgumentException absent) { return false; }
  }
  static long ageMs(Location value) {
    if (value == null || value.getElapsedRealtimeNanos() <= 0) return Long.MAX_VALUE;
    long delta = SystemClock.elapsedRealtimeNanos() - value.getElapsedRealtimeNanos();
    return delta < 0 ? Long.MAX_VALUE : TimeUnit.NANOSECONDS.toMillis(delta);
  }
  static boolean fresh(Location value) {
    return value != null && ageMs(value) <= MAX_AGE_MS && value.getTime() > 0
        && Double.isFinite(value.getLatitude()) && Math.abs(value.getLatitude()) <= 90
        && Double.isFinite(value.getLongitude()) && Math.abs(value.getLongitude()) <= 180;
  }
  private boolean active(Request request) { return current == request && request.callback != null; }
  private void located(Request request, Location value, boolean cached) {
    if (!active(request) || request.naming) return;
    request.naming = true;
    stopFix(request);
    final Location fix = new Location(value);
    final long cacheAge = ageMs(fix);
    final String coordinates = String.format(Locale.ROOT, "%.6f, %.6f", fix.getLatitude(), fix.getLongitude());
    request.timer = () -> succeed(request, fix, coordinates, false, cached, cacheAge);
    main.postDelayed(request.timer, NAME_TIMEOUT_MS);
    if (!Geocoder.isPresent()) { succeed(request, fix, coordinates, false, cached, cacheAge); return; }
    try {
      // Application context only: slow vendor geocoding must not retain an Activity.
      GEOCODER.execute(() -> {
        String name = null;
        try {
          List<Address> addresses = new Geocoder(context, Locale.getDefault()).getFromLocation(fix.getLatitude(), fix.getLongitude(), 1);
          if (addresses != null && !addresses.isEmpty()) name = addresses.get(0).getAddressLine(0);
        } catch (Exception ignored) { }
        final String resolved = name == null ? "" : name.trim();
        main.post(() -> succeed(request, fix, resolved.isEmpty() ? coordinates : resolved,
            !resolved.isEmpty(), cached, cacheAge));
      });
    } catch (RuntimeException rejected) { succeed(request, fix, coordinates, false, cached, cacheAge); }
  }
  private void succeed(Request request, Location fix, String name, boolean geocoded, boolean cached, long age) {
    if (!active(request)) return;
    Activity owner = activity.get();
    if (closed || owner == null || owner.isFinishing() || owner.isDestroyed()) {
      fail(request, "CANCELLED", "页面已关闭，请返回日记后重试"); return;
    }
    try {
      JSONObject result = new JSONObject();
      result.put("location", truncate(name, 100));
      result.put("latitude", fix.getLatitude()); result.put("longitude", fix.getLongitude());
      result.put("accuracy", fix.hasAccuracy() && Float.isFinite(fix.getAccuracy()) ? fix.getAccuracy() : JSONObject.NULL);
      result.put("observedAt", fix.getTime()); result.put("geocoded", geocoded);
      result.put("cached", cached); result.put("cacheAgeMs", age);
      Callback callback = finish(request);
      if (callback != null) callback.onSuccess(request.entryId, result);
    } catch (org.json.JSONException error) { fail(request, "LOCATION_UNAVAILABLE", "位置数据无效，请重试"); }
  }
  static String truncate(String value, int limit) {
    if (value.length() <= limit) return value;
    int end = limit;
    if (Character.isHighSurrogate(value.charAt(end - 1))) end--;
    return value.substring(0, end);
  }
  private void stopFix(Request request) {
    if (request.timer != null) main.removeCallbacks(request.timer);
    request.timer = null;
    for (CancellationSignal signal : request.signals) signal.cancel();
    request.signals.clear();
    for (LocationListener listener : request.listeners) {
      try { manager.removeUpdates(listener); } catch (RuntimeException ignored) { }
    }
    request.listeners.clear();
  }
  private Callback finish(Request request) {
    if (!active(request)) return null;
    stopFix(request);
    Callback callback = request.callback; request.callback = null; current = null;
    return callback;
  }
  private void fail(Request request, String code, String message) {
    Callback callback = finish(request);
    if (callback != null) callback.onError(request.entryId, code, message);
  }
  private void cancelCurrent() {
    if (current != null) fail(current, "CANCELLED", "定位已取消，可重新定位或手填地点");
  }
  /** Call when leaving the entry or foreground; settles the outstanding callback once. */
  public void cancel() { dispatch(this::cancelCurrent); }
  @Override public void close() { dispatch(() -> { closed = true; cancelCurrent(); activity.clear(); }); }
}
