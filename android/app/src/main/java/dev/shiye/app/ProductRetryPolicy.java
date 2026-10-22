package dev.shiye.app;

/** Bounded foreground retry policy; authentication and data errors require user action. */
final class ProductRetryPolicy {
    private int failures, checkpoints;
    long success(boolean more) {
        failures=0;
        if(more)return ++checkpoints<=3?250:5000;
        checkpoints=0;return 15000;
    }
    long failure(String code) {
        checkpoints=0;
        if(!("SYNC_OFFLINE".equals(code)||"SYNC_NETWORK".equals(code)||"SYNC_TIMEOUT".equals(code)||"SYNC_RATE_LIMITED".equals(code)))return -1;
        failures=Math.min(failures+1,7);
        return Math.min(300000,5000L*(1L<<(failures-1)));
    }
    void reset(){failures=0;checkpoints=0;}
}
