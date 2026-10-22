package dev.shiye.app;

import android.Manifest;
import android.app.Activity;
import android.app.Dialog;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.provider.MediaStore;
import android.util.LruCache;
import android.util.Size;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.MotionEvent;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.BaseAdapter;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/** Original offline attachment sheet. No Telegram code or remote media service. */
public final class AttachmentPicker {
    public interface Listener {
        void onPhoto(Uri uri);
        default void onPhotos(List<Uri> uris) { if (!uris.isEmpty()) onPhoto(uris.get(0)); }
        default void onPhoto(Uri uri, boolean original) { onPhoto(uri); }
        default void onPhotos(List<Uri> uris, boolean original) { onPhotos(uris); }
        void onBrowse();
        default void onBrowse(boolean original) { onBrowse(); }
        void onCancel();
    }

    public static final int PERMISSION_REQUEST = 203;
    private static final int PAPER = 0xfff2f9fe, INK = 0xff111827, ACCENT = 0xff327db2;
    private final Activity activity;
    private final Listener listener;
    private final boolean includeVideos;
    private final boolean multi;
    private final boolean diaryCompressionChoice;
    private boolean original;
    private final ArrayList<Uri> selected = new ArrayList<>();
    private List<MediaItem> loaded = new ArrayList<>();
    private TextView send, title;
    private GridView photoGrid;
    private int collapsedHeight, preferredHeight, expandedHeight, desiredHeight;
    private boolean expanded;
    private android.animation.ValueAnimator resizeAnimation;
    private final LruCache<String,Bitmap> cache = new LruCache<String,Bitmap>(8 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getAllocationByteCount(); }
    };
    private Dialog dialog;
    private LinearLayout sheet;
    private FrameLayout backdrop, content;
    private TextView more;
    private String albumId;
    private String albumName;
    private final LinkedHashMap<String,String> albums = new LinkedHashMap<>();
    private final HashSet<String> seen = new HashSet<>();
    private final HashSet<String> pendingThumbnails = new HashSet<>();
    private long lastDate = Long.MAX_VALUE, lastId = Long.MAX_VALUE;
    private boolean hasMore, loadingPage;
    private boolean replacingAlbum;
    private final PickerAlbumState albumState=new PickerAlbumState();
    private static final int PAGE_SIZE = 72;
    private ExecutorService workers;
    private ExecutorService queryWorker;
    private CancellationSignal cancellation;
    private volatile boolean closing;
    private boolean delivered, requesting;
    private volatile int generation;

    public AttachmentPicker(Activity activity, Listener listener) {
        this(activity, listener, false);
    }

    /** Video support is opt-in: diary image insertion keeps its existing image-only contract. */
    public AttachmentPicker(Activity activity, Listener listener, boolean includeVideos) {
        this(activity, listener, includeVideos, false);
    }

    public AttachmentPicker(Activity activity, Listener listener, boolean includeVideos, boolean multi) {
        this(activity, listener, includeVideos, multi, false);
    }

    /** Diary opts into a compression choice; chat keeps its original-file callback. */
    public AttachmentPicker(Activity activity, Listener listener, boolean includeVideos, boolean multi, boolean diaryCompressionChoice) {
        this.activity = activity;
        this.listener = listener;
        this.includeVideos = includeVideos;
        this.multi = multi;
        this.diaryCompressionChoice = diaryCompressionChoice;
    }

    public void show() {
        if (activity.isFinishing() || activity.isDestroyed() || (dialog != null && dialog.isShowing())) return;
        closing = delivered = requesting = false;
        selected.clear(); expanded=false;original=false;
        workers = new ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(64));
        queryWorker = Executors.newSingleThreadExecutor();
        dialog = new Dialog(activity) {
            @Override public void onBackPressed() { finish(null); }
        };
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        backdrop = new FrameLayout(activity);
        backdrop.setBackgroundColor(0x660f0b16);
        backdrop.setOnClickListener(v -> finish(null));
        sheet = new LinearLayout(activity);
        sheet.setOrientation(LinearLayout.VERTICAL);
        sheet.setClickable(true);
        GradientDrawable surface = new GradientDrawable();
        surface.setColor(PAPER);
        float radius = dp(23);
        surface.setCornerRadii(new float[]{radius,radius,radius,radius,0,0,0,0});
        sheet.setBackground(surface);
        sheet.setClipToOutline(true);
        int available = activity.getResources().getDisplayMetrics().heightPixels;
        collapsedHeight = Math.min(available,Math.max(dp(250),Math.round(available * .45f)));
        preferredHeight = Math.max(collapsedHeight,Math.min(Math.round(available * .86f), dp(780)));
        expandedHeight = Math.max(preferredHeight, available);
        desiredHeight = preferredHeight;
        FrameLayout.LayoutParams panel = new FrameLayout.LayoutParams(-1, desiredHeight, Gravity.BOTTOM);
        backdrop.addView(sheet,panel);

        FrameLayout dragZone=new FrameLayout(activity);
        View handle = new View(activity);handle.setBackground(round(0xffb9d2e2,3));
        FrameLayout.LayoutParams handleParams=new FrameLayout.LayoutParams(dp(34),dp(4),Gravity.CENTER);
        dragZone.addView(handle,handleParams);
        sheet.addView(dragZone,new LinearLayout.LayoutParams(-1,dp(16)));
        dragZone.setContentDescription("拖动展开或收起相册");
        dragZone.setOnTouchListener(new View.OnTouchListener(){float startY;int startHeight;boolean moved;
            @Override public boolean onTouch(View v,MotionEvent event){
                if(event.getActionMasked()==MotionEvent.ACTION_DOWN){if(resizeAnimation!=null)resizeAnimation.cancel();startY=event.getRawY();startHeight=sheet.getHeight();moved=false;return true;}
                if(event.getActionMasked()==MotionEvent.ACTION_MOVE){
                    float delta=event.getRawY()-startY;moved|=Math.abs(delta)>dp(8);
                    if(moved){ViewGroup.LayoutParams size=sheet.getLayoutParams();size.height=Math.max(collapsedHeight,Math.min(expandedHeight,startHeight-Math.round(delta)));sheet.setLayoutParams(size);}
                    return true;
                }
                if(event.getActionMasked()==MotionEvent.ACTION_UP){
                    if(moved){desiredHeight=sheet.getHeight();expanded=desiredHeight>=expandedHeight-dp(8);}
                    else setExpanded(!expanded);
                    return true;
                }
                return true;
            }
        });
        LinearLayout heading = new LinearLayout(activity);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.setPadding(dp(20),0,dp(10),0);
        title=text("全部相册  ▾",16,INK); title.setTypeface(null,1);
        title.setOnClickListener(v->showAlbums());
        heading.addView(title,new LinearLayout.LayoutParams(0,dp(40),1));
        more=button("管理授权",()->requestAccess());
        more.setTextSize(12);
        heading.addView(more,new LinearLayout.LayoutParams(-2,dp(40)));
        sheet.addView(heading,new LinearLayout.LayoutParams(-1,dp(40)));
        content = new FrameLayout(activity);
        sheet.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        View rule=new View(activity);rule.setBackgroundColor(0xffcadfee);sheet.addView(rule,new LinearLayout.LayoutParams(-1,dp(1)));
        LinearLayout footer=new LinearLayout(activity);footer.setPadding(dp(14),dp(4),dp(14),dp(4));
        TextView files=button("⌑  文件",()->finish(()->listener.onBrowse(diaryCompressionChoice?original:true)));files.setTextColor(0xff475569);
        footer.addView(files,new LinearLayout.LayoutParams(-1,dp(44)));
        sheet.addView(footer,new LinearLayout.LayoutParams(-1,-2));
        if(diaryCompressionChoice&&!multi){
            TextView originalOption=text("○ 原图",12,0xff526c7c);
            originalOption.setGravity(Gravity.CENTER);
            originalOption.setOnClickListener(v->{original=!original;originalOption.setText(original?"● 原图":"○ 原图");});
            sheet.addView(originalOption,new LinearLayout.LayoutParams(-1,dp(44)));
        }
        if(multi){
            LinearLayout actions=new LinearLayout(activity);actions.setGravity(Gravity.CENTER_VERTICAL);actions.setPadding(dp(15),0,dp(15),dp(4));
            TextView originalOption=text(diaryCompressionChoice?"○ 原图":"按选择顺序发送",12,0xff526c7c);
            if(diaryCompressionChoice)originalOption.setOnClickListener(v->{original=!original;originalOption.setText(original?"● 原图":"○ 原图");});
            actions.addView(originalOption,new LinearLayout.LayoutParams(0,dp(44),1));
            send=button("发送",()->{if(!selected.isEmpty()){ArrayList<Uri> ordered=new ArrayList<>(selected);boolean full=diaryCompressionChoice?original:true;finish(()->listener.onPhotos(ordered,full));}});
            send.setTextColor(Color.WHITE);send.setBackground(round(ACCENT,14));send.setEnabled(false);
            actions.addView(send,new LinearLayout.LayoutParams(dp(102),dp(44)));
            sheet.addView(actions,new LinearLayout.LayoutParams(-1,-2));
        }
        dialog.setContentView(backdrop);
        // Let Android dispatch Back to the animated onBackPressed path.
        dialog.setCancelable(true);
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnDismissListener(d -> {
            stopWork();
            if(!delivered){delivered=true;listener.onCancel();}
        });
        Window window=dialog.getWindow();
        if(window!=null){
            window.setBackgroundDrawableResource(android.R.color.transparent);
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            // This sheet has no editor. Keep an already-open IME's state while the
            // sheet owns focus; do not request an IME when it was closed.
            window.addFlags(WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
            window.setLayout(-1,-1);
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_UNCHANGED|WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }
        dialog.show();
        if(window!=null)window.setLayout(-1,-1);
        // Use the dialog's laid-out safe content bounds. Display metrics also
        // include system bars and can push the drag handle above the window.
        backdrop.addOnLayoutChangeListener((v,left,top,right,bottom,oldLeft,oldTop,oldRight,oldBottom)->{
            int measured=bottom-top;
            if(measured<=0||measured==oldBottom-oldTop)return;
            if(resizeAnimation!=null)resizeAnimation.cancel();
            collapsedHeight=Math.min(measured,Math.max(dp(250),Math.round(measured*.45f)));
            preferredHeight=Math.max(collapsedHeight,Math.min(Math.round(measured*.86f),dp(780)));
            expandedHeight=measured;
            desiredHeight=Math.max(collapsedHeight,Math.min(expandedHeight,desiredHeight));
            ViewGroup.LayoutParams size=sheet.getLayoutParams();size.height=expanded?expandedHeight:desiredHeight;sheet.setLayoutParams(size);
        });
        sheet.setTranslationY(desiredHeight);
        backdrop.setAlpha(0);
        backdrop.animate().alpha(1).setDuration(190).start();
        sheet.animate().translationY(0).setDuration(220).setInterpolator(new DecelerateInterpolator(1.5f)).start();
        if(hasAccess())load();else showPermission(false);
    }

    public void onPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if(requestCode!=PERMISSION_REQUEST)return;
        requesting=false;
        if(dialog==null||!dialog.isShowing()||closing)return;
        if(hasAccess())load();else showPermission(true);
    }

    /** Activity destruction should release queries and thumbnails without retaining its window. */
    public void dismiss() {
        if(dialog!=null&&dialog.isShowing()){
            closing=true;
            if(sheet!=null)sheet.animate().cancel();
            if(backdrop!=null)backdrop.animate().cancel();
            dialog.dismiss();
        }else stopWork();
    }

    private void setExpanded(boolean value){
        if(sheet==null||dialog==null||!dialog.isShowing())return;
        expanded=value;
        if(resizeAnimation!=null)resizeAnimation.cancel();
        desiredHeight=value?expandedHeight:preferredHeight;
        resizeAnimation=android.animation.ValueAnimator.ofInt(sheet.getHeight(),desiredHeight);
        resizeAnimation.setDuration(150);
        resizeAnimation.addUpdateListener(frame->{ViewGroup.LayoutParams params=sheet.getLayoutParams();params.height=(Integer)frame.getAnimatedValue();sheet.setLayoutParams(params);});
        resizeAnimation.start();
    }

    private void updateSelected(){
        if(send!=null){send.setEnabled(!selected.isEmpty());send.setText(selected.isEmpty()?"发送":"发送("+selected.size()+")");}
        if(photoGrid!=null){
            int first=photoGrid.getFirstVisiblePosition();
            for(int i=0;i<photoGrid.getChildCount();i++){
                int index=first+i;
                View child=photoGrid.getChildAt(i);
                if(index>=loaded.size()||!(child instanceof FrameLayout))continue;
                TextView order=(TextView)((FrameLayout)child).getChildAt(2);
                int choice=selected.indexOf(loaded.get(index).uri);
                order.setText(choice<0?"○":String.valueOf(choice+1));
                order.setBackground(round(choice<0?0x99000000:ACCENT,15));
            }
        }
    }

    private void showAlbums(){
        if(!hasAccess()){showPermission(false);return;}
        ArrayList<String> ids=new ArrayList<>(albums.keySet());
        ArrayList<String> labels=new ArrayList<>();labels.add("全部相册");
        for(String id:ids)labels.add(albums.get(id));
        new android.app.AlertDialog.Builder(activity).setTitle("选择相册")
            .setItems(labels.toArray(new String[0]),(dialog,index)->startPage(index==0?null:ids.get(index-1)))
            .setNegativeButton("取消",null).show();
    }

    private void showGrid(){
        if(content==null||dialog==null||!dialog.isShowing())return;
        title.setText((albumName==null?"全部相册":albumName)+"  ▾");
        if(photoGrid!=null&&photoGrid.getParent()==content){
            Photos adapter=(Photos)photoGrid.getAdapter();
            adapter.reset(loaded,generation,cancellation);
            adapter.notifyDataSetChanged();
            photoGrid.setEnabled(true);
            return;
        }
        content.removeAllViews();
        GridView grid=new GridView(activity);photoGrid=grid;
        grid.setNumColumns(3);grid.setHorizontalSpacing(dp(3));grid.setVerticalSpacing(dp(3));grid.setPadding(dp(4),dp(2),dp(4),dp(4));grid.setClipToPadding(false);grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);grid.setVerticalScrollBarEnabled(false);
        grid.setAdapter(new Photos(loaded,generation,cancellation));
        grid.setOnScrollListener(new android.widget.AbsListView.OnScrollListener(){
            @Override public void onScrollStateChanged(android.widget.AbsListView view,int state){}
            @Override public void onScroll(android.widget.AbsListView view,int first,int visible,int total){
                if(hasMore&&!loadingPage&&total>0&&first+visible>=total-12)loadPage();
            }
        });
        grid.setOnItemClickListener((parent,view,position,id)->{
            if(replacingAlbum||position<0||position>=loaded.size())return;
            Uri uri=loaded.get(position).uri;
            if(!multi){boolean full=diaryCompressionChoice?original:true;finish(()->listener.onPhoto(uri,full));return;}
            int existing=selected.indexOf(uri);
            if(existing>=0)selected.remove(existing);else if(selected.size()<50)selected.add(uri);
            else android.widget.Toast.makeText(activity,"一次最多发送50项",android.widget.Toast.LENGTH_SHORT).show();
            updateSelected();
        });
        grid.setOnItemLongClickListener((parent,view,position,id)->{if(!replacingAlbum&&position>=0&&position<loaded.size())preview(loaded.get(position));return true;});
        content.addView(grid,new FrameLayout.LayoutParams(-1,-1));
    }

    private void preview(MediaItem item){
        Dialog viewer=new Dialog(activity);
        CancellationSignal previewSignal=new CancellationSignal();
        FrameLayout frame=new FrameLayout(activity);frame.setBackgroundColor(0xff10161e);
        ImageView image=new ImageView(activity);image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        frame.addView(image,new FrameLayout.LayoutParams(-1,-1));
        TextView close=button("关闭预览",viewer::dismiss);close.setTextColor(Color.WHITE);
        FrameLayout.LayoutParams closeParams=new FrameLayout.LayoutParams(-2,dp(48),Gravity.TOP|Gravity.LEFT);closeParams.leftMargin=dp(12);closeParams.topMargin=dp(12);frame.addView(close,closeParams);
        viewer.setContentView(frame);viewer.show();
        viewer.setOnDismissListener(d->{previewSignal.cancel();image.setImageDrawable(null);});
        Window window=viewer.getWindow();if(window!=null){window.setBackgroundDrawableResource(android.R.color.black);window.setLayout(-1,-1);}
        ExecutorService executor=workers;
        if(executor!=null&&!executor.isShutdown())try{executor.execute(()->{
            Bitmap bitmap=null;try{bitmap=Build.VERSION.SDK_INT>=29?activity.getContentResolver().loadThumbnail(item.uri,new Size(1100,1100),previewSignal):legacyThumbnail(item.uri,1100,previewSignal);}catch(Exception ignored){}
            final Bitmap result=bitmap;
            activity.runOnUiThread(()->{if(viewer.isShowing()&&!previewSignal.isCanceled()&&result!=null)image.setImageBitmap(result);});
        });}catch(RejectedExecutionException ignored){}
    }

    private boolean granted(String permission){return activity.checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}
    private boolean selectedAccess(){return Build.VERSION.SDK_INT>=34&&granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);}
    private boolean imagesAccess(){return Build.VERSION.SDK_INT>=33?(granted(Manifest.permission.READ_MEDIA_IMAGES)||selectedAccess()):granted(Manifest.permission.READ_EXTERNAL_STORAGE);}
    private boolean videosAccess(){return includeVideos&&(Build.VERSION.SDK_INT>=33?(granted(Manifest.permission.READ_MEDIA_VIDEO)||selectedAccess()):granted(Manifest.permission.READ_EXTERNAL_STORAGE));}
    private boolean hasAccess(){return imagesAccess()||videosAccess();}
    private boolean partial(){return Build.VERSION.SDK_INT>=33&&(!granted(Manifest.permission.READ_MEDIA_IMAGES)||(includeVideos&&!granted(Manifest.permission.READ_MEDIA_VIDEO)));}

    private void requestAccess(){
        if(requesting||closing)return;
        requesting=true;
        ArrayList<String> permissions=new ArrayList<>();
        if(Build.VERSION.SDK_INT>=33){
            permissions.add(Manifest.permission.READ_MEDIA_IMAGES);
            if(includeVideos)permissions.add(Manifest.permission.READ_MEDIA_VIDEO);
            if(Build.VERSION.SDK_INT>=34)permissions.add(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        }else permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        try{activity.requestPermissions(permissions.toArray(new String[0]),PERMISSION_REQUEST);}
        catch(RuntimeException failure){requesting=false;showPermission(true);}
    }

    private void showPermission(boolean denied){
        invalidateLoad();
        content.removeAllViews();
        more.setVisibility(View.GONE);
        LinearLayout message=new LinearLayout(activity);message.setOrientation(LinearLayout.VERTICAL);message.setGravity(Gravity.CENTER);message.setPadding(dp(30),dp(15),dp(30),dp(15));
        TextView note=text(denied?"允许访问照片，或使用下方文件入口。":"选择可访问的照片后显示相册。",13,0xff526c7c);note.setGravity(Gravity.CENTER);message.addView(note,new LinearLayout.LayoutParams(-1,-2));
        TextView allow=button(denied?"重新授权":"选择可访问的项目",()->requestAccess());allow.setBackground(round(0xffdceefa,22));
        LinearLayout.LayoutParams action=new LinearLayout.LayoutParams(-1,dp(46));action.topMargin=dp(22);message.addView(allow,action);
        showState(message);
    }

    private void load(){
        if(closing||workers==null||workers.isShutdown())return;
        if(!hasAccess()){showPermission(false);return;}
        invalidateLoad();
        final CancellationSignal signal=new CancellationSignal();cancellation=signal;
        final int token=++generation;
        more.setVisibility(partial()?View.VISIBLE:View.GONE);
        content.removeAllViews();
        TextView loading=text("正在载入相册…",13,0xff526c7c);loading.setGravity(Gravity.CENTER);content.addView(loading,new FrameLayout.LayoutParams(-1,-1));
        queryWorker.execute(()->{
            LinkedHashMap<String,String> found=new LinkedHashMap<>();
            boolean failed=false;
            try{
                Bundle args=new Bundle();args.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,mediaSelection());
                try(Cursor cursor=activity.getContentResolver().query(MediaStore.Files.getContentUri("external"),new String[]{"bucket_id","bucket_display_name"},args,signal)){
                    if(cursor==null)throw new IllegalStateException("图库暂不可用");
                    int id=cursor.getColumnIndexOrThrow("bucket_id"),name=cursor.getColumnIndexOrThrow("bucket_display_name");
                    while(!signal.isCanceled()&&cursor.moveToNext()){
                        String bucket=cursor.getString(id);
                        if(bucket!=null&&!found.containsKey(bucket))found.put(bucket,cursor.getString(name)==null?"其他":cursor.getString(name));
                    }
                }
            }catch(Exception ignored){failed=true;}
            final boolean error=failed;
            activity.runOnUiThread(()->{
                if(!active(token,signal))return;
                if(error){showLoadFailure();return;}
                albums.clear();albums.putAll(found);
                startPage(null);
            });
        });
    }

    private String mediaSelection(){
        return imagesAccess()&&videosAccess()?"media_type IN (1,3)":videosAccess()?"media_type = 3":"media_type = 1";
    }

    private void startPage(String bucket){
        replacingAlbum=photoGrid!=null&&photoGrid.getParent()==content;
        invalidateLoad();
        cancellation=new CancellationSignal();
        generation++;
        albumId=bucket;albumName=bucket==null?null:albums.get(bucket);
        albumState.begin(generation,albumId,albumName);
        if(!replacingAlbum){loaded=new ArrayList<>();seen.clear();}
        lastDate=Long.MAX_VALUE;lastId=Long.MAX_VALUE;
        hasMore=true;loadingPage=false;
        if(photoGrid!=null)photoGrid.setEnabled(false);
        loadPage();
    }

    /** Keyset paging stays inside one bucket; a device-wide cap cannot starve older albums. */
    private void loadPage(){
        if(loadingPage||!hasMore||closing||workers==null||workers.isShutdown())return;
        loadingPage=true;
        final int token=generation;
        final CancellationSignal signal=cancellation;
        final String bucket=albumId;
        final long beforeDate=lastDate,beforeId=lastId;
        try{queryWorker.execute(()->{
            ArrayList<MediaItem> page=new ArrayList<>();
            boolean failed=false;
            try{
                StringBuilder where=new StringBuilder(mediaSelection());
                ArrayList<String> values=new ArrayList<>();
                if(bucket!=null){where.append(" AND bucket_id = ?");values.add(bucket);}
                if(beforeDate!=Long.MAX_VALUE){where.append(" AND (date_added < ? OR (date_added = ? AND _id < ?))");values.add(Long.toString(beforeDate));values.add(Long.toString(beforeDate));values.add(Long.toString(beforeId));}
                Bundle args=new Bundle();args.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,where.toString());
                args.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,values.toArray(new String[0]));
                args.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER,"date_added DESC, _id DESC");
                args.putInt(ContentResolver.QUERY_ARG_LIMIT,PAGE_SIZE);
                try(Cursor cursor=activity.getContentResolver().query(MediaStore.Files.getContentUri("external"),new String[]{"_id","media_type","duration","date_added","bucket_id","bucket_display_name"},args,signal)){
                    if(cursor==null)throw new IllegalStateException("图库暂不可用");
                    int id=cursor.getColumnIndexOrThrow("_id"),type=cursor.getColumnIndexOrThrow("media_type"),duration=cursor.getColumnIndexOrThrow("duration"),date=cursor.getColumnIndexOrThrow("date_added"),album=cursor.getColumnIndexOrThrow("bucket_display_name");
                    while(!signal.isCanceled()&&page.size()<PAGE_SIZE&&cursor.moveToNext()){
                        boolean video=cursor.getInt(type)==MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                        Uri collection=video?MediaStore.Video.Media.EXTERNAL_CONTENT_URI:MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                        page.add(new MediaItem(ContentUris.withAppendedId(collection,cursor.getLong(id)),video,cursor.getLong(duration),cursor.getString(album),cursor.getLong(date),cursor.getLong(id)));
                    }
                }
            }catch(Exception ignored){failed=true;}
            final boolean error=failed;
            activity.runOnUiThread(()->{
                if(!active(token,signal))return;
                loadingPage=false;
                if(error){
                    if(albumState.pending(token)){
                        PickerAlbumState.Snapshot visible=albumState.rollback(token);
                        if(replacingAlbum&&visible!=null){
                            albumId=visible.albumId;albumName=visible.albumName;
                            lastDate=visible.lastDate;lastId=visible.lastId;hasMore=visible.hasMore;
                            replacingAlbum=false;invalidateLoad();cancellation=new CancellationSignal();generation++;
                            albumState.rebind(generation);showGrid();
                            android.widget.Toast.makeText(activity,"相册切换未完成，原相册仍可使用",android.widget.Toast.LENGTH_SHORT).show();
                        }else showLoadFailure();
                    }
                    else android.widget.Toast.makeText(activity,"后续照片载入失败，请重试",android.widget.Toast.LENGTH_SHORT).show();
                    return;
                }
                boolean firstPage=albumState.pending(token);
                if(firstPage&&replacingAlbum){loaded=new ArrayList<>();seen.clear();replacingAlbum=false;}
                for(MediaItem item:page){
                    lastDate=item.date;lastId=item.id;
                    if(seen.add(item.uri.toString()))loaded.add(item);
                }
                hasMore=page.size()==PAGE_SIZE;
                if(firstPage)albumState.commit(token,lastDate,lastId,hasMore);
                else albumState.advance(token,lastDate,lastId,hasMore);
                if(loaded.isEmpty())showEmpty();
                else if(photoGrid!=null){if(photoGrid.getAdapter() instanceof Photos&&((Photos)photoGrid.getAdapter()).token==token)((BaseAdapter)photoGrid.getAdapter()).notifyDataSetChanged();else showGrid();}
                else showGrid();
            });
        });}catch(RejectedExecutionException ignored){loadingPage=false;}
    }

    private void showEmpty(){
        content.removeAllViews();
        LinearLayout empty=new LinearLayout(activity);empty.setOrientation(LinearLayout.VERTICAL);empty.setGravity(Gravity.CENTER);
        TextView note=text(partial()?"当前授权范围内没有可显示的项目":"相册里还没有照片",15,0xff526c7c);
        note.setGravity(Gravity.CENTER);empty.addView(note,new LinearLayout.LayoutParams(-1,dp(60)));
        if(partial())empty.addView(button("选择更多项目",()->requestAccess()),new LinearLayout.LayoutParams(-1,dp(48)));
        empty.addView(button("从文件选择",()->finish(()->listener.onBrowse(diaryCompressionChoice?original:true))),new LinearLayout.LayoutParams(-1,dp(48)));
        showState(empty);
    }

    private void showLoadFailure(){
        if(!hasAccess()){showPermission(true);return;}
        LinearLayout failure=new LinearLayout(activity);failure.setOrientation(LinearLayout.VERTICAL);failure.setGravity(Gravity.CENTER);failure.setPadding(dp(24),dp(12),dp(24),dp(12));
        TextView note=text("暂时无法读取图库",16,INK);note.setGravity(Gravity.CENTER);failure.addView(note,new LinearLayout.LayoutParams(-1,dp(40)));
        TextView detail=text("可以重试，或通过文件入口选择附件。",13,0xff526c7c);detail.setGravity(Gravity.CENTER);failure.addView(detail,new LinearLayout.LayoutParams(-1,dp(44)));
        failure.addView(button("重试",()->load()),new LinearLayout.LayoutParams(-1,dp(46)));
        failure.addView(button("从文件选择",()->finish(()->listener.onBrowse(diaryCompressionChoice?original:true))),new LinearLayout.LayoutParams(-1,dp(46)));
        showState(failure);
    }

    /** Permission/error actions remain reachable in a short landscape window or large font. */
    private void showState(View state){
        content.removeAllViews();photoGrid=null;
        ScrollView scroll=new ScrollView(activity);scroll.setFillViewport(true);scroll.setClipToPadding(false);
        scroll.addView(state,new ScrollView.LayoutParams(-1,-2));
        content.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
    }

    /** Worker checks only immutable/volatile state; Android views stay on the UI thread. */
    private boolean current(int token,CancellationSignal signal){return !closing&&generation==token&&!signal.isCanceled();}
    private boolean active(int token,CancellationSignal signal){return current(token,signal)&&dialog!=null&&dialog.isShowing()&&!activity.isDestroyed();}

    private static final class MediaItem {
        final Uri uri;final boolean video;final long duration,date,id;final String album;
        MediaItem(Uri uri,boolean video,long duration,String album,long date,long id){this.uri=uri;this.video=video;this.duration=duration;this.album=album==null||album.isEmpty()?"其他":album;this.date=date;this.id=id;}
    }

    private String durationLabel(long duration){
        if(duration<=0)return "▶ 视频";
        long seconds=duration/1000;
        return seconds>=3600?String.format(java.util.Locale.ROOT,"▶ %d:%02d:%02d",seconds/3600,(seconds/60)%60,seconds%60):String.format(java.util.Locale.ROOT,"▶ %d:%02d",seconds/60,seconds%60);
    }

    private final class Photos extends BaseAdapter {
        List<MediaItem> photos;int token;CancellationSignal signal;
        Photos(List<MediaItem> photos,int token,CancellationSignal signal){this.photos=photos;this.token=token;this.signal=signal;}
        void reset(List<MediaItem> items,int nextToken,CancellationSignal nextSignal){photos=items;token=nextToken;signal=nextSignal;}
        @Override public int getCount(){return photos.size();}
        @Override public Object getItem(int position){return photos.get(position);}
        @Override public long getItemId(int position){return position;}
        @Override public View getView(int position,View recycled,ViewGroup parent){
            FrameLayout cell;
            ImageView image;
            TextView badge,order;
            if(recycled instanceof FrameLayout){cell=(FrameLayout)recycled;image=(ImageView)cell.getChildAt(0);badge=(TextView)cell.getChildAt(1);order=(TextView)cell.getChildAt(2);}
            else{
                cell=new FrameLayout(activity);image=new ImageView(activity);image.setScaleType(ImageView.ScaleType.CENTER_CROP);cell.addView(image,new FrameLayout.LayoutParams(-1,-1));
                badge=text("",11,Color.WHITE);badge.setGravity(Gravity.CENTER);badge.setPadding(dp(6),0,dp(6),0);badge.setBackground(round(0xb3111827,5));
                FrameLayout.LayoutParams label=new FrameLayout.LayoutParams(-2,dp(24),Gravity.BOTTOM|Gravity.RIGHT);label.setMargins(dp(4),dp(4),dp(5),dp(5));cell.addView(badge,label);
                order=text("",12,Color.WHITE);order.setGravity(Gravity.CENTER);order.setBackground(round(0x99000000,15));
                FrameLayout.LayoutParams marker=new FrameLayout.LayoutParams(dp(28),dp(28),Gravity.TOP|Gravity.RIGHT);marker.setMargins(0,dp(5),dp(5),0);cell.addView(order,marker);
            }
            int width=parent.getWidth()>0?parent.getWidth():activity.getResources().getDisplayMetrics().widthPixels;
            int side=Math.max(dp(48),(width-dp(14))/3);
            cell.setLayoutParams(new android.widget.AbsListView.LayoutParams(-1,side));cell.setBackgroundColor(0xffdcebf5);
            MediaItem item=photos.get(position);Uri uri=item.uri;String key=uri.toString();boolean same=key.equals(image.getTag());image.setTag(key);cell.setContentDescription((item.video?"视频 ":"照片 ")+(position+1)+(item.video?"，"+durationLabel(item.duration):""));if(!same)image.setImageDrawable(null);
            badge.setVisibility(item.video?View.VISIBLE:View.GONE);badge.setText(item.video?durationLabel(item.duration):"");
            int choice=selected.indexOf(uri);order.setVisibility(multi?View.VISIBLE:View.GONE);order.setText(choice<0?"○":String.valueOf(choice+1));order.setBackground(round(choice<0?0x99000000:ACCENT,15));
            Bitmap cached=cache.get(key);if(cached!=null){image.setImageBitmap(cached);return cell;}
            String pendingKey=token+"|"+key;
            if(!pendingThumbnails.add(pendingKey))return cell;
            ExecutorService executor=workers;
            if(executor==null||executor.isShutdown()){pendingThumbnails.remove(pendingKey);return cell;}
            try{executor.execute(()->{
                if(!current(token,signal)){activity.runOnUiThread(()->pendingThumbnails.remove(pendingKey));return;}
                Bitmap thumb=null;
                try{thumb=Build.VERSION.SDK_INT>=29?activity.getContentResolver().loadThumbnail(uri,new Size(side,side),signal):item.video?MediaStore.Video.Thumbnails.getThumbnail(activity.getContentResolver(),ContentUris.parseId(uri),MediaStore.Video.Thumbnails.MINI_KIND,null):legacyThumbnail(uri,side,signal);}catch(Exception ignored){}
                final Bitmap result=thumb;
                activity.runOnUiThread(()->{
                    pendingThumbnails.remove(pendingKey);
                    if(!active(token,signal))return;
                    if(result!=null)cache.put(key,result);
                    if(photoGrid!=null)for(int i=0;i<photoGrid.getChildCount();i++){
                        View child=photoGrid.getChildAt(i);
                        if(!(child instanceof FrameLayout))continue;
                        ImageView current=(ImageView)((FrameLayout)child).getChildAt(0);
                        if(!key.equals(current.getTag()))continue;
                        if(result!=null)current.setImageBitmap(result);
                        else{current.setImageResource(android.R.drawable.ic_menu_report_image);current.setContentDescription("预览暂不可用，仍可轻点选择");}
                    }
                });
            });}catch(RejectedExecutionException ignored){pendingThumbnails.remove(pendingKey);/* Dismissal won the thumbnail scheduling race. */}
            return cell;
        }
    }

    private Bitmap legacyThumbnail(Uri uri,int size,CancellationSignal signal)throws Exception{
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        try(InputStream stream=activity.getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(stream,null,options);}
        if(signal.isCanceled())return null;
        int sample=1;while(options.outWidth/sample>size*2||options.outHeight/sample>size*2)sample*=2;
        options.inJustDecodeBounds=false;options.inSampleSize=sample;
        try(InputStream stream=activity.getContentResolver().openInputStream(uri)){return BitmapFactory.decodeStream(stream,null,options);}
    }

    private void finish(Runnable selected){
        if(closing||dialog==null||!dialog.isShowing())return;
        closing=true;stopWork();
        sheet.animate().cancel();backdrop.animate().cancel();
        final Dialog selectedDialog=dialog;
        backdrop.animate().alpha(0).setDuration(170).start();
        sheet.animate().translationY(sheet.getHeight()).setDuration(190).setInterpolator(new DecelerateInterpolator()).withEndAction(()->{
            if(!selectedDialog.isShowing())return;
            if(selected!=null&&!activity.isDestroyed()&&!activity.isFinishing()){delivered=true;selectedDialog.dismiss();selected.run();}
            else selectedDialog.dismiss();
        }).start();
    }
    private void stopWork(){
        if(resizeAnimation!=null){resizeAnimation.cancel();resizeAnimation=null;}
        invalidateLoad();
        if(workers!=null){workers.shutdownNow();workers=null;}
        if(queryWorker!=null){queryWorker.shutdownNow();queryWorker=null;}
        cache.evictAll();
        pendingThumbnails.clear();
    }
    private void invalidateLoad(){generation++;albumState.cancel();if(cancellation!=null){cancellation.cancel();cancellation=null;}}
    private int dp(float value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size,int color){TextView view=new TextView(activity);view.setText(value);view.setTextSize(size);view.setTextColor(color);view.setGravity(Gravity.CENTER_VERTICAL);return view;}
    private TextView button(String title,Runnable action){TextView view=text(title,14,ACCENT);view.setGravity(Gravity.CENTER);view.setPadding(dp(14),0,dp(14),0);view.setMinHeight(dp(44));view.setBackground(round(Color.TRANSPARENT,15));view.setOnClickListener(v->{if(!closing)action.run();});return view;}
    private GradientDrawable round(int color,float radius){GradientDrawable result=new GradientDrawable();result.setColor(color);result.setCornerRadius(dp(radius));return result;}
}
