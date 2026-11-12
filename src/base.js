// The game may be served from the root of its own address or from a folder of another site (mann.cool/leave/).
// Every address the browser asks for goes through here so both work: at('/models/x.glb') -> '/leave/models/x.glb'.
export const BASE = new URL('.', document.baseURI).pathname;
export const at = (path) => (path.startsWith('/') ? BASE + path.slice(1) : path);
