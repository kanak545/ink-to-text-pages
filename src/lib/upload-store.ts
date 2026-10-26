export type Upload = { dataUrl: string; mimeType: string; fileName: string };
let current: Upload | null = null;
export const setUpload = (u: Upload) => { current = u; };
export const getUpload = () => current;
