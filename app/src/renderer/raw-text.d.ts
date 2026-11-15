/** Text files built into the renderer as strings (Vite's `?raw`), such as the Help guides. */
declare module '*.md?raw' {
  const text: string;
  export default text;
}
