package dev.shiye.app;

import android.app.AlertDialog;
import android.text.InputFilter;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.Gravity;
import android.view.View;
import android.view.DragEvent;
import android.view.WindowManager;
import android.widget.*;
import java.util.ArrayList;
import java.util.Locale;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native settings navigation. Content operations remain LocalStore transactions. */
final class AppSettings {
    /** Keep the platform dialog title/actions fixed while only the settings page scrolls. */
    private static final class SettingsScroll extends ScrollView {
        SettingsScroll(MainActivity host){super(host);}
        @Override protected void onMeasure(int widthSpec,int heightSpec){
            android.util.DisplayMetrics metrics=getResources().getDisplayMetrics();
            int cap=Math.max((int)(160*metrics.density),Math.min((int)(metrics.heightPixels*.68f),
                    metrics.heightPixels-(int)(168*metrics.density)));
            int size=View.MeasureSpec.getMode(heightSpec)==View.MeasureSpec.UNSPECIFIED?cap:
                    Math.min(cap,View.MeasureSpec.getSize(heightSpec));
            super.onMeasure(widthSpec,View.MeasureSpec.makeMeasureSpec(size,View.MeasureSpec.AT_MOST));
        }
    }
    private final MainActivity h;
    private AlertDialog dialog;
    private LinearLayout page;
    private String location="root";
    private Runnable closeCallback;
    private boolean categoriesOnly,busy;
    private boolean pauseOnDismiss,resumeOnOpen;
    private int pausedScrollY;
    private JSONObject catalog=new JSONObject();
    private final ArrayList<JSONObject> orderDraft=new ArrayList<>();
    private long orderBaseRevision;
    private String orderBase="",orderQuery="";
    private int orderSelected;
    private LinearLayout orderRows;
    private ScrollView settingsScroll;
    private boolean categoriesLoaded;
    private String defaultCategoryId="";
    private int dragScrollDirection;
    private final Runnable dragScrollTick=new Runnable(){public void run(){
        if(orderDrag==null||settingsScroll==null||dragScrollDirection==0)return;
        settingsScroll.scrollBy(0,h.dp(10)*dragScrollDirection);h.main.postDelayed(this,32);
    }};
    private long orderGeneration;
    private OrderDrag orderDrag;
    private static final class OrderDrag {
        final String id;
        final long generation;
        final View source;
        final AlertDialog owner;
        OrderDrag(String categoryId,long session,View row,AlertDialog dialog){id=categoryId;generation=session;source=row;owner=dialog;}
    }

    AppSettings(MainActivity host){h=host;}
    void themeChanged(){if(dialog!=null)h.appTheme.tintDialog(dialog);}

    void show(){open(false,()->{if(h.screen.equals("home")&&h.tab==0&&h.diaryListPage!=null)h.diaryListPage.refresh(false);});}

    void show(Runnable callback){open(false,callback);}

    /** Module navigation hides settings and keeps an uncommitted local draft for explicit reopen. */
    void dismissForModuleChange(){
        if(dialog!=null&&dialog.isShowing()){
            pausedScrollY=settingsScroll==null?0:settingsScroll.getScrollY();
            pauseOnDismiss=true;dialog.dismiss();
        }
    }

    /** Fires once when the outer category manager closes, never for its child dialogs. */
    void showCategories(Runnable callback){open(true,callback);}

