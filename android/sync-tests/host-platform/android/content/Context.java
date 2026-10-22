package android.content;
/** Host test boundary only; never compiled into the Android application. */
public abstract class Context {
    public static final int MODE_PRIVATE=0;
    public Context getApplicationContext(){return this;}
    public abstract SharedPreferences getSharedPreferences(String name,int mode);
}
