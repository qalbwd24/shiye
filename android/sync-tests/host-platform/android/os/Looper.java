package android.os;
/** Host HTTP runs on a worker; Android main-thread protection is covered by the 29 native checks. */
public final class Looper {
    private static final Looper MAIN=new Looper();
    public static Looper myLooper(){return null;}
    public static Looper getMainLooper(){return MAIN;}
}