    private void open(boolean only,Runnable callback){
        if(dialog!=null&&dialog.isShowing())return;
        boolean resume=resumeOnOpen&&categoriesOnly==only;
        resumeOnOpen=false;categoriesOnly=only;closeCallback=callback;
        if(!resume){categoriesLoaded=false;location=only?"categories":"root";pausedScrollY=0;}
        ScrollView scroll=settingsScroll=new SettingsScroll(h);scroll.setFillViewport(true);
        scroll.setOnDragListener((view,event)->{
            if(!ownsOrderDrag(event))return false;
            if(event.getAction()==DragEvent.ACTION_DRAG_STARTED)return true;
            if(event.getAction()==DragEvent.ACTION_DRAG_LOCATION){updateDragScroll(event.getY());return true;}
            if(event.getAction()==DragEvent.ACTION_DRAG_EXITED){stopDragScroll();return true;}
            if(event.getAction()==DragEvent.ACTION_DRAG_ENDED){cancelOrderDrag();renderOrderRows();return true;}
            return false;
        });
        page=h.vertical();h.pad(page,20,10);scroll.addView(page);
        dialog=new AlertDialog.Builder(h).setTitle(only?"分类管理":"设置").setView(scroll).setNegativeButton("关闭",null).setPositiveButton("保存排序",null).create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnKeyListener((d,key,event)->{if(key!=KeyEvent.KEYCODE_BACK)return false;if(event.getAction()==KeyEvent.ACTION_UP)back();return true;});
        dialog.setOnDismissListener(d->{cancelOrderDrag();resumeOnOpen=pauseOnDismiss;pauseOnDismiss=false;Runnable done=closeCallback;closeCallback=null;dialog=null;if(done!=null&&!h.destroyed)done.run();});
        dialog.setOnShowListener(d->{
            dialog.getWindow().setGravity(Gravity.CENTER);
            dialog.getWindow().setLayout(Math.min(h.getResources().getDisplayMetrics().widthPixels-h.dp(32),h.dp(560)),WindowManager.LayoutParams.WRAP_CONTENT);
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setMinHeight(h.dp(44));
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setMinHeight(h.dp(44));
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener(v->back());render();themeChanged();
            if(resume)scroll.post(()->scroll.scrollTo(0,pausedScrollY));
        });
        dialog.show();
    }

    private void back(){
        if(busy)return;
        cancelOrderDrag();
        if(location.equals("order")||location.equals("categories")){
            if(!orderIds().toString().equals(orderBase))new AlertDialog.Builder(h).setTitle("放弃未保存的排序？")
                    .setMessage("调整仅在草稿中，保存前不会改变分类顺序。").setNegativeButton("继续调整",null)
                    .setPositiveButton("放弃",(d,n)->leaveCategories()).show();
            else leaveCategories();return;
        }
        if(location.equals("root")||(categoriesOnly&&location.equals("categories"))){dialog.dismiss();return;}
        location=location.equals("categories")?"writing":"root";render();
    }
    private void leaveCategories(){categoriesLoaded=false;if(categoriesOnly)dialog.dismiss();else{location="writing";render();}}

    private void begin(String title){
        page.removeAllViews();dialog.setTitle(title);
        Button save=dialog.getButton(AlertDialog.BUTTON_POSITIVE);save.setVisibility(location.equals("order")||location.equals("categories")?View.VISIBLE:View.GONE);
        save.setEnabled(categoriesLoaded&&!orderIds().toString().equals(orderBase));
        save.setOnClickListener(v->{if(orderDraft.isEmpty())return;cancelOrderDrag();run(MainActivity.obj("op","saveCategoryOrder","baseRevision",orderBaseRevision,"categoryOrder",orderIds()),saved->{orderBase=orderIds().toString();orderBaseRevision=saved.optLong("revision",orderBaseRevision);h.toast("分类顺序已保存");location="categories";renderOrder();});});
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setText(location.equals("root")||(categoriesOnly&&location.equals("categories"))?"关闭":"返回");
    }

    private void note(String text){TextView n=h.text(text,13,MainActivity.MUTED);h.pad(n,0,10);page.addView(n);}

    private void item(String title,String detail,Runnable action){
        LinearLayout row=h.vertical();h.pad(row,14,11);row.setMinimumHeight(h.dp(52));row.setBackground(h.shape(MainActivity.PALE,12));
        TextView name=h.text(title,16,MainActivity.INK);h.bold(name);row.addView(name);
        if(detail!=null&&!detail.isEmpty()){TextView hint=h.text(detail,12,MainActivity.MUTED);hint.setPadding(0,h.dp(5),0,0);row.addView(hint);}
        row.setContentDescription("设置："+title);row.setOnClickListener(v->{if(!busy)action.run();});
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=h.dp(8);page.addView(row,lp);
    }

