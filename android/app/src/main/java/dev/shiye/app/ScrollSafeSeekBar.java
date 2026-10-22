package dev.shiye.app;

import android.content.Context;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.widget.SeekBar;

/** Defer slider changes until a tap or an intentional horizontal drag. */
final class ScrollSafeSeekBar extends SeekBar {
    private final int slop;
    private float startX,startY;
    private MotionEvent down;
    private boolean tracking,cancelled,movedBeyondTap;
    ScrollSafeSeekBar(Context context){super(context);slop=ViewConfiguration.get(context).getScaledTouchSlop();}
    private void clear(){if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(false);if(down!=null){down.recycle();down=null;}tracking=false;cancelled=false;movedBeyondTap=false;}
    @Override public boolean onTouchEvent(MotionEvent event){
        if(!isEnabled())return false;
        int action=event.getActionMasked();
        if(action==MotionEvent.ACTION_DOWN){clear();startX=event.getX();startY=event.getY();down=MotionEvent.obtain(event);return true;}
        if(action==MotionEvent.ACTION_POINTER_DOWN||event.getPointerCount()>1){
            if(tracking){MotionEvent cancel=MotionEvent.obtain(event);cancel.setAction(MotionEvent.ACTION_CANCEL);super.onTouchEvent(cancel);cancel.recycle();}
            if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(false);cancelled=true;return false;
        }
        if(cancelled){if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL)clear();return false;}
        if(action==MotionEvent.ACTION_MOVE&&!tracking){
            float dx=Math.abs(event.getX()-startX),dy=Math.abs(event.getY()-startY);
            if(Math.hypot(dx,dy)>slop)movedBeyondTap=true;
            if(dy>slop&&dy>dx){cancelled=true;if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(false);return false;}
            if(dx>slop&&dx>dy*1.25f&&down!=null){tracking=true;if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(true);super.onTouchEvent(down);}
            else return true;
        }
        if(action==MotionEvent.ACTION_UP&&!tracking&&down!=null){
            float dx=event.getX()-startX,dy=event.getY()-startY;
            if(movedBeyondTap||Math.hypot(dx,dy)>slop){clear();return true;}
            super.onTouchEvent(down);boolean result=super.onTouchEvent(event);clear();return result;
        }
        if(action==MotionEvent.ACTION_CANCEL){if(tracking)super.onTouchEvent(event);clear();return true;}
        boolean result=tracking&&super.onTouchEvent(event);
        if(action==MotionEvent.ACTION_UP)clear();return result;
    }
    @Override protected void onDetachedFromWindow(){
        if(tracking&&down!=null){MotionEvent cancel=MotionEvent.obtain(down);cancel.setAction(MotionEvent.ACTION_CANCEL);super.onTouchEvent(cancel);cancel.recycle();}
        clear();super.onDetachedFromWindow();
    }
}
