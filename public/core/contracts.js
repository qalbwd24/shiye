/**
 * Browser extension contract. Runtime storage schema is documented in docs/DATA-MODEL.md.
 * @typedef {{id:string,title:string,content:string,date:string,category:string,tags:string[],attachments:string[],revision:number,history:object[],deleted?:boolean,draft?:boolean,hidden?:boolean,legacy?:object}} Entry
 * @typedef {{id:string,name:string,type:string,size:number,sha256?:string}} Media
 * @typedef {{schema:number,entries:Entry[],media:Media[],categories:string[],imports:object[],templates:object[],settings:object}} Library
 * @typedef {object} FeatureContext
 * @property {Library} library Live getter: access it per operation, never cache it at construction.
 * @property {(selector:string)=>Element} $ Query one DOM element.
 * @property {(selector:string)=>Element[]} $$ Query DOM elements.
 * @property {(url:string,options?:object)=>Promise<any>} api Local JSON/binary API client.
 * @property {()=>Entry|undefined} current Current editor entry.
 * @property {()=>Promise<void>} flush Wait for pending saves before changing entry identity.
 * @property {()=>Promise<void>} refreshLibrary Reload the library after API mutations.
 * @property {()=>void} renderView Render the current application view.
 * @property {()=>void} renderEditor Render the current editor.
 * @property {(entry:Entry)=>void} markDirty Queue an entry for automatic persistence.
 * @property {(view:string)=>Promise<void>} changeView Change the active view.
 * @property {(opts:{category?:string,tag?:string})=>Promise<void>} filterView Filter the list by category or tag.
 * @property {(id:string)=>Promise<void>} selectEntry Open an entry in the editor.
 * @property {(date?:Date,initial?:{category?:string,tags?:string[]})=>Promise<void>} newEntry Create a new diary entry.
 * @property {(action:()=>Promise<any>)=>Promise<any>} withLibraryMutation Flush drafts and hold editor input while mutating and refreshing the library.
 * @property {()=>Entry[]} filtered Current filtered entry collection.
 * @property {(title:string,html:string)=>void} modal Open the shared dialog.
 * @property {()=>void} closeModal Close the dialog.
 * @property {(text:string)=>void} toast Show a short local notification.
 * @property {(html:string)=>string} sanitize Sanitize persisted/imported HTML before rendering.
 * @property {(html:string)=>string} textOf Extract visible text for searching/counting/export.
 * @property {(value:unknown)=>string} escape Escape text inserted into HTML templates.
 * @property {(command:string,value?:string)=>void} command Execute an editor operation.
 * @property {(files:File[],entry?:Entry)=>Promise<void>} upload Attach local media.
 * @property {(name:string,type:string,content:any,extension:string)=>void} download Save a generated browser file.
 * @property {()=>void} legacyBackups Open legacy import/backup UI.
 */
export {};