    private void render(){
        if(dialog==null||!dialog.isShowing())return;
        if(location.equals("root")){
            begin("设置");note("写作习惯与思绪外观分别设置，内容保存在当前设备。");
            item("启动与写作","启动页面、分类、新日记默认分类与列表刷新",()->{location="writing";render();});
            item("全局外观","浅色或深色在所有页面统一使用",()->h.appTheme.show());
            item("写作页背景","独立壁纸、填充与透明度，不修改正文",()->h.appearance.show());
            item("思绪列表背景","列表独立壁纸，不修改写作背景或正文",()->h.diaryListAppearance.show());
            item("服务连接","电脑或云服务地址、服务发现与朝花夕拾实例状态",()->BackendServicesPage.show(h));
            item("数据与关于","本地导出范围、先前记录与版本信息",()->{location="data";render();});
        }else if(location.equals("writing")){
            begin("启动与写作");
            String startup=h.getPreferences(0).getString("startup","last");
            item("启动时打开",startup.equals("diary")?"思绪列表":startup.equals("chats")?"随想列表":startup.equals("write")?"直接新建日记（旧设置）":"继续上次页面",this::chooseStartup);
            item("启动过渡背景","应用打开、内容加载期间显示；可设独立壁纸",()->h.startupAppearance.show());
            item("分类管理","新增、默认、改名、删除和长按排序集中管理",()->{categoriesLoaded=false;location="categories";render();});
            String mode=h.getPreferences(0).getString("diary-refresh-mode","auto");
            item("思绪列表刷新",mode.equals("manual")?"手动刷新":"自动：回到前台时更新",this::chooseRefresh);
        }else if(location.equals("data")){
            begin("数据与关于");note("内容保存在当前设备，尚未同步电脑或云端。");
            item("导出思绪与先前记录","包含本地思绪、先前随想及其媒体；不包含新版随想或外观设置",h::exportBackup);
            item("先前的随想记录","查看旧版本原生随想，不合并新版 Telegram 消息",()->{if(h.screen.equals("editor")){h.toast("请先返回列表，再查看先前记录");return;}h.leaveTelegram(()->{dialog.dismiss();h.showLegacyChats();});});
            item("关于拾页",version(),this::about);
        }else if(location.equals("order")){
            renderOrder();
        }else{
            if(categoriesLoaded)renderOrder();else{begin("分类管理");note("正在读取本机分类…");loadCategories(false);}
        }
        themeChanged();
    }

    private JSONArray orderIds(){JSONArray value=new JSONArray();for(JSONObject category:orderDraft)value.put(category.optString("id"));return value;}

    private void openOrder(){
        location="categories";loadCategories(false);
    }
    private void loadCategories(boolean preserveDraft){
        run(MainActivity.obj("op","bootstrap"),value->{
            cancelOrderDrag();orderGeneration++;
            String selected=orderDraft.isEmpty()?"":orderDraft.get(Math.min(orderSelected,orderDraft.size()-1)).optString("id");
            ArrayList<JSONObject> previous=new ArrayList<>(orderDraft);orderDraft.clear();JSONArray categories=value.optJSONArray("categories"),base=new JSONArray();
            if(categories==null)categories=new JSONArray();
            for(int i=0;i<categories.length();i++)base.put(MainActivity.at(categories,i).optString("id"));
            if(preserveDraft)for(JSONObject old:previous)for(int i=0;i<categories.length();i++){JSONObject fresh=MainActivity.at(categories,i);if(old.optString("id").equals(fresh.optString("id"))){orderDraft.add(fresh);break;}}
            for(int i=0;i<categories.length();i++){JSONObject fresh=MainActivity.at(categories,i);if(orderIndex(fresh.optString("id"))<0)orderDraft.add(fresh);}
            catalog=value;h.catalog=value;JSONObject prefs=value.optJSONObject("writingPreferences");
            orderBaseRevision=prefs==null?0:prefs.optLong("revision",0);defaultCategoryId=prefs==null?"":prefs.optString("defaultCategoryId","");
            orderBase=base.toString();orderSelected=Math.max(0,orderIndex(selected));if(!preserveDraft)orderQuery="";
            categoriesLoaded=true;location="categories";renderOrder();
        });
    }

    private void moveOrder(int destination){
        if(orderDraft.isEmpty())return;destination=Math.max(0,Math.min(orderDraft.size()-1,destination));
        JSONObject category=orderDraft.remove(orderSelected);orderDraft.add(destination,category);orderSelected=destination;renderOrder();
    }

