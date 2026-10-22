package dev.shiye.app;

/** Main-thread cold-start rendezvous. No clock or minimum display duration. */
final class StartupTransitionState {
    private int targetTicket, imageTicket;
    private boolean targetReady, imageReady, imagePresented;
    int beginTarget(){targetReady=false;return ++targetTicket;}
    int targetTicket(){return targetTicket;}
    void targetReady(int ticket){if(ticket==targetTicket)targetReady=true;}
    int beginImage(){imageReady=false;imagePresented=false;return ++imageTicket;}
    boolean acceptsImage(int ticket){return ticket==imageTicket;}
    void imageSettled(int ticket){if(acceptsImage(ticket))imageReady=true;}
    void imagePresented(int ticket){if(acceptsImage(ticket)&&imageReady)imagePresented=true;}
    boolean imageReady(){return imageReady;}
    boolean canFinish(){return targetReady&&imageReady&&imagePresented;}
}
