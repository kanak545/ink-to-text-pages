export type Upload = { dataUrl: string; mimeType: string; fileName: string };
let current: Upload | null = null;
export const setUpload = (u: Upload) => { current = u; };
export const getUpload = () => current;

// The recognized/edited note text, shared between the editor and study pages.
let noteText = "";
export const setNoteText = (t: string) => { noteText = t; };
export const getNoteText = () => noteText;
