package dev.shiye.app;

import android.app.AlertDialog;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;

/** One app-wide tone. Per-page wallpaper and its opacity remain separate. */
final class GlobalAppearance {
    static final String KEY="android-global-theme-v1";
    private final MainActivity h;
    private AlertDialog dialog;
    private Integer pausedSelection;
    private int[] activeSelection;
    private boolean pauseOnDismiss;
    GlobalAppearance(MainActivity host){h=host;}
    boolean selected(){return h.getPreferences(0).contains(KEY);}
    String mode(){return "dark".equals(h.getPreferences(0).getString(KEY,"light"))?"dark":"light";}
    boolean isDark(){return mode().equals("dark");}
    int ink(){return isDark()?0xffedf4fc:MainActivity.INK;}
    int muted(){return isDark()?0xffb0c4d4:MainActivity.MUTED;}
    int accent(){return isDark()?0xff87d5ff:MainActivity.ACCENT;}
    int panel(){return isDark()?0xf21c3042:0xf2f4f9fd;}
    int textColor(int original){
        if(original==MainActivity.INK)return ink();
        if(original==MainActivity.MUTED)return muted();
        if(original==MainActivity.ACCENT)return accent();
        return original;
    }
    void adoptLegacy(String value){
        if(selected())return;
        // First visible legacy chat tone is only a migration default, not a second authority.
        if(h.getPreferences(0).edit().putString(KEY,"dark".equals(value)?"dark":"light").commit())h.applyGlobalTheme();
    }
    void show(){
        if(dialog!=null&&dialog.isShowing())return;
        final int[] selection=activeSelection=new int[]{pausedSelection==null?(isDark()?1:0):pausedSelection};
        pausedSelection=null;
        dialog=new AlertDialog.Builder(h).setTitle("全局主题")
            .setSingleChoiceItems(new String[]{"浅色 · 黑字与浅色透明层","深色 · 白字与冷蓝透明层"},selection[0],(d,n)->selection[0]=n)
            .setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        dialog.setOnShowListener(d->{tintDialog(dialog);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            final AlertDialog owner=dialog;
            final String next=selection[0]==1?"dark":"light";
            owner.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            h.io.execute(()->{boolean ok=h.getPreferences(0).edit().putString(KEY,next).commit();h.main.post(()->{
                if(h.destroyed)return;if(ok){pausedSelection=null;h.applyGlobalTheme();if(owner.isShowing())owner.dismiss();}else{if(owner.isShowing())owner.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);h.toast("主题未保存，请重试");}
            });});
        });});
        dialog.setOnDismissListener(d->{if(pauseOnDismiss&&activeSelection!=null)pausedSelection=activeSelection[0];pauseOnDismiss=false;activeSelection=null;dialog=null;});dialog.show();
    }
    void dismissForModuleChange(){if(dialog!=null&&dialog.isShowing()){pauseOnDismiss=true;dialog.dismiss();}}
    void tintDialog(AlertDialog target){
        if(target==null||!target.isShowing()||target.getWindow()==null)return;
        target.getWindow().setBackgroundDrawable(h.shape(panel(),18));tintTree(target.getWindow().getDecorView());
    }
    void tintTree(View view){
        if(view==null)return;
        if(view instanceof TextView){TextView label=(TextView)view;label.setTextColor(view instanceof Button?accent():ink());if(view instanceof EditText)((EditText)view).setHintTextColor(muted());}
        if(view instanceof MainActivity.Icon){((MainActivity.Icon)view).color=accent();view.invalidate();}
        if(view.getBackground() instanceof GradientDrawable){
            GradientDrawable background=(GradientDrawable)view.getBackground();
            android.content.res.ColorStateList colors=background.getColor();
            if(colors!=null){int c=colors.getDefaultColor();if(c==MainActivity.PALE||c==0xffe1eff9||c==0x6621394b)background.setColor(isDark()?0x6621394b:0xffe1eff9);}
        }else if(view.getBackground() instanceof ColorDrawable){
            int color=((ColorDrawable)view.getBackground()).getColor();
            if(color==0xfff8fbfd||color==0xfffdfcf9||color==0xfff2f9fe||color==0xff1c3042)view.setBackgroundColor(isDark()?0xff1c3042:0xfff8fbfd);
        }
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)tintTree(group.getChildAt(i));}
    }
}
