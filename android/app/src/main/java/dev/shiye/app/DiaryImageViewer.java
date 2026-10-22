package dev.shiye.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.graphics.*;
import android.media.ExifInterface;
import android.os.Handler;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Read-only static-image viewer. GIF is explicitly shown as a sampled first frame. */
public final class DiaryImageViewer {
  private DiaryImageViewer() { }
  /** Main thread only. Caller dismisses on entry change / Activity destruction. */
  public static Dialog show(Activity activity, File file) {
    if (Looper.myLooper() != Looper.getMainLooper()) throw new IllegalStateException("main thread required");
    Dialog dialog = new Dialog(activity, android.R.style.Theme_Material_NoActionBar);
    LinearLayout root = new LinearLayout(activity);
    root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.BLACK);
    root.setFitsSystemWindows(true);
    Button close = new Button(activity); close.setText("关闭图片"); close.setTextColor(Color.WHITE);
    close.setBackgroundColor(0xff171717); close.setContentDescription("关闭全屏图片，返回日记");
    root.addView(close, new LinearLayout.LayoutParams(-1, (int)(48 * activity.getResources().getDisplayMetrics().density)));
    TileView image = new TileView(activity, file);
    root.addView(image, new LinearLayout.LayoutParams(-1, 0, 1));
    dialog.setContentView(root); close.setOnClickListener(v -> dialog.dismiss());
    dialog.setOnDismissListener(ignored -> image.dispose());
    dialog.show();
    Window window = dialog.getWindow();
    if (window != null) {
      window.setBackgroundDrawableResource(android.R.color.black);
      window.setLayout(-1, -1);
      window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }
    return dialog;
  }
  // Pure arithmetic helpers are package-visible for bounded-budget/orientation tests.
  static int sampleFor(int width, int height, long budget, int initial) {
    int sample = Math.max(1, initial);
    while (((long)width + sample - 1) / sample * (((long)height + sample - 1) / sample) > budget && sample < (1 << 29)) sample *= 2;
    return sample;
  }
  static float[] orientationValues(int o, int w, int h) {
    switch (o) {
      case 1: return new float[]{1,0,0,0,1,0,0,0,1};
      case 2: return new float[]{-1,0,w,0,1,0,0,0,1};
      case 3: return new float[]{-1,0,w,0,-1,h,0,0,1};
      case 4: return new float[]{1,0,0,0,-1,h,0,0,1};
      case 5: return new float[]{0,1,0,1,0,0,0,0,1};
      case 6: return new float[]{0,-1,h,1,0,0,0,0,1};
      case 7: return new float[]{0,-1,h,-1,0,w,0,0,1};
      case 8: return new float[]{0,1,0,-1,0,w,0,0,1};
      default: throw new IllegalArgumentException("unsupported orientation");
    }
  }
  private static final class TileView extends View {
    private static final long TILE_PIXELS = 2_000_000, PREVIEW_PIXELS = 262_144;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {Thread t=new Thread(r,"diary-image-region");t.setDaemon(true);return t;});
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Matrix orientation = new Matrix();
    private BitmapRegionDecoder decoder; // worker-only ownership
    private Bitmap preview, tile;
    private Rect tileRect;
    private int width, height, orientedWidth, orientedHeight;
    private float scale=1, minimum=1, x, y;
    private boolean ready, region, running;
    private volatile boolean disposed;
    private long version;
    private String message = "正在打开图片…";
    private final GestureDetector gestures;
    private final ScaleGestureDetector pinch;
    private final Runnable request = this::decodeVisible;
    TileView(Context context, File file) {
      super(context); setBackgroundColor(Color.BLACK); setContentDescription("图片；双指缩放，拖动浏览，双击适屏");
      text.setColor(Color.WHITE); text.setTextSize(14 * getResources().getDisplayMetrics().scaledDensity);
      gestures = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
        @Override public boolean onDown(android.view.MotionEvent e) { return true; }
        @Override public boolean onScroll(android.view.MotionEvent a, android.view.MotionEvent b, float dx, float dy) {
          if (!pinch.isInProgress() && ready) { x-=dx;y-=dy;changed(); } return true;
        }
        @Override public boolean onDoubleTap(android.view.MotionEvent e) {
          if (!ready) return true;
          if (scale > minimum * 1.1f) zoom(minimum,getWidth()/2f,getHeight()/2f); else zoom(Math.min(8, minimum * 3),e.getX(),e.getY());
          return true;
        }
      });
      pinch = new ScaleGestureDetector(context, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
        @Override public boolean onScale(ScaleGestureDetector d) { if(ready)zoom(scale*d.getScaleFactor(),d.getFocusX(),d.getFocusY());return true; }
      });
      worker.execute(() -> open(file));
    }
    private void open(File file) {
      Bitmap first = null;
      try {
        if (file == null || !file.isFile()) throw new IOException("missing image");
        BitmapFactory.Options bounds = new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
        BitmapFactory.decodeFile(file.getAbsolutePath(),bounds);
        int w=bounds.outWidth,h=bounds.outHeight;
        if(w<=0||h<=0||w>1_000_000||h>1_000_000)throw new IOException("invalid dimensions");
        String mime=bounds.outMimeType == null ? "" : bounds.outMimeType;
        int exif=1;
        if(!mime.equals("image/gif")) {
          try { exif=new ExifInterface(file.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION,1); }
          catch(IOException error) { if(mime.equals("image/jpeg")||mime.equals("image/png")||mime.equals("image/webp"))throw new IOException("无法核验照片方向"); }
        }
        if(exif==0)exif=1;
        final float[] transform=orientationValues(exif,w,h);
        boolean canRegion=!mime.equals("image/gif");
        if(canRegion)try {decoder=BitmapRegionDecoder.newInstance(file.getAbsolutePath(),false);}catch(IOException|RuntimeException ignored){canRegion=false;}
        canRegion=canRegion&&decoder!=null;
        BitmapFactory.Options options=new BitmapFactory.Options();options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        options.inSampleSize=sampleFor(w,h,canRegion?PREVIEW_PIXELS:TILE_PIXELS,1);
        first=BitmapFactory.decodeFile(file.getAbsolutePath(),options);
        if(first==null)throw new IOException("无法解码图片");
        if(first.getAllocationByteCount()>(canRegion?PREVIEW_PIXELS:TILE_PIXELS)*4+65536){first.recycle();first=null;throw new IOException("图片解码超出安全额度");}
        if(disposed){first.recycle();return;}
        final Bitmap initial=first;first=null;final boolean useRegion=canRegion;final int direction=exif;
        final String note=mime.equals("image/gif")?"GIF：静态首帧预览":canRegion?"":"兼容预览：已按安全尺寸采样";
        main.post(() -> {
          if(disposed){initial.recycle();return;}
          width=w;height=h;orientedWidth=direction>=5?h:w;orientedHeight=direction>=5?w:h;
          orientation.setValues(transform);preview=initial;region=useRegion;ready=true;message=note;fit();
        });
      } catch(Exception|OutOfMemoryError error) {
        if(first!=null)first.recycle();
        main.post(() -> {if(!disposed){message="暂时无法安全显示这张图片";invalidate();}});
      } finally { if(disposed && decoder!=null){decoder.recycle();decoder=null;} }
    }
    private Matrix transform() {
      Matrix m=new Matrix(orientation);m.postScale(scale,scale);m.postTranslate(x,y);return m;
    }
    private void fit() {
      if(!ready||getWidth()==0||getHeight()==0)return;
      minimum=Math.min((float)getWidth()/orientedWidth,(float)getHeight()/orientedHeight);
      // Long screenshots initially fit width; double tap returns to full-image fit.
      scale=orientedHeight>orientedWidth*2L?(float)getWidth()/orientedWidth:minimum;
      x=(getWidth()-orientedWidth*scale)/2;y=orientedHeight*scale>getHeight()?0:(getHeight()-orientedHeight*scale)/2;changed();
    }
    private void zoom(float next,float fx,float fy) {
      next=Math.max(minimum,Math.min(Math.max(8,minimum),next));
      float ratio=next/scale;x=fx-(fx-x)*ratio;y=fy-(fy-y)*ratio;scale=next;changed();
    }
    private void changed() {
      x=orientedWidth*scale<=getWidth()?(getWidth()-orientedWidth*scale)/2:Math.max(getWidth()-orientedWidth*scale,Math.min(0,x));
      y=orientedHeight*scale<=getHeight()?(getHeight()-orientedHeight*scale)/2:Math.max(getHeight()-orientedHeight*scale,Math.min(0,y));
      version++;invalidate();main.removeCallbacks(request);if(region&&!disposed)main.postDelayed(request,60);
    }
    @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){super.onSizeChanged(w,h,oldw,oldh);if(ready)fit();}
    @Override public boolean onTouchEvent(android.view.MotionEvent e){pinch.onTouchEvent(e);gestures.onTouchEvent(e);return true;}
    @Override protected void onDraw(Canvas canvas) {
      super.onDraw(canvas);
      if(ready){canvas.save();canvas.concat(transform());
        if(preview!=null)canvas.drawBitmap(preview,null,new RectF(0,0,width,height),paint);
        if(tile!=null&&tileRect!=null)canvas.drawBitmap(tile,null,new RectF(tileRect),paint);
        canvas.restore();}
      if(!message.isEmpty())canvas.drawText(message,16,Math.max(24,getHeight()-24),text);
    }
    private void decodeVisible() {
      if(disposed||!ready||!region||running)return;
      Matrix inverse=new Matrix();if(!transform().invert(inverse))return;
      RectF visible=new RectF(-64,-64,getWidth()+64,getHeight()+64);inverse.mapRect(visible);
      Rect rect=new Rect(Math.max(0,(int)Math.floor(visible.left)),Math.max(0,(int)Math.floor(visible.top)),Math.min(width,(int)Math.ceil(visible.right)),Math.min(height,(int)Math.ceil(visible.bottom)));
      if(rect.isEmpty())return;
      int natural=1;while(natural<1<<20 && natural*2*scale<=1)natural*=2;
      int sample=sampleFor(rect.width(),rect.height(),TILE_PIXELS,natural);long token=version;running=true;
      worker.execute(() -> {
        Bitmap decoded=null;
        try {if(!disposed&&decoder!=null){BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=sample;options.inPreferredConfig=Bitmap.Config.ARGB_8888;decoded=decoder.decodeRegion(rect,options);if(decoded!=null && decoded.getAllocationByteCount()>TILE_PIXELS*4+65536){decoded.recycle();decoded=null;}}}
        catch(RuntimeException|OutOfMemoryError ignored) { }
        final Bitmap result=decoded;
        main.post(() -> {
          running=false;
          if(disposed||token!=version){if(result!=null)result.recycle();if(!disposed)decodeVisible();return;}
          if(result!=null){Bitmap previous=tile;tile=result;tileRect=rect;if(previous!=null)previous.recycle();invalidate();}
        });
      });
    }
    @Override protected void onDetachedFromWindow(){dispose();super.onDetachedFromWindow();}
    void dispose() {
      if(disposed)return;disposed=true;version++;main.removeCallbacks(request);
      if(tile!=null){tile.recycle();tile=null;}if(preview!=null){preview.recycle();preview=null;}
      worker.execute(() -> {if(decoder!=null){decoder.recycle();decoder=null;}});worker.shutdown();
    }
  }
}
