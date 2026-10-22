package dev.shiye.app;

/** The visible grid's identity and cursor stay committed until its replacement has a first page. */
final class PickerAlbumState {
    static final class Snapshot {
        final String albumId, albumName;
        final long lastDate, lastId;
        final boolean hasMore;
        Snapshot(String albumId, String albumName, long lastDate, long lastId, boolean hasMore) {
            this.albumId=albumId;this.albumName=albumName;
            this.lastDate=lastDate;this.lastId=lastId;this.hasMore=hasMore;
        }
    }
    private static final class Pending {
        final int ticket;
        final String albumId, albumName;
        Pending(int ticket,String albumId,String albumName){this.ticket=ticket;this.albumId=albumId;this.albumName=albumName;}
    }
    private Snapshot displayed=new Snapshot(null,null,Long.MAX_VALUE,Long.MAX_VALUE,true);
    private Pending pending;
    private int displayedTicket;

    void begin(int ticket,String albumId,String albumName){pending=new Pending(ticket,albumId,albumName);}
    boolean pending(int ticket){return pending!=null&&pending.ticket==ticket;}
    boolean commit(int ticket,long lastDate,long lastId,boolean hasMore){
        if(!pending(ticket))return false;
        displayed=new Snapshot(pending.albumId,pending.albumName,lastDate,lastId,hasMore);
        displayedTicket=ticket;pending=null;return true;
    }
    Snapshot rollback(int ticket){
        if(!pending(ticket))return null;
        pending=null;return displayed;
    }
    boolean advance(int ticket,long lastDate,long lastId,boolean hasMore){
        if(pending!=null||displayedTicket!=ticket)return false;
        displayed=new Snapshot(displayed.albumId,displayed.albumName,lastDate,lastId,hasMore);
        return true;
    }
    void rebind(int ticket){if(pending==null)displayedTicket=ticket;}
    void cancel(){pending=null;}
    Snapshot displayed(){return displayed;}
}
