package dev.shiye.syncprobe.p20261018;

import android.app.Activity;
import android.os.Bundle;

/** No display, no persistent task: clears the freshly-installed stopped state. */
public final class ProbeActivity extends Activity {
  @Override public void onCreate(Bundle saved) { super.onCreate(saved); finish(); }
}
