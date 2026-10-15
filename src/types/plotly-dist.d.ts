// React Plotly and image exports use this browser bundle. Its public API
// matches the typed package entry, without requiring source-module bundling.
declare module 'plotly.js/dist/plotly' {
  import * as Plotly from 'plotly.js';
  export default Plotly;
}
