package dev.shiye.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

/** The real navigation leaves layout before IME resize; only a fading snapshot stays at its old bottom. */
final class NavigationImeTransition {
    private final MainActivity host;
    private View current;
    private boolean targetVisible;
    private ValueAnimator fadingSnapshot;

    NavigationImeTransition(MainActivity activity) { host = activity; }

    void apply(View navigation, boolean visible, boolean animate) {
        if (navigation == null) { clear(); return; }
        if (current == navigation && targetVisible == visible) return;
        boolean sameView = current == navigation;
        if (!sameView) clear();
        current = navigation; targetVisible = visible;
        navigation.animate().cancel();
        if (fadingSnapshot != null) fadingSnapshot.cancel();
        if (!visible) {
            if (animate && navigation.getVisibility() == View.VISIBLE && navigation.getWidth() > 0 && navigation.getHeight() > 0)
                fadeOldPosition(navigation);
            navigation.setVisibility(View.GONE);
            navigation.setAlpha(1f); navigation.setTranslationY(0f);
        } else {
            navigation.setVisibility(View.VISIBLE);
            if (animate && sameView) {
                navigation.setAlpha(0f); navigation.setTranslationY(host.dp(8));
                navigation.animate().alpha(1f).translationY(0f).setDuration(160)
                    .setInterpolator(new DecelerateInterpolator()).start();
            } else { navigation.setAlpha(1f); navigation.setTranslationY(0f); }
        }
    }

    private void fadeOldPosition(View navigation) {
        if (fadingSnapshot != null) fadingSnapshot.cancel();
        final Bitmap bitmap = Bitmap.createBitmap(navigation.getWidth(), navigation.getHeight(), Bitmap.Config.ARGB_8888);
        navigation.draw(new Canvas(bitmap));
        final BitmapDrawable image = new BitmapDrawable(host.getResources(), bitmap);
        image.setBounds(navigation.getLeft(), navigation.getTop(), navigation.getRight(), navigation.getBottom());
        host.root.getOverlay().add(image);
        final ValueAnimator animation = ValueAnimator.ofInt(Math.round(255 * navigation.getAlpha()), 0);
        fadingSnapshot = animation;
        animation.setDuration(120);
        animation.addUpdateListener(value -> image.setAlpha((Integer) value.getAnimatedValue()));
        animation.addListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator ignored) {
                host.root.getOverlay().remove(image);
                bitmap.recycle();
                if (fadingSnapshot == animation) fadingSnapshot = null;
            }
        });
        animation.start();
    }

    void clear() {
        if (current != null) current.animate().cancel();
        if (fadingSnapshot != null) fadingSnapshot.cancel();
        current = null;
    }
}
