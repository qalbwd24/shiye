package dev.shiye.app;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import org.json.JSONObject;

/** A background-only drawable: bitmap opacity and veil never change child text alpha. */
final class NativeWallpaperDrawable extends Drawable {
    private final Bitmap bitmap;
    private final String mode, fill, position, veil;
    private final boolean dark;
    private final int imageAlpha;
    private int wallpaperWidth, wallpaperHeight;
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
    NativeWallpaperDrawable(JSONObject appearance,Bitmap image) {
        bitmap=image;
        mode=appearance.optString("backgroundMode","sky");
        dark="dark".equals(appearance.optString("theme"));
        veil=appearance.optString("veil","none");
        JSONObject b=appearance.optJSONObject("background");
        fill=b==null?"cover":b.optString("fill","cover");
        position=b==null?"center":b.optString("position","center");
        double opacity=b==null?1:b.optDouble("opacity",1);
        imageAlpha=(int)Math.round(255*Math.max(0,Math.min(1,Double.isFinite(opacity)?opacity:1)));
    }
    @Override public void draw(Canvas canvas) {
        Rect bounds=getBounds();
        if(bounds.isEmpty())return;
        int save=canvas.save();canvas.clipRect(bounds);
        // IME clips the available surface, never re-centres or scales the wallpaper.
        if(wallpaperWidth!=bounds.width()){wallpaperWidth=bounds.width();wallpaperHeight=bounds.height();}
        else wallpaperHeight=Math.max(wallpaperHeight,bounds.height());
        bounds=new Rect(bounds.left,bounds.top,bounds.right,bounds.top+wallpaperHeight);
        paint.setShader(null);paint.setAlpha(255);
        if("sky".equals(mode)) {
            paint.setShader(new LinearGradient(bounds.left,bounds.top,bounds.right,bounds.bottom,
                dark?new int[]{0xff192f43,0xff2a4960}:new int[]{0xffe8f6ff,0xfff8fcff},null,Shader.TileMode.CLAMP));
            canvas.drawRect(bounds,paint);paint.setShader(null);
        } else canvas.drawColor(dark?0xff182d40:0xfff8fbfd);
        if("custom".equals(mode)&&bitmap!=null&&!bitmap.isRecycled()) {
            paint.setAlpha(imageAlpha);
            if("tile".equals(fill)) {
                BitmapShader shader=new BitmapShader(bitmap,Shader.TileMode.REPEAT,Shader.TileMode.REPEAT);
                Matrix matrix=new Matrix();
                float x=align(bounds.width(),bitmap.getWidth(),position,"left","right");
                float y=align(bounds.height(),bitmap.getHeight(),position,"top","bottom");
                matrix.setTranslate(bounds.left+x,bounds.top+y);shader.setLocalMatrix(matrix);paint.setShader(shader);
                canvas.drawRect(bounds,paint);paint.setShader(null);
            } else {
                float sx=(float)bounds.width()/bitmap.getWidth(),sy=(float)bounds.height()/bitmap.getHeight();
                float scale="contain".equals(fill)?Math.min(sx,sy):Math.max(sx,sy);
                float width=bitmap.getWidth()*scale,height=bitmap.getHeight()*scale;
                float x=bounds.left+align(bounds.width(),width,position,"left","right");
                float y=bounds.top+align(bounds.height(),height,position,"top","bottom");
                canvas.drawBitmap(bitmap,null,new RectF(x,y,x+width,y+height),paint);
            }
        }
        paint.setAlpha(255);
        // Match editor.css's optional light (#ffffff38) and dark (#08131d66) veils.
        if("light".equals(veil))canvas.drawColor(0x38ffffff);
        else if("dark".equals(veil))canvas.drawColor(0x6608131d);
        canvas.restoreToCount(save);
    }
    private static float align(float available,float image,String value,String start,String end) {
        return start.equals(value)?0:end.equals(value)?available-image:(available-image)/2;
    }
    @Override public void setAlpha(int alpha) { /* Wallpaper opacity is part of its own saved settings. */ }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter);invalidateSelf(); }
    @Override public int getOpacity() { return PixelFormat.OPAQUE; }
}
