package dev.shiye.app;

import android.graphics.Typeface;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.File;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.BackgroundColorSpan;
import android.text.style.ForegroundColorSpan;
import android.view.Gravity;
import android.view.View;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.view.inputmethod.EditorInfo;
import android.widget.*;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Locale;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Presentation of existing Entry summaries; never rewrites body, dates or identity. */
final class DiaryListPage {
    final MainActivity h;
    final LinearLayout page, categoryChips;
    LinearLayout searchBar;
    private JSONObject listAppearance;
    private boolean darkAppearance;
    private Bitmap wallpaper;
    private int wallpaperTicket;
    private String decodedWallpaperPath="",pendingWallpaperPath="";
    final ArrayList<JSONObject> entries = new ArrayList<>();
    final ListView list;
    final TextView count, emptyTitle, emptyHint;
    final BaseAdapter adapter;
    final int accent = MainActivity.ACCENT;
    TextView refreshStatus;
    EditText finder;
    TextView dateHeading, recordStatus;
    boolean pinning;
    private static final Pattern DATE_TOKEN=Pattern.compile("(?<![0-9])\\d{4}-\\d{2}-\\d{2}(?![0-9])");
    boolean refreshing;
    long lastRefresh;
    Runnable searchTask;
    int queryVersion, filterVersion;
    String displayedPositionKey;
    String catalogFingerprint, categoryFingerprint;
    private final int touchSlop;
    private boolean listGestureMoved;
    private boolean listTouchActive;
    void refresh(boolean explicit) {
        if(refreshing||(!explicit&&android.os.SystemClock.elapsedRealtime()-lastRefresh<1500&&h.catalog.toString().equals(catalogFingerprint)))return;
        refreshing=true;lastRefresh=android.os.SystemClock.elapsedRealtime();
        if(explicit)setRefreshStatus("正在刷新…");
        h.io.execute(()->{try{JSONObject value=h.store.dispatch(MainActivity.obj("op","bootstrap"));
            h.main.post(()->{refreshing=false;if(h.destroyed||h.diaryListPage!=this||!h.screen.equals("home")||h.tab!=0)return;
                boolean changed=!value.toString().equals(catalogFingerprint);
                if(changed){rememberPosition();boolean categoriesChanged=!categoryFingerprint.equals(String.valueOf(value.optJSONArray("categories")));
                    h.catalog=value;catalogFingerprint=value.toString();
                    if(categoriesChanged){h.renderHome();return;}
                    filter();
                    finishRefresh(explicit?"已更新":"");
                }
                else finishRefresh(explicit?"已是最新":"");
            });
        }catch(Exception error){h.main.post(()->{refreshing=false;if(h.diaryListPage!=this)return;finishRefresh("刷新未完成，可再次下拉");h.toast("刷新未完成，保留当前列表");});}});
    }
    DiaryListPage(MainActivity host) {
        h = host;
        touchSlop=ViewConfiguration.get(h).getScaledTouchSlop();
        catalogFingerprint=h.catalog.toString();categoryFingerprint=String.valueOf(h.catalog.optJSONArray("categories"));
        page = h.vertical();
        page.setBackgroundColor(0x00000000);

        LinearLayout content = h.vertical();
        h.pad(content, 20, 0);
        LinearLayout search = searchBar = h.horizontal();
        search.setBackground(h.shape(0xb3f4faff, 12));
        dateHeading=h.text(LocalDate.now(LocalStore.DIARY_TIME_ZONE).format(DateTimeFormatter.ofPattern("M月d日",Locale.CHINA))+" ▾",18,MainActivity.INK);
        dateHeading.setPadding(h.dp(12),0,0,0);dateHeading.setGravity(Gravity.CENTER_VERTICAL);dateHeading.setContentDescription("日期筛选，打开日历");dateHeading.setOnClickListener(v->showDateSearch());
        guardTouchClick(dateHeading);
        search.addView(dateHeading,new LinearLayout.LayoutParams(0,h.dp(44),1));
        finder = new EditText(h);
        finder.setSingleLine(true);
        finder.setTextSize(14);
        finder.setTextColor(MainActivity.INK);
        finder.setHintTextColor(0xff526c7c);
        finder.setHint("文字 / YYYY-MM-DD");
        finder.setContentDescription("搜索思绪");
        finder.setBackgroundColor(0x00000000);
        finder.setPadding(0, 0, h.dp(12), 0);
        finder.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        finder.setOnEditorActionListener((v, action, event) -> { h.hideKeyboard(); return true; });
        finder.setText(h.search);
        View searchIcon=h.icon("search", "搜索日记", this::showSearch);guardTouchClick(searchIcon);search.addView(searchIcon,h.lp(44,44));
        View menuIcon=h.icon("more", "设置", h::homeMenu);guardTouchClick(menuIcon);search.addView(menuIcon,h.lp(44,44));
        LinearLayout.LayoutParams searchLP = h.lp(-1, 44);
        searchLP.topMargin = h.dp(10);
        searchLP.bottomMargin = h.dp(10);
        content.addView(search, searchLP);
        finder.setPadding(h.dp(12),0,h.dp(12),0);finder.setBackground(h.shape(0xffedf5fa,10));
        finder.setVisibility(h.search.isEmpty()?View.GONE:View.VISIBLE);
        LinearLayout.LayoutParams finderLP=h.lp(-1,44);finderLP.bottomMargin=h.dp(8);content.addView(finder,finderLP);

        HorizontalScrollView scroll = new HorizontalScrollView(h);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout chips = categoryChips = h.horizontal();
        JSONArray categories = h.catalog.optJSONArray("categories");
        if(categories==null)categories=new JSONArray();
        boolean selectedExists=h.category.isEmpty();
        for(int i=0;i<categories.length();i++)if(MainActivity.at(categories,i).optString("id").equals(h.category))selectedExists=true;
        if(!selectedExists)h.category="";
        for (int i = 0; i <= categories.length(); i++) {
            final String id = i == 0 ? "" : MainActivity.at(categories, i - 1).optString("id");
            TextView chip = h.text(i == 0 ? "全部" : MainActivity.at(categories, i - 1).optString("name"), 12, h.category.equals(id) ? accent : MainActivity.MUTED);
            chip.setGravity(Gravity.CENTER);
            h.pad(chip, 15, 7);
            chip.setBackground(h.shape(h.category.equals(id) ? 0xcceaf5fc : 0x00000000, 18));
            chip.setSelected(h.category.equals(id));
            chip.setTag(id);
            chip.setOnClickListener(v -> { rememberPosition(); h.category = id; h.renderHome(); });
            guardTouchClick(chip);
            LinearLayout.LayoutParams chipLP = h.lp(-2, 36);
            chipLP.rightMargin = h.dp(5);
            chips.addView(chip, chipLP);
        }
        scroll.addView(chips);
        content.addView(scroll, h.lp(-1, 38));

        LinearLayout section = h.horizontal();
        TextView sectionTitle = recordStatus = h.text(streakLabel(), 12, MainActivity.MUTED);
        sectionTitle.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        section.addView(sectionTitle, new LinearLayout.LayoutParams(0, -2, 1));
        count = h.text("", 12, 0xff526c7c);
        section.addView(count);
        h.pad(section, 1, 11);
        content.addView(section);
        refreshStatus=h.text("",12,accent);refreshStatus.setGravity(Gravity.CENTER);refreshStatus.setVisibility(View.GONE);
        refreshStatus.setPadding(h.dp(12),0,h.dp(12),0);refreshStatus.setBackground(h.shape(0xf2edf7fd,14));refreshStatus.setElevation(h.dp(3));

        FrameLayout listArea = new FrameLayout(h);
        list = new ListView(h){
            final PullGesture pull=new PullGesture();
            float downX,downY;
            @Override public boolean onTouchEvent(MotionEvent event){
                int action=event.getActionMasked();
                if(action==MotionEvent.ACTION_DOWN){downX=event.getX();downY=event.getY();listGestureMoved=false;listTouchActive=true;}
                if(action==MotionEvent.ACTION_MOVE&&Math.hypot(event.getX()-downX,event.getY()-downY)>touchSlop)listGestureMoved=true;
                boolean top=getChildCount()==0||(getFirstVisiblePosition()==0&&getChildAt(0).getTop()>=getListPaddingTop());
                if(pull.touch(event,top)){
                    listGestureMoved=true;
                    if(event.getActionMasked()==MotionEvent.ACTION_MOVE){MotionEvent cancel=MotionEvent.obtain(event);cancel.setAction(MotionEvent.ACTION_CANCEL);super.onTouchEvent(cancel);cancel.recycle();}
                    if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL){
                        DiaryListPage.this.clearVisibleRowTouchState();
                        listTouchActive=false;post(DiaryListPage.this::clearVisibleRowTouchState);
                    }
                    return true;
                }
                boolean handled=super.onTouchEvent(event);
                if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL){
                    DiaryListPage.this.clearVisibleRowTouchState();
                    listTouchActive=false;post(DiaryListPage.this::clearVisibleRowTouchState);
                }
                return handled;
            }
        };
        list.setBackgroundColor(0x00000000);
        list.setCacheColorHint(0x00000000);
        list.setDivider(null);
        list.setSelector(new android.graphics.drawable.ColorDrawable(0x00000000));
        list.setChoiceMode(ListView.CHOICE_MODE_NONE);
        list.setClipToPadding(false);
        list.setPadding(0, 0, 0, h.dp(18));
        listArea.addView(list, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout empty = h.vertical();
        empty.setGravity(Gravity.CENTER);
        empty.addView(h.new Icon("book", 0xff6996ad), h.lp(56, 56));
        emptyTitle = h.text("", 17, MainActivity.INK);
        emptyTitle.setPadding(0, h.dp(15), 0, h.dp(7));
        empty.addView(emptyTitle);
        emptyHint = h.text("", 13, MainActivity.MUTED);
        emptyHint.setGravity(Gravity.CENTER);
        empty.addView(emptyHint);
        PullGesture emptyPull=new PullGesture();
        empty.setOnTouchListener((view,event)->{emptyPull.touch(event,true);return true;});
        listArea.addView(empty, new FrameLayout.LayoutParams(-1, -1));
        FrameLayout.LayoutParams statusLP=new FrameLayout.LayoutParams(-2,h.dp(28),Gravity.TOP|Gravity.CENTER_HORIZONTAL);statusLP.topMargin=h.dp(4);
        listArea.addView(refreshStatus,statusLP);
        list.setEmptyView(empty);
        page.addView(content, new LinearLayout.LayoutParams(-1, -2));
        page.addView(listArea, new LinearLayout.LayoutParams(-1, 0, 1));

        adapter = new BaseAdapter() {
            public int getCount() { return entries.size(); }
            public Object getItem(int p) { return entries.get(p); }
            public long getItemId(int p) { return entries.get(p).optString("id").hashCode(); }
            public View getView(int p, View old, android.view.ViewGroup parent) {
                LinearLayout item = h.vertical();
                JSONObject entry=entries.get(p);
                boolean pinned=entry.optBoolean("pinned");
                // Keep the whole pinned group legible over either a plain theme or wallpaper.
                item.setBackgroundColor(rowFill(pinned));
                if(p==0)addListDivider(item);
                String month = month(entry);
                if (!pinned && (p == 0 || entries.get(p-1).optBoolean("pinned") || !month.equals(month(entries.get(p - 1))))) {
                    TextView heading = h.text(month, 13, ink());
                    heading.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
                    heading.setPadding(h.dp(16), h.dp(p == 0 ? 7 : 15), h.dp(16), h.dp(6));
                    item.addView(heading);
                }
                item.addView(row(entries.get(p)));
                if(pinned && (p+1==entries.size() || !entries.get(p+1).optBoolean("pinned"))){
                    TextView boundary=h.text("置顶",12,muted());
                    boundary.setGravity(Gravity.CENTER_VERTICAL);
                    boundary.setPadding(h.dp(16),h.dp(9),h.dp(16),h.dp(9));
                    boundary.setBackgroundColor(0x00000000);
                    item.addView(boundary,new LinearLayout.LayoutParams(-1,-2));
                }
                addListDivider(item);
                return item;
            }
        };
        list.setAdapter(adapter);
        list.setOnItemClickListener((a, v, p, id) -> { if(listTouchActive&&listGestureMoved)return;rememberPosition(); h.openEditor(entries.get(p).optString("id"), true, false, searchContext()); });
        list.setOnItemLongClickListener((a, v, p, id) -> {
            if(listTouchActive&&listGestureMoved)return true;
            rememberPosition();
            JSONObject entry = entries.get(p);
            new android.app.AlertDialog.Builder(h).setTitle(entry.optString("title").isEmpty() ? "这篇日记" : entry.optString("title"))
                .setItems(new String[]{"打开阅读", "继续编辑", entry.optBoolean("pinned")?"取消置顶":"置顶", "删除这篇思绪"}, (dialog, which) -> {
                    if (which < 2) h.openEditor(entry.optString("id"), which == 0, false, searchContext());
                    else if(which==2)togglePinned(entry);
                    else new android.app.AlertDialog.Builder(h).setTitle("删除这篇思绪？")
                        .setMessage("这篇日记将保留删除标记，不影响其他记录。")
                        .setNegativeButton("取消", null).setPositiveButton("删除", (d, w) -> h.call(MainActivity.obj("op", "deleteEntry", "id", entry.optString("id")), result -> h.showHome())).show();
                }).show();
            return true;
        });
        finder.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) { rememberPosition(); }
            public void onTextChanged(CharSequence s, int start, int before, int count) { }
            public void afterTextChanged(Editable s) { h.search = s.toString();
                final int token=++queryVersion;final String query=h.search;
                if(searchTask!=null)h.main.removeCallbacks(searchTask);
                searchTask=()->{if(h.diaryListPage==DiaryListPage.this&&token==queryVersion&&query.equals(h.search)){searchTask=null;filter();}};h.main.postDelayed(searchTask,120);
            }
        });
        filter();
        applyAppearance(h.diaryListAppearance.current());
        h.scene(page, true);
    }
    private int ink(){return darkAppearance?0xffe9f3fb:MainActivity.INK;}
    private int secondary(){return darkAppearance?0xffd8e8f3:0xff243746;}
    private int muted(){return darkAppearance?0xffaac2d5:0xff526c7c;}
    private int rowFill(boolean pinned){
        int alpha=(int)Math.round(DiaryAppearance.listRowOpacity(listAppearance)*255/100);
        int surface=darkAppearance?0x0010283a:0x00f4fafe;
        int fill=(alpha<<24)|surface;
        if(!pinned)return fill;
        // The pinned veil remains independent, over the user-controlled row background.
        int veil=darkAppearance?0xd51b354a:0xb5a7c9dc;
        int veilAlpha=veil>>>24;
        int resultAlpha=255-(255-alpha)*(255-veilAlpha)/255;
        int result=resultAlpha<<24;
        for(int shift=0;shift<=16;shift+=8){
            int channel=(((veil>>shift)&255)*veilAlpha*255+((surface>>shift)&255)*alpha*(255-veilAlpha))/(resultAlpha*255);
            result|=channel<<shift;
        }
        return result;
    }
    private static final String LIST_DIVIDER_TAG="shiye-diary-list-divider";
    /** Adapter items touch: the first owns the only top cap and each owns one bottom boundary. */
    private void addListDivider(LinearLayout item) {
        View divider=new View(h);divider.setTag(LIST_DIVIDER_TAG);
        divider.setBackgroundColor(DiaryAppearance.listDividerArgb(listAppearance));
        item.addView(divider,new LinearLayout.LayoutParams(-1,Math.max(1,h.dp(1))));
    }
    private void updateVisibleDividerColors() {
        int color=DiaryAppearance.listDividerArgb(listAppearance);
        for(int i=0;i<list.getChildCount();i++){
            View item=list.getChildAt(i);
            if(!(item instanceof android.view.ViewGroup))continue;
            android.view.ViewGroup group=(android.view.ViewGroup)item;
            for(int j=0;j<group.getChildCount();j++){
                View child=group.getChildAt(j);
                if(LIST_DIVIDER_TAG.equals(child.getTag()))child.setBackgroundColor(color);
            }
        }
    }
    private void updateVisibleRowFills(){
        int first=list.getFirstVisiblePosition();
        for(int i=0;i<list.getChildCount();i++){
            int position=first+i;
            if(position>=0&&position<entries.size())list.getChildAt(i).setBackgroundColor(rowFill(entries.get(position).optBoolean("pinned")));
        }
    }
    /** Touch movement cancels an action, while performClick remains available to keyboard and accessibility. */
    private void guardTouchClick(View target){
        target.setOnTouchListener(new View.OnTouchListener(){
            float downX,downY;boolean moved;
            @Override public boolean onTouch(View view,MotionEvent event){
                int action=event.getActionMasked();
                if(action==MotionEvent.ACTION_DOWN){downX=event.getX();downY=event.getY();moved=false;return true;}
                if(action==MotionEvent.ACTION_MOVE){
                    if(Math.hypot(event.getX()-downX,event.getY()-downY)>touchSlop)moved=true;
                    if(moved)view.setPressed(false);
                    return true;
                }
                if(action==MotionEvent.ACTION_UP){
                    boolean tap=!moved&&Math.hypot(event.getX()-downX,event.getY()-downY)<=touchSlop&&
                        event.getX()>=0&&event.getY()>=0&&event.getX()<view.getWidth()&&event.getY()<view.getHeight();
                    view.setPressed(false);view.setHovered(false);moved=false;
                    if(tap)view.performClick();
                    return true;
                }
                if(action==MotionEvent.ACTION_CANCEL){view.setPressed(false);view.setHovered(false);moved=false;return true;}
                return false;
            }
        });
    }
    private void clearVisibleRowTouchState(){
        list.setPressed(false);list.setHovered(false);list.clearChoices();
        for(int i=0;i<list.getChildCount();i++)clearRowTouchState(list.getChildAt(i));
    }
    private void clearRowTouchState(View view){
        view.setPressed(false);view.setHovered(false);view.setSelected(false);view.setActivated(false);
        if(view instanceof android.view.ViewGroup){
            android.view.ViewGroup group=(android.view.ViewGroup)view;
            for(int i=0;i<group.getChildCount();i++)clearRowTouchState(group.getChildAt(i));
        }
    }
    void applyAppearance(JSONObject value) {
        try{listAppearance=new JSONObject(value.toString());}catch(Exception e){h.error(e);return;}
        boolean themeChanged=darkAppearance!="dark".equals(value.optString("theme"));
        darkAppearance="dark".equals(value.optString("theme"));
        updateVisibleRowFills();
        updateVisibleDividerColors();
        File file=wallpaperFile(value);
        final String path=file==null?"":file.getAbsolutePath();
        paintWallpaper(path);
        searchBar.setBackground(h.shape(darkAppearance?0xd9233b50:0xb3f4faff,12));
        dateHeading.setTextColor(ink());finder.setTextColor(ink());finder.setHintTextColor(muted());
        finder.setBackground(h.shape(darkAppearance?0xd9233b50:0xccedf5fa,10));
        count.setTextColor(muted());recordStatus.setTextColor(muted());
        emptyTitle.setTextColor(ink());emptyHint.setTextColor(muted());
        refreshStatus.setTextColor(darkAppearance?0xffaaddff:accent);
        refreshStatus.setBackground(h.shape(darkAppearance?0xf228455b:0xf2edf7fd,14));
        for(int i=0;i<searchBar.getChildCount();i++)if(searchBar.getChildAt(i) instanceof MainActivity.Icon){
            MainActivity.Icon icon=(MainActivity.Icon)searchBar.getChildAt(i);icon.color=darkAppearance?0xffaaddff:accent;icon.invalidate();
        }
        for(int i=0;i<categoryChips.getChildCount();i++){
            TextView chip=(TextView)categoryChips.getChildAt(i);boolean selected=chip.isSelected();
            chip.setTextColor(selected?(darkAppearance?0xffb1ddfa:accent):muted());
            chip.setBackground(h.shape(selected?(darkAppearance?0xcc2d506b:0xcceaf5fc):0x00000000,18));
        }
        if(themeChanged)adapter.notifyDataSetChanged();
        // Changing opacity/fill/veil for the same source reuses the decoded bitmap.
        if(!path.isEmpty()&&!path.equals(decodedWallpaperPath)&&!path.equals(pendingWallpaperPath)){
            pendingWallpaperPath=path;
            final int ticket=++wallpaperTicket;
            h.io.execute(()->{
                Bitmap decoded=null;
                try{
                    BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(path,bounds);
                    if(bounds.outWidth>0&&bounds.outHeight>0){
                        BitmapFactory.Options options=new BitmapFactory.Options();int sample=1;
                        while(Math.max(bounds.outWidth,bounds.outHeight)/sample>2048)sample*=2;
                        options.inSampleSize=sample;decoded=BitmapFactory.decodeFile(path,options);
                    }
                }catch(Exception|OutOfMemoryError failure){/* Keep the original and show the safe base color. */}
                final Bitmap ready=decoded;
                h.main.post(()->{
                    if(ticket!=wallpaperTicket||h.destroyed||listAppearance==null){if(ready!=null)ready.recycle();return;}
                    if(path.equals(pendingWallpaperPath))pendingWallpaperPath="";
                    File wanted=wallpaperFile(listAppearance);
                    if(wanted==null||!path.equals(wanted.getAbsolutePath())){if(ready!=null)ready.recycle();return;}
                    decodedWallpaperPath=path;wallpaper=ready;paintWallpaper(path);
                    if(ready==null&&h.diaryListPage==this&&h.screen.equals("home"))h.toast("壁纸未能显示，原文件已保留");
                });
            });
        }
    }
    private File wallpaperFile(JSONObject value){
        JSONObject b=value.optJSONObject("background");
        return "custom".equals(value.optString("backgroundMode"))&&b!=null?h.diaryListAppearance.fileForPath(b.optString("url")):null;
    }
    private void paintWallpaper(String path){
        if(h.diaryListPage==this&&h.screen.equals("home")&&h.tab==0)h.updateSystemBars();
    }
    NativeWallpaperDrawable wallpaperBackdrop(){
        if(listAppearance==null)return new NativeWallpaperDrawable(new JSONObject(),null);
        File file=wallpaperFile(listAppearance);
        String path=file==null?"":file.getAbsolutePath();
        return new NativeWallpaperDrawable(listAppearance,path.equals(decodedWallpaperPath)?wallpaper:null);
    }
    void retryStartupWallpaper(){
        ++wallpaperTicket;pendingWallpaperPath="";decodedWallpaperPath="";
        applyAppearance(h.diaryListAppearance.current());
    }
    void useStartupWallpaperFallback(){
        ++wallpaperTicket;pendingWallpaperPath="";
        File file=listAppearance==null?null:wallpaperFile(listAppearance);
        decodedWallpaperPath=file==null?"":file.getAbsolutePath();wallpaper=null;
        h.updateSystemBars();h.toast("列表壁纸暂未显示，原文件已保留，可在设置重试");
    }
    boolean wallpaperReady(){
        File file=listAppearance==null?null:wallpaperFile(listAppearance);
        return file==null||file.getAbsolutePath().equals(decodedWallpaperPath);
    }
    /** Reattach cached local UI immediately; the host schedules its one background refresh. */
    public void attach(){
        applyAppearance(h.diaryListAppearance.current());
        h.scene(page,true);
        if(!positionKey().equals(displayedPositionKey)){
            rememberPosition();
            if(!finder.getText().toString().equals(h.search))finder.setText(h.search);
            if(searchTask!=null){h.main.removeCallbacks(searchTask);searchTask=null;}
            for(int i=0;i<categoryChips.getChildCount();i++){
                TextView chip=(TextView)categoryChips.getChildAt(i);
                boolean selected=h.category.equals(chip.getTag());
                chip.setSelected(selected);chip.setTextColor(selected?(darkAppearance?0xffb1ddfa:accent):muted());chip.setBackground(h.shape(selected?(darkAppearance?0xcc2d506b:0xcceaf5fc):0x00000000,18));
            }
            filter();
        }
    }
    /** Changed category labels/order/identity require rebuilding the chip presentation. */
    public boolean compatibleCatalog(){return categoryFingerprint.equals(String.valueOf(h.catalog.optJSONArray("categories")));}
    String positionKey() { return "diary-list:" + h.category + ":" + h.search; }
    /** Only navigation context. The original filter and its cached result order remain authoritative. */
    String searchContext() {
        String needle=h.search.trim().toLowerCase(Locale.ROOT);
        if(needle.isEmpty())return "";
        Matcher dates=DATE_TOKEN.matcher(needle);
        String day=dates.find()?dates.group():"";
        String words=day.isEmpty()?needle:needle.replace(day,"").trim();
        JSONObject context=new JSONObject();JSONArray terms=new JSONArray();boolean limited=h.search.length()>1024;int budget=2048;
        for(String word:words.split("\\s+"))if(!word.isEmpty()){
            if(terms.length()>=24||word.length()>budget){limited=true;break;}
            terms.put(word);budget-=word.length();
        }
        try{context.put("q",h.search.length()>1024?h.search.substring(0,1024):h.search);
            context.put("d",day);context.put("w",terms);
            context.put("limited",limited);
        }catch(org.json.JSONException ignored){}
        return context.toString();
    }
    void rememberPosition() {
        int position = list.getFirstVisiblePosition();
        if (position >= 0 && position < entries.size() && list.getChildCount() > 0)
            h.anchors.put(displayedPositionKey==null?positionKey():displayedPositionKey, new MainActivity.Anchor(entries.get(position).optString("id"), list.getChildAt(0).getTop(), false));
    }
    void filter() {
        entries.clear();
        String needle = h.search.trim().toLowerCase(Locale.ROOT);
        JSONArray source = h.catalog.optJSONArray("entries");
        if(source==null)source=new JSONArray();
        Matcher dates=DATE_TOKEN.matcher(needle);
        String exactDay=dates.find()?dates.group():"";
        String words=exactDay.isEmpty()?needle:needle.replace(exactDay,"").trim();
        for (int i = 0; i < source.length(); i++) {
            JSONObject entry = MainActivity.at(source, i);
            String haystack = entry.optString("title") + " " + entry.optString("searchText") + " " + entry.optString("preview") + " " + entry.optJSONArray("tags")+" "+dayKey(entry.optString("date"));
            if ((h.category.isEmpty() || h.category.equals(entry.optString("categoryId")))) {
                boolean matches=exactDay.isEmpty()||exactDay.equals(dayKey(entry.optString("date")));
                String text=haystack.toLowerCase(Locale.ROOT);
                for(String word:words.split("\\s+"))if(!word.isEmpty()&&!text.contains(word))matches=false;
                if(matches)entries.add(entry);
            }
        }
        // Creation order is stable across later edits; pin grouping stays independent.
        entries.sort((a,b)->{int pin=Boolean.compare(b.optBoolean("pinned"),a.optBoolean("pinned"));if(pin!=0)return pin;int created=b.optString("createdAt").compareTo(a.optString("createdAt"));return created!=0?created:a.optString("id").compareTo(b.optString("id"));});
        count.setText(entries.size() + " 篇");
        recordStatus.setText(streakLabel());
        dateHeading.setText(exactDay.isEmpty()?LocalDate.now(LocalStore.DIARY_TIME_ZONE).format(DateTimeFormatter.ofPattern("M月d日",Locale.CHINA))+" ▾":exactDay+" ▾");
        boolean filtered = !needle.isEmpty() || !h.category.isEmpty();
        emptyTitle.setText(filtered ? "没有找到日记" : "还没有日记");
        emptyHint.setText(filtered ? "试试其他关键词、日期或分类\n下拉可刷新" : "点底部“写日记”，开始记录今天\n下拉可刷新");
        adapter.notifyDataSetChanged();
        displayedPositionKey=positionKey();
        restorePosition(displayedPositionKey,queryVersion,++filterVersion);
    }
    void restorePosition(String key,int queryToken,int filterToken){
        MainActivity.Anchor anchor=h.anchors.get(key);
        int found=-1;
        if(anchor!=null)for(int i=0;i<entries.size();i++)if(entries.get(i).optString("id").equals(anchor.id)){found=i;break;}
        final int position=found,offset=found<0?0:anchor.offset;
        list.post(()->{
            if(h.destroyed||h.diaryListPage!=this||queryToken!=queryVersion||filterToken!=filterVersion||!key.equals(positionKey()))return;
            if(position>=0)list.setSelectionFromTop(position,offset);else list.setSelection(0);
        });
    }
    String month(JSONObject entry) {
        try { return LocalDate.parse(dayKey(entry.optString("date"))).format(DateTimeFormatter.ofPattern("yyyy 年 M 月", Locale.CHINA)); }
        catch (Exception ignored) { return "日期未定"; }
    }
    public void showSearch(){
        boolean show=finder.getVisibility()!=View.VISIBLE;
        finder.setVisibility(show?View.VISIBLE:View.GONE);
        if(show){finder.requestFocus();finder.setSelection(finder.length());finder.post(()->{
            if(h.diaryListPage==this&&!h.destroyed)((android.view.inputmethod.InputMethodManager)h.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).showSoftInput(finder,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
        });}else h.hideKeyboard();
    }
    void showDateSearch(){
        h.hideKeyboard();
        LocalDate initial=LocalDate.now(LocalStore.DIARY_TIME_ZONE);Matcher match=DATE_TOKEN.matcher(h.search);
        if(match.find())try{initial=LocalDate.parse(match.group());}catch(Exception ignored){}
        final LocalDate selectedDay=initial;
        Set<LocalDate> marked=calendarDates();
        YearMonth[] shown={YearMonth.from(initial)};
        LinearLayout panel=h.vertical();panel.setPadding(h.dp(12),h.dp(8),h.dp(12),h.dp(8));
        LinearLayout heading=h.horizontal();heading.setGravity(Gravity.CENTER_VERTICAL);
        TextView previous=calendarControl("‹",()->{}),monthTitle=calendarControl("",()->{}),next=calendarControl("›",()->{});
        heading.addView(previous,new LinearLayout.LayoutParams(h.dp(48),h.dp(48)));
        heading.addView(monthTitle,new LinearLayout.LayoutParams(0,h.dp(48),1));
        heading.addView(next,new LinearLayout.LayoutParams(h.dp(48),h.dp(48)));
        panel.addView(heading);
        LinearLayout weekdays=h.horizontal();
        for(String name:new String[]{"一","二","三","四","五","六","日"}){
            TextView day=h.text(name,12,muted());day.setGravity(Gravity.CENTER);
            weekdays.addView(day,new LinearLayout.LayoutParams(0,h.dp(32),1));
        }
        panel.addView(weekdays);
        LinearLayout days=h.vertical();panel.addView(days);
        android.app.AlertDialog picker=new android.app.AlertDialog.Builder(h).setView(panel)
            .setNeutralButton("清除日期",(d,w)->setSearchDate(""))
            .setNegativeButton("取消",null).create();
        Runnable draw=()->{
            YearMonth month=shown[0];monthTitle.setText(month.getYear()+" 年 "+month.getMonthValue()+" 月  ▾");
            days.removeAllViews();int first=month.atDay(1).getDayOfWeek().getValue()-1;
            int rows=(first+month.lengthOfMonth()+6)/7;
            for(int week=0;week<rows;week++){
                LinearLayout line=h.horizontal();
                for(int column=0;column<7;column++){
                    int day=week*7+column-first;
                    TextView cell=h.text(day>=0&&day<month.lengthOfMonth()?String.valueOf(day+1):"",14,ink());
                    cell.setGravity(Gravity.CENTER);
                    FrameLayout holder=new FrameLayout(h);
                    FrameLayout.LayoutParams circle=new FrameLayout.LayoutParams(h.dp(36),h.dp(36),Gravity.CENTER);
                    holder.addView(cell,circle);
                    if(day>=0&&day<month.lengthOfMonth()){
                        LocalDate value=month.atDay(day+1);
                        if(marked.contains(value)){
                            GradientDrawable marker=new GradientDrawable();marker.setShape(GradientDrawable.OVAL);
                            marker.setColor(darkAppearance?0xff345d79:0xffd7efff);cell.setBackground(marker);
                        }
                        if(value.equals(selectedDay))cell.setTextColor(darkAppearance?0xffaaddff:accent);
                        cell.setContentDescription(value+ (marked.contains(value)?"，有日记":""));
                        cell.setOnClickListener(v->{setSearchDate(value.toString());picker.dismiss();});
                        guardTouchClick(cell);
                    }
                    LinearLayout.LayoutParams cellLP=new LinearLayout.LayoutParams(0,h.dp(42),1);
                    cellLP.setMargins(h.dp(2),h.dp(2),h.dp(2),h.dp(2));line.addView(holder,cellLP);
                }
                days.addView(line);
            }
        };
        previous.setOnClickListener(v->{if(shown[0].getYear()>1){shown[0]=shown[0].minusMonths(1);draw.run();}});
        next.setOnClickListener(v->{if(shown[0].getYear()<9999){shown[0]=shown[0].plusMonths(1);draw.run();}});
        monthTitle.setOnClickListener(v->{
            LinearLayout controls=h.horizontal();controls.setPadding(h.dp(14),h.dp(8),h.dp(14),h.dp(8));
            NumberPicker year=new NumberPicker(h),month=new NumberPicker(h);
            year.setMinValue(1);year.setMaxValue(9999);year.setValue(shown[0].getYear());
            month.setMinValue(1);month.setMaxValue(12);month.setValue(shown[0].getMonthValue());
            controls.addView(year,new LinearLayout.LayoutParams(0,h.dp(180),1));
            controls.addView(month,new LinearLayout.LayoutParams(0,h.dp(180),1));
            new android.app.AlertDialog.Builder(h).setTitle("选择年月").setView(controls)
                .setNegativeButton("取消",null).setPositiveButton("确定",(d,w)->{year.clearFocus();month.clearFocus();shown[0]=YearMonth.of(year.getValue(),month.getValue());draw.run();}).show();
        });
        draw.run();picker.show();
    }
    private TextView calendarControl(String label,Runnable action){
        TextView control=h.text(label,17,ink());control.setGravity(Gravity.CENTER);
        control.setOnClickListener(v->action.run());guardTouchClick(control);return control;
    }
    /** The marks use the same real catalog and non-date filters as the list. */
    private Set<LocalDate> calendarDates(){
        Set<LocalDate> dates=new HashSet<>();
        JSONArray source=h.catalog.optJSONArray("entries");if(source==null)return dates;
        String words=DATE_TOKEN.matcher(h.search.trim().toLowerCase(Locale.ROOT)).replaceAll("").trim();
        for(int i=0;i<source.length();i++){
            JSONObject entry=MainActivity.at(source,i);
            if(!h.category.isEmpty()&&!h.category.equals(entry.optString("categoryId")))continue;
            String haystack=(entry.optString("title")+" "+entry.optString("searchText")+" "+entry.optString("preview")+" "+entry.optJSONArray("tags")+" "+dayKey(entry.optString("date"))).toLowerCase(Locale.ROOT);
            boolean matches=true;for(String word:words.split("\\s+"))if(!word.isEmpty()&&!haystack.contains(word))matches=false;
            String date=dayKey(entry.optString("date"));
            if(matches&&!date.isEmpty())dates.add(LocalDate.parse(date));
        }
        return dates;
    }
    void setSearchDate(String date){
        String words=DATE_TOKEN.matcher(h.search).replaceAll("").trim();
        finder.setText((words+" "+date).trim());finder.setSelection(finder.length());
        if(searchTask!=null){h.main.removeCallbacks(searchTask);searchTask=null;}
        // Selecting a date reveals the active filter; collapsing it preserves that selection.
        finder.setVisibility(View.VISIBLE);h.hideKeyboard();filter();
    }
    static String dayKey(String raw){
        if(raw==null||raw.length()<10)return "";
        try{
            if(raw.matches("\\d{4}-\\d{2}-\\d{2}"))return LocalDate.parse(raw).toString();
            return java.time.Instant.parse(raw).atZone(LocalStore.DIARY_TIME_ZONE).toLocalDate().toString();
        }catch(Exception ignored){return "";}
    }
    static int currentStreak(Set<LocalDate> dates,LocalDate today){
        LocalDate end=dates.contains(today)?today:today.minusDays(1);
        int count=0;while(dates.contains(end)){count++;end=end.minusDays(1);}return count;
    }
    String streakLabel(){
        Set<LocalDate> days=new HashSet<>();JSONArray source=h.catalog.optJSONArray("entries");
        if(source!=null)for(int i=0;i<source.length();i++){
            String day=dayKey(MainActivity.at(source,i).optString("date"));if(!day.isEmpty())days.add(LocalDate.parse(day));
        }
        int streak=currentStreak(days,LocalDate.now(LocalStore.DIARY_TIME_ZONE));return streak>0?"连续记录 "+streak+" 天":"随时记下此刻";
    }
    void togglePinned(JSONObject entry){
        if(pinning){h.toast("正在保存置顶状态");return;}pinning=true;
        JSONObject request=MainActivity.obj("op","setEntryPinned","id",entry.optString("id"),"baseRevision",entry.optLong("revision"),"pinned",!entry.optBoolean("pinned"));
        h.io.execute(()->{try{
            h.store.dispatch(request);
            h.main.post(()->{pinning=false;if(h.diaryListPage==this&&!h.destroyed){refresh(true);}});
        }catch(Exception failure){h.main.post(()->{pinning=false;if(h.diaryListPage==this&&!h.destroyed){h.error(failure);refresh(false);}});}});
    }
    void setRefreshStatus(String value){refreshStatus.setText(value);refreshStatus.setVisibility(value.isEmpty()?View.GONE:View.VISIBLE);}
    void finishRefresh(String value){
        setRefreshStatus(value);
        if(!value.isEmpty())h.main.postDelayed(()->{if(h.diaryListPage==this&&!refreshing)setRefreshStatus("");},1500);
    }
    final class PullGesture {
        float startY,startX;boolean eligible,pulling,ready;
        boolean touch(MotionEvent event,boolean top){
            int action=event.getActionMasked();
            if(action==MotionEvent.ACTION_DOWN){startY=event.getY();startX=event.getX();eligible=top&&!refreshing;pulling=ready=false;return false;}
            if(action==MotionEvent.ACTION_MOVE&&eligible){
                float delta=event.getY()-startY;
                if(!pulling&&Math.abs(event.getX()-startX)>h.dp(22)){eligible=false;return false;}
                if(delta>h.dp(14)&&(top||pulling)){pulling=true;ready=delta>=h.dp(68);setRefreshStatus(ready?"松开刷新":"下拉刷新");return true;}
                if(pulling){ready=false;setRefreshStatus("下拉刷新");return true;}
            }
            if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL){
                boolean consumed=pulling,refresh=ready&&action==MotionEvent.ACTION_UP;
                pulling=ready=eligible=false;
                if(consumed){if(refresh)DiaryListPage.this.refresh(true);else setRefreshStatus("");}return consumed;
            }
            return pulling;
        }
    }
    View row(JSONObject entry) {
        LinearLayout outer = h.vertical();
        LinearLayout words = h.vertical();
        words.setPadding(h.dp(16),h.dp(15),h.dp(16),h.dp(15));
        words.setBackgroundColor(0x00000000);
        String name=entry.optString("title").trim();
        if(!name.isEmpty()){
            TextView title=h.text(name,18,ink());h.bold(title);title.setText(highlight(name,visibleWords()));
            title.setMaxLines(2);title.setEllipsize(TextUtils.TruncateAt.END);words.addView(title);
        }
        String preview = entry.optString("preview").trim();
        if (!preview.isEmpty()) {
            TextView summary = h.text(preview, 14, secondary());summary.setText(highlight(preview,visibleWords()));
            summary.setMaxLines(4); summary.setEllipsize(TextUtils.TruncateAt.END);
            summary.setLineSpacing(h.dp(3), 1);
            summary.setPadding(0,name.isEmpty()?0:h.dp(6),0,h.dp(11));
            words.addView(summary);
        }else if(name.isEmpty()){
            TextView placeholder=h.text("打开查看这篇日记",14,muted());placeholder.setPadding(0,0,0,h.dp(10));words.addView(placeholder);
        }
        ArrayList<String> fields=new ArrayList<>();
        String date=dayKey(entry.optString("date"));
        if(!date.isEmpty()){
            fields.add(date);
            fields.add(LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEE",Locale.CHINA)));
        }else fields.add("日期未定");
        String rawDate=entry.optString("date");
        if(rawDate.length()>=16&&(rawDate.charAt(10)=='T'||rawDate.charAt(10)==' ')){
            String time=rawDate.substring(11,16);
            try{java.time.LocalTime.parse(time);fields.add(time);}catch(Exception ignored){}
        }else{
            // A date-only entry has no event time. Label creation time explicitly instead.
            String created=h.clock(entry.optString("createdAt"));
            if(!created.isEmpty())fields.add("创建 "+created);
        }
        String category=entry.optString("category");if(!category.isEmpty()&&!category.equals("null"))fields.add(category);
        // Only consume an explicit existing metadata string; never infer location from body or device.
        Object location=entry.opt("location"),placeValue=entry.opt("place");
        String place=location instanceof String?(String)location:placeValue instanceof String?(String)placeValue:"";
        if(!place.trim().isEmpty())fields.add(place.trim());
        JSONArray tags = entry.optJSONArray("tags");
        if (tags != null && tags.length() > 0) fields.add("#"+tags.optString(0));
        TextView meta = h.text(TextUtils.join(" · ",fields), 11, muted());
        meta.setText(highlight(meta.getText().toString(),visibleWords()));
        if (preview.isEmpty()) meta.setPadding(0, h.dp(10), 0, 0);
        meta.setSingleLine(true);meta.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(meta);
        // The row truncates title/preview; terms after the visible prefix need
        // their own short highlighted excerpt instead of an invisible span.
        String visible=name.substring(0,Math.min(32,name.length()))+" "+preview.substring(0,Math.min(64,preview.length()))+" "+date;
        for(String word:visibleWords())if(!visible.toLowerCase(Locale.ROOT).contains(word)){
            String source=entry.optString("searchText");
            if(!source.toLowerCase(Locale.ROOT).contains(word))source=preview;
            int found=source.toLowerCase(Locale.ROOT).indexOf(word);
            String hint;
            if(found>=0){int original=0,folded=0;
                while(original<source.length()&&folded<found){int code=source.codePointAt(original);folded+=new String(Character.toChars(code)).toLowerCase(Locale.ROOT).length();original+=Character.charCount(code);}
                int start=Math.max(0,original-20),end=Math.min(source.length(),original+word.length()+28);
                hint=(start>0?"…":"")+source.substring(start,end)+(end<source.length()?"…":"");}
            else {JSONArray all=entry.optJSONArray("tags");hint=name.toLowerCase(Locale.ROOT).contains(word)?"匹配标题："+word:"匹配标签："+word;
                if(all!=null)for(int i=0;i<all.length();i++)if(all.optString(i).toLowerCase(Locale.ROOT).contains(word)){hint="匹配标签：#"+all.optString(i);break;}}
            TextView match=h.text(hint,12,secondary());match.setText(highlight(hint,visibleWords()));
            match.setMaxLines(2);match.setEllipsize(TextUtils.TruncateAt.END);match.setPadding(0,h.dp(5),0,0);words.addView(match);
            visible += " "+hint;
        }
        outer.addView(words,new LinearLayout.LayoutParams(-1,-2));
        outer.setContentDescription("思绪："+(name.isEmpty()?"日记摘要":name)+(entry.optBoolean("pinned")?"，已置顶":""));
        return outer;
    }
    ArrayList<String> visibleWords(){
        String needle=h.search.trim().toLowerCase(Locale.ROOT);Matcher dates=DATE_TOKEN.matcher(needle);
        String day=dates.find()?dates.group():"";
        String words=day.isEmpty()?needle:needle.replace(day,"").trim();
        ArrayList<String> result=new ArrayList<>();
        for(String word:words.split("\\s+"))if(!word.isEmpty()&&!result.contains(word))result.add(word);
        if(!day.isEmpty())result.add(day);
        return result;
    }
    CharSequence highlight(String source,ArrayList<String> words){
        SpannableString result=new SpannableString(source);StringBuilder folded=new StringBuilder();
        ArrayList<Integer> starts=new ArrayList<>(),ends=new ArrayList<>();
        for(int at=0;at<source.length();){int code=source.codePointAt(at),end=at+Character.charCount(code);
            String lower=new String(Character.toChars(code)).toLowerCase(Locale.ROOT);
            folded.append(lower);for(int i=0;i<lower.length();i++){starts.add(at);ends.add(end);}at=end;
        }
        for(String word:words){if(word.isEmpty())continue;int scan=0,found;
            while((found=folded.indexOf(word,scan))>=0){int from=starts.get(found),to=ends.get(found+word.length()-1);
                result.setSpan(new BackgroundColorSpan(darkAppearance?0xff705b27:0xffffdf87),from,to,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                result.setSpan(new ForegroundColorSpan(darkAppearance?0xffffffff:0xff352709),from,to,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                scan=found+word.length();
            }
        }
        return result;
    }
}