    private void renderOrder(){
        begin("分类管理");note("新增、改名、删除和默认分类即时保存；拖动仅调整草稿，点“保存排序”生效。删除分类保留日记。");
        LinearLayout actions=h.horizontal();Button add=new Button(h);add.setText("新增分类");add.setContentDescription("新增分类");add.setTextSize(13);add.setOnClickListener(v->{if(!busy)nameDialog(null);});actions.addView(add,new LinearLayout.LayoutParams(0,-2,1));
        Button clearDefault=new Button(h);clearDefault.setText("取消默认");clearDefault.setContentDescription("取消新日记默认分类");clearDefault.setTextSize(13);clearDefault.setEnabled(!defaultCategoryId.isEmpty()&&!defaultCategoryId.equals("null"));clearDefault.setOnClickListener(v->saveDefault(null));actions.addView(clearDefault,new LinearLayout.LayoutParams(0,-2,1));page.addView(actions);
        String defaultName="未分类";for(JSONObject c:orderDraft)if(c.optString("id").equals(defaultCategoryId))defaultName=c.optString("name");note("新日记默认："+defaultName);
        if(orderDraft.isEmpty()){note("还没有分类，可以返回新增。");return;}
        note("已选："+(orderSelected+1)+". "+orderDraft.get(orderSelected).optString("name"));
        LinearLayout controls=h.horizontal();String[] labels={"上移","下移","置顶","置底"};
        for(int i=0;i<labels.length;i++){final int action=i;Button button=new Button(h);button.setText(labels[i]);
            button.setTextSize(13);button.setMinWidth(0);button.setMinimumWidth(0);button.setMinimumHeight(h.dp(48));button.setPadding(h.dp(3),0,h.dp(3),0);
            button.setOnClickListener(v->{if(busy)return;moveOrder(action==0?orderSelected-1:action==1?orderSelected+1:action==2?0:orderDraft.size()-1);});
            controls.addView(button,new LinearLayout.LayoutParams(0,-2,1));}page.addView(controls);
        EditText search=new EditText(h);search.setSingleLine(true);search.setHint("搜索分类");search.setContentDescription("排序搜索分类");search.setText(orderQuery);page.addView(search);
        orderRows=h.vertical();page.addView(orderRows);renderOrderRows();
        search.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){}public void afterTextChanged(Editable s){orderQuery=s.toString();renderOrderRows();}});
        item("指定序号","移动到第1至"+orderDraft.size()+"项",this::numberOrder);
        item("重新载入排序","放弃排序草稿，读取其他地方的最新顺序",()->new AlertDialog.Builder(h).setTitle("重新载入排序？").setMessage("当前未保存的调整将被放弃。")
                .setNegativeButton("取消",null).setPositiveButton("重新载入",(d,n)->openOrder()).show());
        themeChanged();
    }

    private void renderOrderRows(){
        orderRows.removeAllViews();String query=orderQuery.trim().toLowerCase(Locale.ROOT);
        for(int i=0;i<orderDraft.size();i++){final int index=i;JSONObject category=orderDraft.get(i);
            if(!category.optString("name").toLowerCase(Locale.ROOT).contains(query))continue;
            final String categoryId=category.optString("id");
            LinearLayout row=h.vertical();h.pad(row,8,8);row.setMinimumHeight(h.dp(48));
            TextView label=h.text("↕  "+(i+1)+". "+category.optString("name")+(categoryId.equals(defaultCategoryId)?" · 默认":""),14,MainActivity.INK);label.setContentDescription("拖动分类："+category.optString("name"));row.addView(label);
            LinearLayout buttons=h.horizontal();String[] titles={categoryId.equals(defaultCategoryId)?"当前默认":"设默认","改名","删除"};
            for(int b=0;b<titles.length;b++){final int action=b;Button button=new Button(h);button.setText(titles[b]);button.setTextSize(11);button.setMinWidth(0);button.setMinimumWidth(0);button.setMinimumHeight(h.dp(44));button.setPadding(h.dp(2),0,h.dp(2),0);if(b==0&&categoryId.equals(defaultCategoryId))button.setEnabled(false);
                button.setContentDescription((b==0?"新日记默认分类：":b==1?"分类改名：":"删除分类：")+category.optString("name"));
                button.setOnClickListener(v->{if(busy)return;cancelOrderDrag();if(action==0)saveDefault(categoryId);else if(action==1)nameDialog(category);else confirmDelete(category);});buttons.addView(button,new LinearLayout.LayoutParams(0,-2,1));}row.addView(buttons);
            row.setTag(categoryId);
            row.setBackground(h.shape(i==orderSelected?MainActivity.PALE:0x00ffffff,10));row.setContentDescription("第"+(i+1)+"项，"+category.optString("name")+"；长按拖动排序，或点选后使用上移下移");
            row.setOnClickListener(v->{if(!busy){orderSelected=index;renderOrder();}});
            row.setOnLongClickListener(v->{
                if(busy||(!location.equals("order")&&!location.equals("categories"))||dialog==null||!dialog.isShowing())return false;
                int source=orderIndex(categoryId);if(source<0)return false;
                cancelOrderDrag();
                OrderDrag state=new OrderDrag(categoryId,orderGeneration,row,dialog);orderDrag=state;
                boolean started=row.startDragAndDrop(null,new View.DragShadowBuilder(row),state,0);
                if(started)row.setAlpha(.55f);else orderDrag=null;
                return started;
            });
            row.setOnDragListener((view,event)->orderDragEvent(row,categoryId,event));orderRows.addView(row);
            label.setOnLongClickListener(v->row.performLongClick());
            label.setOnClickListener(v->{if(!busy){orderSelected=index;renderOrder();}});
        }
        if(orderRows.getChildCount()==0)orderRows.addView(h.text("没有找到分类",13,MainActivity.MUTED));
        themeChanged();
    }

    private int orderIndex(String id){for(int i=0;i<orderDraft.size();i++)if(orderDraft.get(i).optString("id").equals(id))return i;return -1;}

    private boolean ownsOrderDrag(DragEvent event){
        return orderDrag!=null&&event.getLocalState()==orderDrag&&orderDrag.owner==dialog&&orderDrag.generation==orderGeneration
                &&dialog!=null&&dialog.isShowing()&&!busy&&(location.equals("order")||location.equals("categories"));
    }

    private void restoreOrderRow(View row,String id){row.setBackground(h.shape(orderIndex(id)==orderSelected?(h.appTheme.isDark()?0x6621394b:MainActivity.PALE):0x00ffffff,10));}

    private void cancelOrderDrag(){
        OrderDrag previous=orderDrag;orderDrag=null;
        stopDragScroll();
        if(previous!=null){previous.source.setAlpha(1f);previous.source.cancelDragAndDrop();}
        if(orderRows!=null)for(int i=0;i<orderRows.getChildCount();i++){
            View child=orderRows.getChildAt(i);if(child.getTag() instanceof String)restoreOrderRow(child,(String)child.getTag());
        }
    }
    private void stopDragScroll(){dragScrollDirection=0;h.main.removeCallbacks(dragScrollTick);}
    private void updateDragScroll(float y){
        if(settingsScroll==null)return;int direction=y<h.dp(48)?-1:y>settingsScroll.getHeight()-h.dp(48)?1:0;
        if(direction!=dragScrollDirection){dragScrollDirection=direction;h.main.removeCallbacks(dragScrollTick);if(direction!=0)h.main.post(dragScrollTick);}
    }

    private boolean orderDragEvent(View row,String targetId,DragEvent event){
        if(!ownsOrderDrag(event))return false;
        switch(event.getAction()){
            case DragEvent.ACTION_DRAG_STARTED:return true;
            case DragEvent.ACTION_DRAG_ENTERED:row.setBackground(h.shape(h.appTheme.isDark()?0xff284c63:0xffbfdff4,10));return true;
            case DragEvent.ACTION_DRAG_EXITED:restoreOrderRow(row,targetId);return true;
            case DragEvent.ACTION_DRAG_LOCATION:
                if(settingsScroll!=null){int[] position=new int[2],edge=new int[2];row.getLocationOnScreen(position);settingsScroll.getLocationOnScreen(edge);updateDragScroll(position[1]+event.getY()-edge[1]);}
                return true;
            case DragEvent.ACTION_DROP:
                int source=orderIndex(orderDrag.id),target=orderIndex(targetId);
                if(source<0||target<0)return false;
                orderDrag.source.setAlpha(1f);orderDrag=null;dragScrollDirection=0;h.main.removeCallbacks(dragScrollTick);
                final int scrollY=settingsScroll==null?0:settingsScroll.getScrollY();orderSelected=source;moveOrder(target);if(settingsScroll!=null)settingsScroll.post(()->settingsScroll.scrollTo(0,scrollY));return true;
            case DragEvent.ACTION_DRAG_ENDED:
                orderDrag.source.setAlpha(1f);orderDrag=null;dragScrollDirection=0;h.main.removeCallbacks(dragScrollTick);
                // No DROP means no draft mutation; refresh only selection/highlight feedback.
                renderOrderRows();return true;
            default:return false;
        }
    }

    private void numberOrder(){
        EditText input=new EditText(h);input.setSingleLine(true);input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);input.setText(String.valueOf(orderSelected+1));h.pad(input,20,12);
        AlertDialog number=new AlertDialog.Builder(h).setTitle("移动到指定序号").setView(input).setNegativeButton("取消",null).setPositiveButton("移动",null).create();
        number.setOnShowListener(d->number.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{int value=Integer.parseInt(input.getText().toString());if(value<1||value>orderDraft.size())throw new NumberFormatException();moveOrder(value-1);number.dismiss();}catch(NumberFormatException e){h.toast("请输入1至"+orderDraft.size()+"之间的序号");}}));number.show();
    }

    private void renderCategoryRows(JSONArray categories){
        if(!location.equals("categories"))return;
        if(categories==null||categories.length()==0){note("还没有分类，可以先新增一个。");return;}
        for(int i=0;i<categories.length();i++){
            JSONObject category=MainActivity.at(categories,i);
            item(category.optString("name"),"改名或删除分类",()->new AlertDialog.Builder(h).setTitle(category.optString("name"))
                    .setItems(new String[]{"改名","删除分类"},(d,index)->{if(index==0)nameDialog(category);else confirmDelete(category);})
                    .setNegativeButton("取消",null).show());
        }
    }

    private void nameDialog(JSONObject category){
        EditText input=new EditText(h);input.setSingleLine(true);input.setTextColor(MainActivity.INK);
        input.setHint("例如：旅行");input.setContentDescription("分类名称");input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(80)});h.pad(input,20,12);
        if(category!=null){input.setText(category.optString("name"));input.setSelection(input.length());}
        AlertDialog edit=new AlertDialog.Builder(h).setTitle(category==null?"新增分类":"分类改名").setView(input)
                .setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        edit.setOnShowListener(d->edit.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            JSONObject request=MainActivity.obj("op",category==null?"createCategory":"renameCategory","name",input.getText().toString());
            if(category!=null)try{request.put("id",category.getString("id"));}catch(Exception e){h.error(e);return;}
            run(request,value->{edit.dismiss();loadCategories(true);});
        }));edit.show();
    }

    private void confirmDelete(JSONObject category){
        AlertDialog confirm=new AlertDialog.Builder(h).setTitle("删除这个分类？")
                .setMessage("“"+category.optString("name")+"”下的日记与先前记录将保留并移到未分类。若它是新日记默认分类，默认值也会改为未分类。")
                .setNegativeButton("取消",null).setPositiveButton("删除分类",null).create();
        confirm.setOnShowListener(d->confirm.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->
                run(MainActivity.obj("op","deleteCategory","id",category.optString("id")),value->{confirm.dismiss();h.toast("分类已删除，记录已保留");loadCategories(true);})));
        confirm.show();
    }

    private void saveDefault(String id){
        if(busy)return;cancelOrderDrag();
        run(MainActivity.obj("op","saveWritingPreferences","defaultCategoryId",id==null?JSONObject.NULL:id),saved->{
            defaultCategoryId=id==null?"":id;
            JSONArray acknowledgedOrder=saved.optJSONArray("categoryOrder");
            boolean sameOrder=acknowledgedOrder!=null&&orderBase.equals(acknowledgedOrder.toString());
            if(sameOrder)orderBaseRevision=saved.optLong("revision",orderBaseRevision);
            // An ACK for the default field is not consent to overwrite another client's new order.
            h.toast(!sameOrder?"默认分类已保存；其他位置改过排序，已保留此草稿，请重新载入核对":id==null?"新日记默认已取消；已有日记分类保持":"新日记默认分类已保存；已有日记分类保持");renderOrder();
        });
    }

    private void chooseDefault(){
        run(MainActivity.obj("op","bootstrap"),value->{
            catalog=value;h.catalog=value;JSONArray categories=value.optJSONArray("categories");
            int length=categories==null?0:categories.length(),selected=0;String[] names=new String[length+1],ids=new String[length+1];
            names[0]="未分类";ids[0]=null;String current=value.optJSONObject("writingPreferences").optString("defaultCategoryId","");
            for(int i=0;i<length;i++){JSONObject c=MainActivity.at(categories,i);names[i+1]=c.optString("name");ids[i+1]=c.optString("id");if(ids[i+1].equals(current))selected=i+1;}
            final int[] choice={selected};AlertDialog chooser=new AlertDialog.Builder(h).setTitle("新日记默认分类")
                    .setSingleChoiceItems(names,selected,(d,index)->choice[0]=index).setNegativeButton("取消",null).setPositiveButton("保存",null).create();
            chooser.setOnShowListener(d->chooser.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->
                    run(MainActivity.obj("op","saveWritingPreferences","defaultCategoryId",ids[choice[0]]==null?JSONObject.NULL:ids[choice[0]]),saved->{chooser.dismiss();h.toast("新日记默认分类已保存");render();})));
            chooser.show();
        });
    }

    private void chooseRefresh(){
        boolean manual=h.getPreferences(0).getString("diary-refresh-mode","auto").equals("manual");final int[] choice={manual?1:0};
        AlertDialog chooser=new AlertDialog.Builder(h).setTitle("思绪列表刷新")
                .setSingleChoiceItems(new String[]{"自动：回到前台时更新","手动：点击刷新按钮更新"},choice[0],(d,index)->choice[0]=index)
                .setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        chooser.setOnShowListener(d->chooser.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(busy)return;setBusy(true);final String value=choice[0]==1?"manual":"auto";
            h.io.execute(()->{boolean ok=h.getPreferences(0).edit().putString("diary-refresh-mode",value).commit();h.main.post(()->{
                if(h.destroyed)return;setBusy(false);if(ok){chooser.dismiss();h.toast("列表刷新方式已保存");render();}else h.toast("刷新设置未保存，请重试");
            });});
        }));chooser.show();
    }

    private void chooseStartup(){
        String current=h.getPreferences(0).getString("startup","last");final int[] choice={current.equals("diary")?1:current.equals("chats")?2:0};
        AlertDialog chooser=new AlertDialog.Builder(h).setTitle("启动时打开")
                .setSingleChoiceItems(new String[]{"继续上次页面（默认）","思绪列表","随想列表"},choice[0],(d,index)->choice[0]=index)
                .setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        chooser.setOnShowListener(d->chooser.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(busy)return;setBusy(true);final String value=new String[]{"last","diary","chats"}[choice[0]];
            h.io.execute(()->{boolean ok=h.getPreferences(0).edit().putString("startup",value).commit();h.main.post(()->{
                if(h.destroyed)return;setBusy(false);if(ok){chooser.dismiss();h.toast("下次打开时生效");render();}else h.toast("启动设置未保存，请重试");
            });});
        }));chooser.show();
    }

    private void setBusy(boolean value){busy=value;if(dialog!=null){dialog.setCancelable(!value);if(dialog.isShowing())dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(!value);}}

    private void run(JSONObject request,Consumer<JSONObject> done){
        if(busy)return;setBusy(true);
        h.io.execute(()->{try{JSONObject value=h.store.dispatch(request);h.main.post(()->{if(h.destroyed)return;setBusy(false);if(dialog!=null&&dialog.isShowing())done.accept(value);});}
            catch(Exception e){h.main.post(()->{if(h.destroyed)return;setBusy(false);h.error(e);});}});
    }

    private String version(){try{return "版本 "+h.getPackageManager().getPackageInfo(h.getPackageName(),0).versionName;}catch(Exception e){return "本地前端预览";}}

    private void about(){new AlertDialog.Builder(h).setTitle("关于拾页").setMessage(version()+"\n\n随想：本地 Telegram 消息前端。\n写日记：直接新建一篇思绪。\n思绪：分类浏览、阅读与继续编辑。\n\n内容保存在当前设备，尚未同步电脑或云端。当前导出只含思绪与先前原生随想及其媒体，不含新版随想，也不含独立外观设置。")
            .setPositiveButton("返回",null).show();}
}
